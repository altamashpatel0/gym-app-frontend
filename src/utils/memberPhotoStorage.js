// src/utils/memberPhotoStorage.js
//
// PHASE 1 + PHASE 2 — SINGLE SOURCE OF TRUTH for member profile photos.
//
// ACTUAL PHOTO:
//   Directory.Data/member-photos/{memberId}.jpg
//
// METADATA:
//   Directory.Data/photo-index/index.json
//
// Photos are fully local. They are never uploaded to B2/Cloudinary/backend.
// The persistent Filesystem storage survives app restarts and Android process
// restarts. The in-memory Map below is only a performance optimization.
//
// IMPORTANT DESIGN NOTE (bug fix):
// The actual photo write (Phase 1, required) and the hash/version/metadata
// bookkeeping (Phase 2, optional enhancement) are now handled in SEPARATE
// try/catch blocks. Previously a single try/catch wrapped both — so if
// crypto.subtle.digest() or the memberPhotoIndex.js metadata layer threw for
// ANY reason, saveMemberPhoto() returned false even though the photo file had
// already been written successfully to Directory.Data. That is what produced
// "Could not save photo on this device" despite permissions being fine: the
// error was never actually a filesystem/permission failure, it was a
// downstream metadata failure being reported as a total save failure.
//
// The photo write is now verified by reading the file back (Task 5). Only a
// failure in ensureDir / writeFile / read-back verification is treated as a
// real save failure. A metadata/index failure is logged and swallowed —
// the member's photo is still saved and still displays correctly.

import { Filesystem, Directory } from "@capacitor/filesystem";
import {
  getPhotoIndex,
  getPhotoMetadata,
  updatePhotoMetadata,
  removePhotoMetadata,
  upsertManyPhotoMetadata,
} from "./memberPhotoIndex";

const PHOTO_DIR = "member-photos";
const STORAGE_DIRECTORY = Directory.Data;

const photoCache = new Map();
const listeners = new Set();

// PHASE 4A — in-flight request dedup + stale-read race protection.
//
// photoLoadPromises: memberId -> Promise<dataUrl|null> for a read that is
// currently in progress. Concurrent getMemberPhoto() calls for the same
// member all await this same Promise instead of each issuing their own
// Filesystem.readFile(). Cleared as soon as the read settles — a Promise is
// never kept around after it resolves/rejects.
//
// photoGeneration: memberId -> integer, bumped every time the on-disk photo
// changes from JS's point of view (save, delete, or a synced photo being
// registered). A read captures the generation it started at; when it
// finishes, it only writes to photoCache if the generation is still the
// same. This is what prevents a slow read that started BEFORE a save from
// clobbering the cache with stale data AFTER the save completes.
const photoLoadPromises = new Map();
const photoGeneration = new Map();

function bumpGeneration(key) {
  photoGeneration.set(key, (photoGeneration.get(key) || 0) + 1);
}

/**
 * Invalidate everything the in-flight-dedup layer knows about a member:
 * drop the resolved-value cache entry, drop any in-flight Promise (so the
 * next getMemberPhoto() call starts a fresh read against the new file
 * rather than reusing a Promise that was already in progress against the
 * old one), and bump the generation token so any still-pending read from
 * before this call can detect it's stale and refuse to overwrite the cache.
 */
function invalidatePhotoCache(key) {
  photoCache.delete(key);
  photoLoadPromises.delete(key);
  bumpGeneration(key);
}

function notify(memberId) {
  const key = String(memberId);

  listeners.forEach((fn) => {
    try {
      fn(key);
    } catch {
      // One listener must never break the others.
    }
  });
}

export function onMemberPhotoChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function pathFor(memberId) {
  return `${PHOTO_DIR}/${memberId}.jpg`;
}

// Structured error logger per CRITICAL TASK 3 — dev/Logcat gets full detail,
// the UI still only ever sees the generic "Could not save photo" message.
function logSaveFailure(operation, details, error) {
  const payload = {
    ...details,
    errorMessage:
      error?.message ?? (error !== undefined ? String(error) : undefined),
    errorCode: error?.code ?? error?.errorCode ?? undefined,
    nativeError: error?.data ?? error?.nativeError ?? undefined,
    stack: error?.stack,
  };

  // console.error(op, someObject) renders as "[object Object]" on Android
  // Logcat's console bridge — JSON.stringify it so the real error surfaces.
  try {
    console.error(
      `[memberPhotoStorage] ${operation}`,
      JSON.stringify(payload, null, 2)
    );
  } catch {
    console.error(`[memberPhotoStorage] ${operation}`, payload);
  }
}

async function ensureDir(memberId) {
  try {
    await Filesystem.mkdir({
      path: PHOTO_DIR,
      directory: STORAGE_DIRECTORY,
      recursive: true,
    });
  } catch (error) {
    // mkdir throws if the directory already exists — that's expected and
    // fine. Anything else (e.g. a genuine storage error) should not be
    // silently swallowed, so we log it but still let the caller attempt the
    // write (writeFile itself will fail loudly if the directory truly
    // couldn't be created).
    const message = String(error?.message || "").toLowerCase();
    const alreadyExists =
      message.includes("exist") || error?.code === "OS-PLUG-FILE-0006";

    if (!alreadyExists) {
      logSaveFailure(
        "ensureDir warning (continuing to attempt write)",
        { memberId, directory: STORAGE_DIRECTORY, path: PHOTO_DIR },
        error
      );
    }
  }
}

function toRawBase64(data) {
  if (typeof data !== "string") return "";

  const commaIdx = data.indexOf(",");

  if (data.startsWith("data:") && commaIdx !== -1) {
    return data.slice(commaIdx + 1);
  }

  return data;
}

function base64ToBytes(base64) {
  const raw = toRawBase64(base64);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function sha256Base64(base64) {
  const bytes = base64ToBytes(base64);

  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is not available in this Android WebView");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readStoredRawBase64(memberId) {
  const result = await Filesystem.readFile({
    path: pathFor(memberId),
    directory: STORAGE_DIRECTORY,
  });

  return result?.data || "";
}

/**
 * Best-effort Phase 2 bookkeeping: compute hash/version and persist
 * metadata. Failures here are logged but never bubble up as a save
 * failure — the actual photo file (Phase 1) is already safely on disk
 * by the time this runs.
 */
async function updateMetadataBestEffort(key, newRawBase64) {
  try {
    let previous = await getPhotoMetadata(key);

    // Phase 1 photos created before Phase 2 may not have metadata.
    // Detect the existing file and treat it as version 1.
    if (!previous) {
      try {
        const oldRawBase64 = await readStoredRawBase64(key);

        if (oldRawBase64 && oldRawBase64 !== newRawBase64) {
          previous = {
            memberId: key,
            fileName: `${key}.jpg`,
            path: pathFor(key),
            version: 1,
            updatedAt: new Date().toISOString(),
            hash: await sha256Base64(oldRawBase64),
          };
        }
      } catch {
        // No usable previous file — this is a genuinely new photo.
      }
    }

    const newHash = await sha256Base64(newRawBase64);

    const contentChanged =
      !previous || !previous.hash || previous.hash !== newHash;

    const nextVersion = contentChanged
      ? Number(previous?.version || 0) + 1
      : Number(previous?.version || 1);

    const nextUpdatedAt = contentChanged
      ? new Date().toISOString()
      : previous?.updatedAt || new Date().toISOString();

    await updatePhotoMetadata({
      memberId: key,
      fileName: `${key}.jpg`,
      path: pathFor(key),
      version: nextVersion,
      updatedAt: nextUpdatedAt,
      hash: newHash,
    });
  } catch (error) {
    logSaveFailure(
      "Metadata update failed (photo file itself is still saved)",
      { memberId: key, path: pathFor(key), directory: STORAGE_DIRECTORY },
      error
    );
  }
}

/**
 * Save or replace a member photo.
 *
 * Sequence (CRITICAL TASK 5):
 *   1. ensure directory
 *   2. write photo
 *   3. read photo back to verify it actually landed on disk
 *   4. confirm the read-back data is non-empty
 *   5. update in-memory cache
 *   6. notify listeners
 *   7. return true
 *
 * Phase 2 hash/version/metadata bookkeeping happens AFTER the above and
 * is intentionally best-effort — see updateMetadataBestEffort(). A
 * metadata failure never causes an already-successful photo write to be
 * reported as failed.
 */
export async function saveMemberPhoto(memberId, base64Data) {
  // ── CRITICAL TASK 4: validate before doing any expensive work ──────────
  if (memberId === undefined || memberId === null || memberId === "") {
    console.error("[memberPhotoStorage] Save failed: missing memberId");
    return false;
  }

  if (typeof base64Data !== "string" || base64Data.length === 0) {
    console.error("[memberPhotoStorage] Save failed: missing/invalid base64Data", {
      memberId,
    });
    return false;
  }

  const key = String(memberId);
  const newRawBase64 = toRawBase64(base64Data);

  if (!newRawBase64) {
    console.error("[memberPhotoStorage] Save failed: empty base64 after stripping prefix", {
      memberId: key,
    });
    return false;
  }

  const path = pathFor(key);

  // ── Steps 1–4: the actual, required, Phase 1 write + verification ─────
  try {
    await ensureDir(key);

    await Filesystem.writeFile({
      path,
      data: newRawBase64,
      directory: STORAGE_DIRECTORY,
      recursive: true,
    });

    // Read the file back to confirm it was really persisted, per Task 5.
    const verifyResult = await Filesystem.readFile({
      path,
      directory: STORAGE_DIRECTORY,
    });

    if (!verifyResult?.data) {
      logSaveFailure(
        "Save failed: read-back verification returned empty data",
        { memberId: key, path, directory: STORAGE_DIRECTORY },
        new Error("Empty read-back after writeFile")
      );
      return false;
    }
  } catch (error) {
    logSaveFailure(
      "Save failed",
      { memberId: key, path, directory: STORAGE_DIRECTORY },
      error
    );
    // Do NOT update cache/metadata as if the save succeeded.
    return false;
  }

  // ── Steps 5–6: update cache + notify — the photo IS saved at this point ─
  invalidatePhotoCache(key);
  notify(key);

  // ── Phase 2 bookkeeping — best-effort, never flips the result to false ─
  await updateMetadataBestEffort(key, newRawBase64);

  // ── Step 7 ──────────────────────────────────────────────────────────────
  return true;
}

/**
 * PHASE 3B — record that a photo was already written to disk by the native
 * LocalLanSync plugin.
 *
 * The native side receives the incoming JPG as chunked binary frames, hashes
 * it, verifies that hash against what the sender advertised, and only THEN
 * atomically renames it into member-photos/{memberId}.jpg (see
 * LocalLanSyncPlugin.handlePhotoComplete). So by the time the "photoReceived"
 * event reaches JS, the photo bytes are already correct and in place —
 * writing them again here would be redundant (and, for large photos,
 * wasteful base64 round-tripping we specifically want to avoid).
 *
 * This function only does the Phase 2 bookkeeping: update the metadata
 * index with the sender's (already-verified) version/hash/updatedAt, drop
 * the in-memory photo cache entry so the new file is picked up, and notify
 * listeners so MemberPhoto components re-render.
 *
 * Callers MUST only invoke this in response to the native "photoReceived"
 * event, which only fires after hash verification succeeds.
 */
export async function registerSyncedPhoto(memberId, remoteMetadata) {
  if (memberId === undefined || memberId === null || memberId === "") {
    console.error("[memberPhotoStorage] registerSyncedPhoto failed: missing memberId");
    return false;
  }

  const key = String(memberId);

  invalidatePhotoCache(key);

  try {
    await updatePhotoMetadata({
      memberId: key,
      fileName: remoteMetadata?.fileName || `${key}.jpg`,
      path: pathFor(key),
      version: Number(remoteMetadata?.version) || 1,
      updatedAt: remoteMetadata?.updatedAt || new Date().toISOString(),
      hash: remoteMetadata?.hash || "",
    });
  } catch (error) {
    logSaveFailure(
      "registerSyncedPhoto: metadata update failed (photo file itself is still saved)",
      { memberId: key, path: pathFor(key), directory: STORAGE_DIRECTORY },
      error
    );
  }

  notify(key);
  return true;
}

// =============================================================
// LEGACY PHOTO MIGRATION / INDEX REBUILD
//
// Photos saved by the very first (pre-Phase-2) build of this app were
// written straight to member-photos/{memberId}.jpg with no corresponding
// entry in photo-index/index.json (that index didn't exist yet). Those
// photo FILES are still perfectly valid and still display correctly via
// getMemberPhoto() — the only thing missing is metadata. Because
// photoSyncManager.js (Phase 3) builds its sync plan entirely from the
// metadata index, those legacy photos were invisible to sync: they never
// appeared in toSend/toReceive/conflicts even though the files exist on
// disk.
//
// migrateLegacyPhotosToIndex() closes that gap by scanning the actual
// member-photos/ directory and creating an index entry for any
// {memberId}.jpg file that doesn't already have one. It NEVER reads,
// writes, moves, renames or deletes an existing photo file, and it NEVER
// touches metadata that already exists for a memberId.
// =============================================================

// Matches "<memberId>.jpg" (case-insensitive extension), where memberId is
// one or more characters that aren't a path separator or dot. This
// intentionally excludes dotfiles (e.g. ".nomedia") and anything that
// isn't a plain "<id>.jpg" entry.
const LEGACY_PHOTO_FILENAME_RE = /^([^./\\][^/\\]*)\.jpg$/i;

function logMigrationWarning(operation, details, error) {
  const payload = {
    ...details,
    errorMessage:
      error?.message ?? (error !== undefined ? String(error) : undefined),
    errorCode: error?.code ?? error?.errorCode ?? undefined,
    nativeError: error?.data ?? error?.nativeError ?? undefined,
    stack: error?.stack,
  };

  // Passing a raw object as the second console.warn() arg prints as
  // "[object Object]" on Android Logcat's console bridge — stringify it so
  // the actual errorMessage/errorCode/nativeError/stack are visible.
  try {
    console.warn(
      `[memberPhotoStorage] migrateLegacyPhotosToIndex: ${operation}`,
      JSON.stringify(payload, null, 2)
    );
  } catch {
    console.warn(
      `[memberPhotoStorage] migrateLegacyPhotosToIndex: ${operation}`,
      payload
    );
  }
}

/**
 * List the raw entries in member-photos/. Returns [] (never throws) if the
 * directory doesn't exist yet or can't be read — that just means there is
 * nothing to migrate.
 *
 * Handles both shapes returned by different Capacitor Filesystem versions:
 * an array of plain filename strings, or an array of { name, type, ... }
 * FileInfo objects.
 */
async function listMemberPhotoDirEntries() {
  try {
    const result = await Filesystem.readdir({
      path: PHOTO_DIR,
      directory: STORAGE_DIRECTORY,
    });

    const files = result?.files || [];

    return files
      .map((entry) => (typeof entry === "string" ? entry : entry?.name))
      .filter((name) => typeof name === "string" && name.length > 0);
  } catch (error) {
    // Directory not existing yet (fresh install, or every photo has
    // already been deleted) is expected and not an error worth logging.
    const message = String(error?.message || "").toLowerCase();
    const notFound =
      message.includes("not exist") ||
      message.includes("not found") ||
      error?.code === "OS-PLUG-FILE-0009" ||
      error?.code === "ENOENT";

    if (!notFound) {
      logMigrationWarning(
        "could not list member-photos directory (continuing with zero legacy photos)",
        { directory: STORAGE_DIRECTORY, path: PHOTO_DIR },
        error
      );
    }

    return [];
  }
}

// Only one migration pass runs at a time. If migrateLegacyPhotosToIndex()
// is called again while a pass is still in flight (e.g. exchangePhotoIndex()
// firing twice in quick succession from a retried connect), the second
// caller just awaits the SAME in-flight promise instead of starting a second
// overlapping scan. This is what used to let two migration passes race each
// other's index reads/writes — on Android that could throw a native
// "file busy" style error out of Filesystem.writeFile(), which is what
// migrateLegacyPhotosToIndex's old outer catch was actually seeing as
// "unexpected error migrating legacy photo" for many photos in a row.
let migrationInFlight = null;

/**
 * Scan member-photos/ for legacy {memberId}.jpg files that have no
 * corresponding entry in photo-index/index.json, and create metadata for
 * them (version 1). Existing metadata is never modified, and photo files
 * are only ever read — never written, moved, renamed or deleted.
 *
 * Idempotent: running this multiple times in a row only creates metadata
 * for the first run; every subsequent run finds metadata already present
 * for those members and does nothing further for them.
 *
 * Safe to call with zero photos on disk, safe to call repeatedly, and
 * best-effort per file — one corrupt/unreadable legacy photo is logged and
 * skipped without stopping migration of the rest.
 *
 * Returns a summary (useful for logging/debugging); callers that just want
 * "the index is now as complete as possible" can ignore the return value.
 */
export async function migrateLegacyPhotosToIndex() {
  if (migrationInFlight) {
    return migrationInFlight;
  }

  migrationInFlight = runLegacyPhotoMigration().finally(() => {
    migrationInFlight = null;
  });

  return migrationInFlight;
}

async function runLegacyPhotoMigration() {
  const summary = {
    scanned: 0,
    migrated: 0,
    alreadyIndexed: 0,
    skippedInvalidName: 0,
    failed: 0,
    errors: [],
  };

  // Requirement 1: ensure the directory exists / handle it being absent
  // safely. Reuses the same mkdir-if-missing logic saveMemberPhoto() uses;
  // if the directory truly doesn't exist there is simply nothing to scan.
  await ensureDir("migration");

  const entries = await listMemberPhotoDirEntries();

  // Read the index ONCE up front (instead of once per file) so we know
  // which memberIds already have metadata before doing any of the
  // expensive per-file read/hash work below.
  let existingPhotos = {};

  try {
    const currentIndex = await getPhotoIndex();
    existingPhotos = currentIndex?.photos || {};
  } catch (error) {
    logMigrationWarning(
      "could not read existing index before scanning — treating as empty for this scan",
      { directory: STORAGE_DIRECTORY },
      error
    );
  }

  // Build the full set of candidates ENTIRELY in memory first — no index
  // write happens until every file has been scanned/hashed.
  const candidates = [];

  for (const fileName of entries) {
    const match = LEGACY_PHOTO_FILENAME_RE.exec(fileName);

    if (!match) {
      // Not a "<memberId>.jpg" file (could be a stray/system file) —
      // leave it alone, it's not ours to migrate.
      summary.skippedInvalidName += 1;
      continue;
    }

    summary.scanned += 1;
    const memberId = match[1];

    if (Object.prototype.hasOwnProperty.call(existingPhotos, memberId)) {
      // Metadata already present and valid — per the migration contract,
      // do not touch version/updatedAt/hash for it.
      summary.alreadyIndexed += 1;
      continue;
    }

    const path = pathFor(memberId);
    let rawBase64;

    try {
      rawBase64 = await readStoredRawBase64(memberId);
    } catch (error) {
      logMigrationWarning(
        "legacy photo file could not be read — leaving file untouched, skipping index entry",
        { memberId, path, directory: STORAGE_DIRECTORY },
        error
      );
      summary.failed += 1;
      summary.errors.push({ memberId, reason: "unreadable" });
      continue;
    }

    if (!rawBase64) {
      logMigrationWarning(
        "legacy photo file is empty — leaving file untouched, skipping index entry",
        { memberId, path, directory: STORAGE_DIRECTORY }
      );
      summary.failed += 1;
      summary.errors.push({ memberId, reason: "empty" });
      continue;
    }

    let hash = "";

    try {
      hash = await sha256Base64(rawBase64);
    } catch (error) {
      // Hashing isn't strictly required to register a legacy photo — a
      // missing hash just means this entry will never spuriously match
      // "same" against a remote photo by hash alone (it'll still be
      // compared by version/updatedAt/hash in comparePhotoIndexes). We
      // still register it so it's visible to sync at all.
      logMigrationWarning(
        "could not hash legacy photo (registering metadata without a hash)",
        { memberId, path, directory: STORAGE_DIRECTORY },
        error
      );
    }

    candidates.push({
      memberId,
      fileName: `${memberId}.jpg`,
      path,
      version: 1,
      updatedAt: new Date().toISOString(),
      hash,
    });
  }

  if (candidates.length === 0) {
    return summary;
  }

  // Requirement: read index once, write index once — commit every migrated
  // photo's metadata in a SINGLE serialized read-modify-write cycle rather
  // than one per photo. upsertManyPhotoMetadata() goes through the same
  // write queue as saveMemberPhoto()'s metadata updates, so this can never
  // interleave with (and lose) a concurrent new-photo save. skipExisting
  // re-checks against the LIVE index at write time, so a memberId that
  // gained metadata after our snapshot above (e.g. the user took a new
  // photo for that member while this scan was still running) is left
  // completely untouched here rather than being overwritten.
  try {
    const { updated, skipped } = await upsertManyPhotoMetadata(candidates, {
      skipExisting: true,
    });

    updated.forEach((memberId) => invalidatePhotoCache(memberId));

    summary.migrated += updated.length;
    summary.alreadyIndexed += skipped.length;
  } catch (error) {
    // The batch write itself failed (e.g. a genuine Filesystem/writeFile
    // error). Every candidate scanned this run is affected — log once with
    // full structured detail (not "[object Object]") and report them as
    // failed rather than silently pretending they migrated. Photo files
    // are untouched either way; this only ever affects index.json.
    logMigrationWarning(
      "unexpected error migrating legacy photos — leaving files untouched, skipping index entries",
      {
        memberIds: candidates.map((candidate) => candidate.memberId),
        directory: STORAGE_DIRECTORY,
      },
      error
    );
    summary.failed += candidates.length;
    candidates.forEach((candidate) =>
      summary.errors.push({
        memberId: candidate.memberId,
        reason: "unexpected-error",
      })
    );
  }

  return summary;
}

/**
 * Returns a displayable data URL for a locally stored member photo.
 *
 * PHASE 4A — in-flight request dedup (TASK 1):
 * If a read for this memberId is already in progress, every caller shares
 * that same Promise instead of triggering another Filesystem.readFile().
 * Exactly one native read happens no matter how many components ask for
 * the same member's photo at (roughly) the same time.
 *
 * PHASE 4A — stale-read race protection (TASK 2 / TASK 9):
 * The generation token captured at the start of the read is compared
 * against the current token once the read finishes. If saveMemberPhoto()
 * or deleteMemberPhoto() ran in the meantime, the token will have moved on
 * and this (now-stale) result is simply returned to whoever awaited it
 * without being written into photoCache — so it can never clobber a newer
 * save. A subsequent getMemberPhoto() call will do a fresh read and pick
 * up the correct value.
 */
export async function getMemberPhoto(memberId) {
  if (!memberId) return null;

  const key = String(memberId);

  // 1. Resolved-value cache hit — no filesystem work at all.
  if (photoCache.has(key)) {
    return photoCache.get(key);
  }

  // 2. A read for this member is already in flight — share it.
  if (photoLoadPromises.has(key)) {
    return photoLoadPromises.get(key);
  }

  // 3. Otherwise, kick off exactly one read and remember the generation
  // this read started at, so we can detect a concurrent save/delete.
  const generationAtStart = photoGeneration.get(key) || 0;

  const loadPromise = (async () => {
    try {
      const result = await Filesystem.readFile({
        path: pathFor(key),
        directory: STORAGE_DIRECTORY,
      });

      const dataUrl = result?.data
        ? `data:image/jpeg;base64,${result.data}`
        : null;

      if ((photoGeneration.get(key) || 0) === generationAtStart) {
        photoCache.set(key, dataUrl);
      }
      // else: a save/delete landed while this read was in flight — the
      // cache has already been (or will be) populated correctly by that
      // operation, so we must not overwrite it with this stale result.

      return dataUrl;
    } catch {
      // Missing photo is normal (TASK 6) — resolve to null, don't throw.
      if ((photoGeneration.get(key) || 0) === generationAtStart) {
        photoCache.set(key, null);
      }
      return null;
    } finally {
      // 4. Clear the in-flight entry once settled — Promises are never
      // kept around after the request finishes (TASK 7).
      //
      // IMPORTANT: only remove the map entry if it still points at THIS
      // promise. invalidatePhotoCache() (save/delete) already deletes the
      // entry for this key when it runs, so if a NEWER read (P2) started
      // after that invalidation and is now in flight, photoLoadPromises
      // will point at P2's promise by the time P1 (this one) settles. In
      // that case P1 must NOT delete P2's entry — doing so would let a
      // third caller start a redundant P3 while P2 is still in progress.
      if (photoLoadPromises.get(key) === loadPromise) {
        photoLoadPromises.delete(key);
      }
    }
  })();

  photoLoadPromises.set(key, loadPromise);
  return loadPromise;
}

export async function hasMemberPhoto(memberId) {
  return Boolean(await getMemberPhoto(memberId));
}

/**
 * Deletes only this member's local photo and metadata.
 */
export async function deleteMemberPhoto(memberId) {
  if (!memberId) return false;

  const key = String(memberId);

  try {
    await Filesystem.deleteFile({
      path: pathFor(key),
      directory: STORAGE_DIRECTORY,
    });
  } catch (error) {
    // File may already be absent — log at warn level for visibility without
    // treating "already gone" as a hard failure.
    console.warn("[memberPhotoStorage] deleteFile warning:", {
      memberId: key,
      path: pathFor(key),
      directory: STORAGE_DIRECTORY,
      error: error?.message ?? String(error),
    });
  }

  try {
    await removePhotoMetadata(key);
  } catch (error) {
    logSaveFailure(
      "Failed to remove photo metadata",
      { memberId: key, path: pathFor(key), directory: STORAGE_DIRECTORY },
      error
    );
  }

  invalidatePhotoCache(key);
  notify(key);

  return true;
}
