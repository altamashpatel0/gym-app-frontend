// src/utils/memberPhotoIndex.js
//
// PHASE 2 — Persistent local photo index.
// This file stores METADATA ONLY. Actual photos remain in:
//   member-photos/{memberId}.jpg
//
// No B2, Cloudinary, backend, Neon, LAN, hotspot or network sync is used here.

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

const INDEX_DIR = "photo-index";
const INDEX_PATH = `${INDEX_DIR}/index.json`;
const STORAGE_DIRECTORY = Directory.Data;

const INDEX_VERSION = 1;

function emptyIndex() {
  return {
    version: INDEX_VERSION,
    photos: {},
  };
}

async function ensureIndexDir() {
  try {
    await Filesystem.mkdir({
      path: INDEX_DIR,
      directory: STORAGE_DIRECTORY,
      recursive: true,
    });
  } catch {
    // Directory already exists.
  }
}

async function readIndex() {
  try {
    const result = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: STORAGE_DIRECTORY,
      encoding: Encoding.UTF8,
    });

    if (!result?.data) return emptyIndex();

    const parsed = JSON.parse(result.data);

    if (!parsed || typeof parsed !== "object") return emptyIndex();

    return {
      version: INDEX_VERSION,
      photos:
        parsed.photos && typeof parsed.photos === "object"
          ? parsed.photos
          : {},
    };
  } catch {
    return emptyIndex();
  }
}

function logWriteIndexFailure(payload, error) {
  const diagnostics = {
    ...payload,
    errorMessage:
      error?.message ?? (error !== undefined ? String(error) : undefined),
    errorCode: error?.code ?? error?.errorCode ?? undefined,
    nativeError: error?.data ?? error?.nativeError ?? undefined,
    stack: error?.stack,
  };

  // Never log photo data/base64 — `payload` here only ever contains the
  // index write's own bookkeeping (path/directory/dataType/dataLength/
  // recursive), never a photo's bytes.
  try {
    console.error(
      "[memberPhotoIndex] writePhotoIndex",
      JSON.stringify(diagnostics, null, 2)
    );
  } catch {
    // Fallback in case something in `diagnostics` isn't serializable.
    console.error("[memberPhotoIndex] writePhotoIndex", diagnostics);
  }
}

/**
 * Safely persist photo-index/index.json.
 *
 * ROOT CAUSE OF OS-PLUG-FILE-0005:
 * Filesystem.writeFile()'s `data` option is written as base64 UNLESS an
 * `encoding` is supplied — per @capacitor/filesystem's own docs: "If not
 * provided, data is written as base64 encoded." This call was writing
 * JSON.stringify(index) (plain text, e.g. `{"version":1,"photos":{...`)
 * with no `encoding`, so Android's native plugin tried to base64-decode a
 * string that isn't valid base64 (it contains `{`, `"`, `:`, spaces, etc.)
 * and rejected the call up front with "The 'writeFile' input parameters
 * aren't valid." (OS-PLUG-FILE-0005) — before any bytes were written.
 * That's why it failed for every legacy photo in the batch at once: the
 * whole migrateLegacyPhotosToIndex() run shares one writeIndex() call.
 *
 * Fix: pass `encoding: Encoding.UTF8` so the plugin writes the JSON as a
 * UTF8 string instead of trying to treat it as base64. readIndex() above
 * now reads with the same `encoding: Encoding.UTF8` so a successful write
 * is also read back correctly (without it, a UTF8-written file would come
 * back as base64-encoded bytes and fail JSON.parse).
 *
 * `recursive` is a valid, supported WriteFileOptions field, but it isn't
 * needed here since ensureIndexDir() below already guarantees photo-index/
 * exists before this write runs — so it's intentionally left off rather
 * than layered on top of a directory Filesystem.mkdir() already created.
 */
async function writeIndex(index) {
  await ensureIndexDir();

  const safeIndex = {
    version: INDEX_VERSION,
    photos:
      index?.photos && typeof index.photos === "object"
        ? index.photos
        : {},
  };

  const data = JSON.stringify(safeIndex, null, 2);

  if (typeof data !== "string" || data.length === 0) {
    const error = new Error(
      "writePhotoIndex: refusing to write empty/invalid serialized index"
    );
    logWriteIndexFailure(
      {
        operation: "writePhotoIndex",
        path: INDEX_PATH,
        directory: "DATA",
        dataType: typeof data,
        dataLength: data?.length,
      },
      error
    );
    throw error;
  }

  try {
    await Filesystem.writeFile({
      path: INDEX_PATH,
      data,
      directory: STORAGE_DIRECTORY,
      encoding: Encoding.UTF8,
    });
  } catch (error) {
    logWriteIndexFailure(
      {
        operation: "writePhotoIndex",
        path: INDEX_PATH,
        directory: "DATA",
        dataType: typeof data,
        dataLength: data.length,
      },
      error
    );
    throw error;
  }

  return safeIndex;
}

// ---------------------------------------------------------------------------
// INDEX WRITE SERIALIZATION
//
// upsertPhotoMetadata()/removePhotoMetadata()/upsertManyPhotoMetadata() each
// perform a read-modify-write cycle against photo-index/index.json. Without
// serialization, two callers racing (e.g. saveMemberPhoto() for a brand new
// photo firing at the same moment as migrateLegacyPhotosToIndex()'s legacy
// scan) can each read the index before the other has written, so whichever
// writeFile() lands second silently overwrites the first caller's change —
// and on Android, two Filesystem.writeFile() calls to the same path landing
// at the same instant can also throw a native "operation in progress" style
// error instead of losing data quietly.
//
// scheduleIndexWrite() forces every read-modify-write cycle in this module,
// regardless of which exported function triggered it, onto a single FIFO
// queue so there is never more than one in flight at a time.
// ---------------------------------------------------------------------------
let writeQueue = Promise.resolve();

function scheduleIndexWrite(task) {
  const run = writeQueue.then(() => task());

  // Keep the queue alive even if this task rejects — a failed write must
  // never permanently jam every future index write behind it.
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

export async function getPhotoIndex() {
  return readIndex();
}

export async function getAllPhotoMetadata() {
  const index = await readIndex();
  return Object.values(index.photos);
}

export async function getPhotoMetadata(memberId) {
  if (!memberId) return null;

  const index = await readIndex();
  return index.photos[String(memberId)] || null;
}

export async function hasPhotoMetadata(memberId) {
  return Boolean(await getPhotoMetadata(memberId));
}

export async function upsertPhotoMetadata(metadata) {
  if (!metadata?.memberId) {
    throw new Error("memberId is required for photo metadata");
  }

  return scheduleIndexWrite(async () => {
    const key = String(metadata.memberId);
    const index = await readIndex();

    index.photos[key] = {
      memberId: key,
      fileName: metadata.fileName || `${key}.jpg`,
      path: metadata.path || `member-photos/${key}.jpg`,
      version: Number(metadata.version) || 1,
      updatedAt: metadata.updatedAt || new Date().toISOString(),
      hash: metadata.hash || "",
    };

    await writeIndex(index);
    return index.photos[key];
  });
}

/**
 * Upsert MANY metadata entries in a single read-modify-write cycle instead
 * of one Filesystem read + one Filesystem write per entry. Used by legacy
 * migration so scanning N old photos costs one index write, not N — and,
 * since it goes through the same scheduleIndexWrite() queue as every other
 * mutator here, it can never interleave with a concurrent
 * upsertPhotoMetadata()/removePhotoMetadata() call either.
 *
 * With skipExisting: true (the default legacy-migration case), any
 * memberId that already has metadata by the time this actually runs is
 * left completely untouched — version/updatedAt/hash are never modified.
 * This re-check happens against the live index at write time, not against
 * whatever snapshot the caller scanned earlier, so a photo saved by
 * saveMemberPhoto() while a migration scan is still in progress can never
 * be clobbered by a stale migration entry for the same memberId.
 *
 * Returns { updated, skipped }: arrays of memberId strings.
 */
export async function upsertManyPhotoMetadata(metadataList, options = {}) {
  const { skipExisting = false } = options;
  const list = Array.isArray(metadataList) ? metadataList : [];

  if (list.length === 0) {
    return { updated: [], skipped: [] };
  }

  return scheduleIndexWrite(async () => {
    const index = await readIndex();
    const updated = [];
    const skipped = [];

    for (const metadata of list) {
      if (!metadata?.memberId) continue;

      const key = String(metadata.memberId);

      if (
        skipExisting &&
        Object.prototype.hasOwnProperty.call(index.photos, key)
      ) {
        skipped.push(key);
        continue;
      }

      index.photos[key] = {
        memberId: key,
        fileName: metadata.fileName || `${key}.jpg`,
        path: metadata.path || `member-photos/${key}.jpg`,
        version: Number(metadata.version) || 1,
        updatedAt: metadata.updatedAt || new Date().toISOString(),
        hash: metadata.hash || "",
      };
      updated.push(key);
    }

    if (updated.length > 0) {
      await writeIndex(index);
    }

    return { updated, skipped };
  });
}

export async function removePhotoMetadata(memberId) {
  if (!memberId) return false;

  return scheduleIndexWrite(async () => {
    const key = String(memberId);
    const index = await readIndex();

    if (!Object.prototype.hasOwnProperty.call(index.photos, key)) {
      return false;
    }

    delete index.photos[key];
    await writeIndex(index);
    return true;
  });
}

export async function updatePhotoMetadata(metadata) {
  return upsertPhotoMetadata(metadata);
}

/**
 * Compare this device's index with another device's metadata index.
 *
 * Input may be:
 *   - an index object: { version: 1, photos: {...} }
 *   - a plain photos map: { "101": {...}, "102": {...} }
 *   - an array of metadata objects
 *
 * No files are written and no network operation is performed.
 */
export async function comparePhotoIndexes(remoteIndex) {
  const localIndex = await readIndex();

  const localPhotos = localIndex.photos || {};
  const remotePhotos = normalizePhotos(remoteIndex);

  const same = [];
  const localOnly = [];
  const remoteOnly = [];
  const different = [];

  const allIds = new Set([
    ...Object.keys(localPhotos),
    ...Object.keys(remotePhotos),
  ]);

  for (const id of allIds) {
    const local = localPhotos[id];
    const remote = remotePhotos[id];

    if (local && !remote) {
      localOnly.push(id);
      continue;
    }

    if (!local && remote) {
      remoteOnly.push(id);
      continue;
    }

    if (!local || !remote) continue;

    if (local.hash && remote.hash && local.hash === remote.hash) {
      same.push(id);
      continue;
    }

    if (
      Number(local.version) === Number(remote.version) &&
      local.updatedAt === remote.updatedAt &&
      local.hash === remote.hash
    ) {
      same.push(id);
      continue;
    }

    different.push(id);
  }

  return {
    same: same.sort(),
    localOnly: localOnly.sort(),
    remoteOnly: remoteOnly.sort(),
    different: different.sort(),
  };
}

export async function getChangedPhotos(remoteIndex) {
  const comparison = await comparePhotoIndexes(remoteIndex);
  return [...comparison.different];
}

export async function getMissingPhotos(remoteIndex) {
  const comparison = await comparePhotoIndexes(remoteIndex);
  return [...comparison.remoteOnly];
}

function normalizePhotos(value) {
  if (!value) return {};

  if (Array.isArray(value)) {
    return value.reduce((acc, item) => {
      if (item?.memberId != null) {
        acc[String(item.memberId)] = item;
      }
      return acc;
    }, {});
  }

  if (value.photos && typeof value.photos === "object") {
    return value.photos;
  }

  if (typeof value === "object") {
    return value;
  }

  return {};
}

/**
 * PHASE 3B (automatic part only) — decide, for a given remote index, which
 * member photos THIS device should send and which it should receive.
 *
 * PHASE 3C CHANGE: photos that exist on both sides with DIFFERENT content
 * ("conflicts") are no longer auto-resolved by a version/updatedAt
 * tie-break here. A conflict must never be transferred automatically in
 * either direction — see getConflictDetails() below and
 * photoSyncManager.resolvePhotoConflict() for the user-driven resolution
 * path. toSend/toReceive below therefore only ever contain non-conflicting
 * members (photos that exist on exactly one side).
 *
 * Both devices call this independently with the other device's index;
 * because comparePhotoIndexes() is symmetric, device A's toSend will always
 * match device B's toReceive and vice versa for these non-conflicting
 * members — no extra negotiation round-trip is required for them.
 *
 * No files are touched and no network call is made here.
 */
export async function resolveSyncPlan(remoteIndex) {
  const comparison = await comparePhotoIndexes(remoteIndex);

  const toSend = new Set(comparison.localOnly);
  const toReceive = new Set(comparison.remoteOnly);

  // NOTE: comparison.different (i.e. conflicts) is intentionally NOT
  // folded into toSend/toReceive anymore. Conflicts are surfaced
  // separately (see `conflicts` below and getConflictDetails()) and are
  // only ever transferred after an explicit user decision.

  return {
    toSend: [...toSend].sort(),
    toReceive: [...toReceive].sort(),
    conflicts: [...comparison.different].sort(),
  };
}

/**
 * PHASE 3C — human-friendly detail for each conflicting member (same
 * memberId present on both sides, with different content), for the Sync
 * Preview / conflict-resolution UI.
 *
 * Deliberately does NOT include raw hashes — the UI should never need to
 * show a hash to the user; `updatedAt`/`version`/`fileName` are enough for
 * someone to understand "which photo is which" and make a decision.
 *
 * No files are touched and no network call is made here.
 */
export async function getConflictDetails(remoteIndex) {
  const localIndex = await readIndex();
  const localPhotos = localIndex.photos || {};
  const remotePhotos = normalizePhotos(remoteIndex);

  const comparison = await comparePhotoIndexes(remoteIndex);

  return comparison.different.map((id) => {
    const local = localPhotos[id] || null;
    const remote = remotePhotos[id] || null;

    return {
      memberId: id,
      local: local
        ? {
            fileName: local.fileName || `${id}.jpg`,
            version: Number(local.version) || 1,
            updatedAt: local.updatedAt || null,
          }
        : null,
      remote: remote
        ? {
            fileName: remote.fileName || `${id}.jpg`,
            version: Number(remote.version) || 1,
            updatedAt: remote.updatedAt || null,
          }
        : null,
    };
  });
}

/**
 * Lightweight consistency check.
 * It checks one indexed photo against the actual Filesystem file.
 */
export async function checkPhotoConsistency(memberId) {
  const metadata = await getPhotoMetadata(memberId);

  if (!metadata) {
    return {
      memberId: String(memberId),
      indexed: false,
      fileExists: false,
      consistent: true,
      reason: "no-metadata",
    };
  }

  try {
    await Filesystem.stat({
      path: metadata.path,
      directory: STORAGE_DIRECTORY,
    });

    return {
      memberId: String(memberId),
      indexed: true,
      fileExists: true,
      consistent: true,
      reason: "ok",
      metadata,
    };
  } catch {
    return {
      memberId: String(memberId),
      indexed: true,
      fileExists: false,
      consistent: false,
      reason: "indexed-file-missing",
      metadata,
    };
  }
}