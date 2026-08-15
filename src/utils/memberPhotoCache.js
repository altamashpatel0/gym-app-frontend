import { Filesystem, Directory } from "@capacitor/filesystem";

const CACHE_DIR = "member-photo-cache";

function safeKey(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Returns a stable cache key for a member photo.
 *
 * Prefer photo_key / storage_key / photo URL so a newly uploaded
 * photo gets a different cache entry.
 */
export function getMemberPhotoCacheKey(member) {
  const identity =
    member?.photo_key ||
    member?.photo_storage_key ||
    member?.storage_key ||
    member?.photo_url;

  if (!identity) return null;

  return safeKey(identity);
}

async function ensureCacheDirectory() {
  try {
    await Filesystem.mkdir({
      path: CACHE_DIR,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch (error) {
    // Directory already exists — safe to ignore.
  }
}

export async function getCachedMemberPhoto(member) {
  const key = getMemberPhotoCacheKey(member);

  if (!key) return null;

  try {
    await ensureCacheDirectory();

    const result = await Filesystem.readFile({
      path: `${CACHE_DIR}/${key}`,
      directory: Directory.Cache,
    });

    if (!result?.data) return null;

    return `data:image/jpeg;base64,${result.data}`;
  } catch {
    return null;
  }
}

export async function cacheMemberPhoto(member) {
  const key = getMemberPhotoCacheKey(member);
  const url = member?.photo_url;

  if (!key || !url) return null;

  try {
    await ensureCacheDirectory();

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Photo download failed: ${response.status}`);
    }

    const blob = await response.blob();

    const mimeType = blob.type || "image/jpeg";

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    const base64 = btoa(binary);

    await Filesystem.writeFile({
      path: `${CACHE_DIR}/${key}`,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.warn("[MemberPhotoCache] Failed to cache photo:", error);
    return null;
  }
}