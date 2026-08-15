// src/utils/memberPhotoIndex.js
//
// PHASE 2 — Persistent local photo index.
// This file stores METADATA ONLY. Actual photos remain in:
//   member-photos/{memberId}.jpg
//
// No B2, Cloudinary, backend, Neon, LAN, hotspot or network sync is used here.

import { Filesystem, Directory } from "@capacitor/filesystem";

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

async function writeIndex(index) {
  await ensureIndexDir();

  const safeIndex = {
    version: INDEX_VERSION,
    photos:
      index?.photos && typeof index.photos === "object"
        ? index.photos
        : {},
  };

  await Filesystem.writeFile({
    path: INDEX_PATH,
    data: JSON.stringify(safeIndex),
    directory: STORAGE_DIRECTORY,
  });

  return safeIndex;
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
}

export async function removePhotoMetadata(memberId) {
  if (!memberId) return false;

  const key = String(memberId);
  const index = await readIndex();

  if (!Object.prototype.hasOwnProperty.call(index.photos, key)) {
    return false;
  }

  delete index.photos[key];
  await writeIndex(index);
  return true;
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