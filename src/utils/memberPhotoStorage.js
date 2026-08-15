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
  getPhotoMetadata,
  updatePhotoMetadata,
  removePhotoMetadata,
} from "./memberPhotoIndex";

const PHOTO_DIR = "member-photos";
const STORAGE_DIRECTORY = Directory.Data;

const photoCache = new Map();
const listeners = new Set();

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
  console.error(`[memberPhotoStorage] ${operation}`, {
    ...details,
    errorMessage: error?.message ?? String(error),
    errorCode: error?.code ?? error?.errorCode ?? undefined,
    nativeError: error?.data ?? error?.nativeError ?? undefined,
    stack: error?.stack,
  });
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
  photoCache.delete(key);
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

  photoCache.delete(key);

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

/**
 * Returns a displayable data URL for a locally stored member photo.
 */
export async function getMemberPhoto(memberId) {
  if (!memberId) return null;

  const key = String(memberId);

  if (photoCache.has(key)) {
    return photoCache.get(key);
  }

  try {
    const result = await Filesystem.readFile({
      path: pathFor(key),
      directory: STORAGE_DIRECTORY,
    });

    const dataUrl = result?.data
      ? `data:image/jpeg;base64,${result.data}`
      : null;

    photoCache.set(key, dataUrl);

    return dataUrl;
  } catch {
    photoCache.set(key, null);
    return null;
  }
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

  photoCache.delete(key);
  notify(key);

  return true;
}
