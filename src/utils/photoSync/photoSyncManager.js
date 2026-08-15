// src/utils/photoSync/photoSyncManager.js
// PHASE 3A: LAN discovery, pairing and photo-index exchange.
// No photo bytes are transferred in Phase 3A.

import { registerPlugin } from "@capacitor/core";
import {
  getPhotoIndex,
  comparePhotoIndexes,
  resolveSyncPlan,
  getPhotoMetadata,
  getConflictDetails,
} from "../memberPhotoIndex";
import { registerSyncedPhoto } from "../memberPhotoStorage";

const LocalLanSync = registerPlugin("LocalLanSync");

const DEVICE_KEY = "gymops_sync_device_identity_v1";

function randomId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getDeviceIdentity() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);

    if (existing) {
      return JSON.parse(existing);
    }
  } catch {}

  const identity = {
    deviceId: randomId(),
    deviceName: "GymOps Device",
  };

  try {
    localStorage.setItem(
      DEVICE_KEY,
      JSON.stringify(identity)
    );
  } catch {}

  return identity;
}

export async function setDeviceName(deviceName) {
  const identity = await getDeviceIdentity();

  const next = {
    ...identity,
    deviceName:
      String(deviceName || "GymOps Device").trim() ||
      "GymOps Device",
  };

  try {
    localStorage.setItem(
      DEVICE_KEY,
      JSON.stringify(next)
    );
  } catch {}

  return next;
}

export async function startHost() {
  const identity = await getDeviceIdentity();

  return LocalLanSync.startHost({
    deviceName: identity.deviceName,
  });
}

export async function discoverPeers() {
  return LocalLanSync.discover();
}

export async function stopDiscovery() {
  return LocalLanSync.stopDiscovery();
}

export async function connectToPeer(peer, sessionToken) {
  return LocalLanSync.connect({
    host: peer.host,
    port: peer.port,
    sessionToken: sessionToken || peer.sessionToken,
  });
}

export async function disconnect() {
  return LocalLanSync.disconnect();
}

export async function exchangePhotoIndex() {
  const index = await getPhotoIndex();

  await LocalLanSync.sendIndex({
    index,
  });

  return index;
}

export async function calculateSyncPreview(remoteIndex) {
  const comparison = await comparePhotoIndexes(remoteIndex);
  const conflictDetails = await getConflictDetails(remoteIndex);

  return {
    alreadySynced: comparison.same.length,
    toSend: comparison.localOnly.length,
    toReceive: comparison.remoteOnly.length,
    conflicts: comparison.different.length,
    conflictDetails,
    details: comparison,
  };
}

export function addSyncListener(eventName, listener) {
  return LocalLanSync.addListener(
    eventName,
    listener
  );
}

// =============================================================
// PHASE 3B — actual photo file transfer
// =============================================================

/**
 * Accept an incoming photo offer (fires the peer's queued binary transfer).
 */
export async function acceptIncomingPhoto(memberId) {
  return LocalLanSync.acceptPhoto({ memberId: String(memberId) });
}

/**
 * Decline an incoming photo offer.
 */
export async function rejectIncomingPhoto(memberId, reason) {
  return LocalLanSync.rejectPhoto({
    memberId: memberId != null ? String(memberId) : "",
    reason: reason || "Not part of this sync",
  });
}

/**
 * Send a single local photo to the paired peer. Resolves only once the
 * peer has confirmed (via hash-verified save) that the photo landed, or
 * rejects with the reason it didn't.
 */
export async function sendPhotoFile(metadata) {
  return LocalLanSync.sendPhoto({
    memberId: String(metadata.memberId),
    fileName: metadata.fileName || `${metadata.memberId}.jpg`,
    hash: metadata.hash || "",
    version: Number(metadata.version) || 1,
    updatedAt: metadata.updatedAt || "",
  });
}

/**
 * Cancel whichever photo transfer (send or receive) is currently active.
 */
export async function cancelActiveTransfer() {
  return LocalLanSync.cancelTransfer();
}

// =============================================================
// PHASE 3C — user-controlled conflict resolution
//
// A "conflict" is a member whose photo exists on BOTH devices with
// DIFFERENT content (see memberPhotoIndex.getConflictDetails()). These are
// intentionally excluded from resolveSyncPlan()'s automatic toSend/toReceive
// lists (see memberPhotoIndex.resolveSyncPlan) and are NEVER transferred in
// either direction until the person using the app explicitly decides what
// to do, via resolvePhotoConflict() below.
// =============================================================

/**
 * Tell the paired peer what this device decided for a conflicting member,
 * without waiting for any resulting transfer. Exposed separately from
 * resolvePhotoConflict() in case a caller wants fire-and-forget semantics
 * (e.g. a "Keep All Local" bulk action that shouldn't block on network
 * round-trips it doesn't care about).
 */
export async function sendConflictDecision(memberId, decision) {
  return LocalLanSync.sendConflictDecision({
    memberId: String(memberId),
    decision,
  });
}

/**
 * Resolve a single member's photo conflict for this sync session.
 *
 *   KEEP_LOCAL — keep this device's photo untouched. Nothing is sent or
 *                received for this member. The peer is informed purely so
 *                its UI can mark the conflict resolved too; that message
 *                never triggers a transfer.
 *
 *   SKIP       — identical to KEEP_LOCAL in terms of file safety (no
 *                transfer either direction), kept as a distinct decision
 *                so the UI/analytics can tell "I chose to keep mine" apart
 *                from "I don't want to decide right now".
 *
 *   USE_REMOTE — ask the peer to push ITS copy of this member's photo.
 *                The peer's photoSyncManager reacts to the resulting
 *                "photoConflictDecision" event by calling its own
 *                sendPhotoFile() for this member — i.e. this reuses the
 *                existing Phase 3B photoOffer/photoAccept/binary-chunk/
 *                hash-verify pipeline unchanged. This device auto-accepts
 *                the resulting offer (since it just explicitly asked for
 *                it) and only replaces its local photo once
 *                LocalLanSyncPlugin#handlePhotoComplete has verified size
 *                + SHA-256 and atomically moved the file into place, and
 *                registerSyncedPhoto() has updated the local metadata
 *                index. If verification fails, the connection drops, or
 *                the user cancels, this device's existing photo is left
 *                completely untouched — see LocalLanSyncPlugin.java.
 *
 * IMPORTANT: resolvePhotoConflict() should not be called at the same time
 * as runFullPhotoSync() for the *same connection* — both would register
 * their own "photoOffer" listeners, and runFullPhotoSync()'s listener
 * would reject any offer for a memberId outside its own (non-conflict)
 * plan, racing with the accept this function is trying to perform. The
 * PhotoSync.jsx UI enforces this by disabling bulk transfer while any
 * conflict is being resolved, and vice versa.
 *
 * RACE SAFETY (USE_REMOTE): all listeners this function needs
 * (photoOffer/photoReceived/photoTransferError/photoTransferCancelled/
 * disconnected) and the timeout are registered/started BEFORE
 * sendConflictDecision() is called. The peer can react to
 * "photoConflictDecision" and emit "photoOffer" essentially immediately,
 * so listening only starts after the send would leave a window where that
 * offer could be missed. There is no polling and no artificial delay —
 * this is purely event-driven.
 */
export async function resolvePhotoConflict(memberId, decision, options = {}) {
  const { timeoutMs = 25000 } = options;
  const key = String(memberId);

  if (decision !== "KEEP_LOCAL" && decision !== "USE_REMOTE" && decision !== "SKIP") {
    throw new Error(`Unknown conflict decision: ${decision}`);
  }

  if (decision !== "USE_REMOTE") {
    // KEEP_LOCAL / SKIP: nothing to wait for, so the decision can just be
    // sent directly. The local photo is never touched, and we never ask
    // the peer for theirs.
    await sendConflictDecision(key, decision);
    return { memberId: key, decision, transferred: false };
  }

  // USE_REMOTE — register every listener the resulting exchange could hit
  // BEFORE sending the decision. The peer may react to
  // "photoConflictDecision" and call sendPhotoFile() (emitting
  // "photoOffer") essentially immediately, so if we sent the decision
  // first and registered listeners after, that offer could arrive and be
  // missed entirely. Registering first closes that window.
  return new Promise((resolve, reject) => {
    let settled = false;
    let offerHandled = false;
    const cleanups = [];
    let timer = null;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanups.forEach((listener) => {
        try {
          listener?.remove?.();
        } catch {}
      });
      fn();
    };

    cleanups.push(
      addSyncListener("photoOffer", (event) => {
        const offerMemberId = String(event?.memberId ?? "");
        if (offerMemberId !== key || offerHandled) return;
        offerHandled = true;

        acceptIncomingPhoto(key).catch((error) => {
          finish(() =>
            reject(error instanceof Error ? error : new Error(String(error)))
          );
        });
      })
    );

    cleanups.push(
      addSyncListener("photoReceived", async (event) => {
        const receivedMemberId = String(event?.memberId ?? "");
        if (receivedMemberId !== key) return;

        try {
          // Photo bytes are already verified + atomically written by
          // LocalLanSyncPlugin#handlePhotoComplete by the time this event
          // fires. This only updates the local metadata index and drops
          // the in-memory photo cache so the UI picks up the new file.
          await registerSyncedPhoto(key, {
            fileName: event?.fileName,
            version: event?.version,
            updatedAt: event?.updatedAt,
            hash: event?.hash,
          });
        } catch (error) {
          finish(() => reject(error));
          return;
        }

        finish(() => resolve({ memberId: key, decision, transferred: true }));
      })
    );

    cleanups.push(
      addSyncListener("photoTransferError", (event) => {
        const erroredMemberId = event?.memberId ? String(event.memberId) : "";
        if (erroredMemberId && erroredMemberId !== key) return;

        finish(() =>
          reject(new Error(event?.message || "Failed to receive peer's photo"))
        );
      })
    );

    cleanups.push(
      addSyncListener("photoTransferCancelled", (event) => {
        const cancelledMemberId = event?.memberId ? String(event.memberId) : "";
        if (cancelledMemberId && cancelledMemberId !== key) return;

        finish(() => reject(new Error("Transfer cancelled")));
      })
    );

    cleanups.push(
      addSyncListener("disconnected", () => {
        finish(() => reject(new Error("Device disconnected")));
      })
    );

    // Start the timeout only once listeners are live, then send the
    // decision. If sending itself fails, tear everything down and reject
    // — there is nothing left to listen for.
    timer = setTimeout(() => {
      finish(() =>
        reject(new Error(`Timed out waiting for member ${key}'s photo from peer`))
      );
    }, timeoutMs);

    sendConflictDecision(key, decision).catch((error) => {
      finish(() =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
    });
  });
}

/**
 * Listen for the peer's conflict decisions for the lifetime of a connected
 * session. The only decision that requires action here is USE_REMOTE: the
 * peer is asking THIS device to push its own copy of the member's photo,
 * which is safe to honor unconditionally — it only ever reads and sends
 * this device's existing file, it never writes or replaces anything
 * locally. KEEP_LOCAL/SKIP are informational only (e.g. for UI logging)
 * and never trigger any action here.
 *
 * Meant to be wired up once per connected session (e.g. in PhotoSync.jsx's
 * top-level effect), separate from — and safe to run alongside —
 * runFullPhotoSync(), since it never touches "photoOffer" itself.
 */
export function addConflictResponder() {
  return addSyncListener("photoConflictDecision", async (event) => {
    const memberId = String(event?.memberId ?? "");
    const decision = event?.decision;

    if (!memberId || decision !== "USE_REMOTE") return;

    try {
      const metadata = await getPhotoMetadata(memberId);
      if (!metadata) return; // We don't actually have this photo — nothing to send.

      await sendPhotoFile(metadata);
    } catch {
      // The peer's resolvePhotoConflict() call will simply time out /
      // surface a "photoTransferError" — nothing further to do here.
    }
  });
}

/**
 * Run the full bidirectional photo transfer for this sync session.
 *
 * `remoteIndex` is the peer's photo index, already exchanged during Phase
 * 3A (see exchangePhotoIndex / the "indexReceived" event). Both devices
 * call this independently with their own view of the same pair: device A's
 * toSend list is device B's toReceive list and vice versa (resolveSyncPlan
 * is a deterministic, symmetric function of both indexes), so the two
 * sides don't need to explicitly negotiate who sends what — each side just
 * pushes its own toSend list and accepts offers that match its own
 * toReceive list.
 *
 * `onProgress` is called repeatedly with an overall + per-item progress
 * snapshot so the UI can render something like "Syncing 4 / 20 — 20%".
 *
 * Resolves with { transferredCount, errors, cancelled } once every photo
 * in the plan has either transferred successfully or failed/settled.
 */
export async function runFullPhotoSync(remoteIndex, { onProgress } = {}) {
  const plan = await resolveSyncPlan(remoteIndex);
  const totalCount = plan.toSend.length + plan.toReceive.length;

  const state = {
    transferredCount: 0,
    errors: [],
    cancelled: false,
  };

  const emit = (extra) => {
    onProgress?.({
      totalCount,
      transferredCount: state.transferredCount,
      percentOverall:
        totalCount > 0
          ? Math.round((state.transferredCount / totalCount) * 100)
          : 100,
      errors: [...state.errors],
      ...extra,
    });
  };

  if (totalCount === 0) {
    emit({ phase: "DONE", state: "COMPLETE" });
    return state;
  }

  emit({ phase: "START", state: "RUNNING" });

  const toReceiveSet = new Set(plan.toReceive);
  const settledReceives = new Set();

  let resolveReceiveWait;
  const receiveWaitPromise = new Promise((resolve) => {
    resolveReceiveWait = resolve;
  });

  const checkReceiveComplete = () => {
    if (settledReceives.size >= toReceiveSet.size) {
      resolveReceiveWait();
    }
  };

  if (toReceiveSet.size === 0) {
    resolveReceiveWait();
  }

  const cleanups = [];

  cleanups.push(
    addSyncListener("photoOffer", (event) => {
      const memberId = String(event?.memberId ?? "");

      if (state.cancelled) {
        rejectIncomingPhoto(memberId, "Sync cancelled").catch(() => {});
        return;
      }

      if (!toReceiveSet.has(memberId)) {
        // Not part of this device's plan (e.g. stale offer) — decline it
        // rather than silently accepting an unplanned write.
        rejectIncomingPhoto(memberId, "Not part of this sync").catch(() => {});
        return;
      }

      acceptIncomingPhoto(memberId).catch((error) => {
        if (!settledReceives.has(memberId)) {
          settledReceives.add(memberId);
          state.errors.push({
            memberId,
            direction: "receive",
            message: error?.message || "Failed to accept incoming photo",
          });
          emit({ phase: "ERROR", direction: "receive", memberId });
          checkReceiveComplete();
        }
      });
    })
  );

  cleanups.push(
    addSyncListener("photoReceiveProgress", (event) => {
      emit({
        phase: "TRANSFERRING",
        direction: "receive",
        memberId: String(event?.memberId ?? ""),
        itemSent: event?.received,
        itemTotal: event?.total,
        itemPercent: event?.percent,
      });
    })
  );

  cleanups.push(
    addSyncListener("photoSendProgress", (event) => {
      emit({
        phase: "TRANSFERRING",
        direction: "send",
        memberId: String(event?.memberId ?? ""),
        itemSent: event?.sent,
        itemTotal: event?.total,
        itemPercent: event?.percent,
      });
    })
  );

  cleanups.push(
    addSyncListener("photoReceived", async (event) => {
      const memberId = String(event?.memberId ?? "");

      if (!toReceiveSet.has(memberId) || settledReceives.has(memberId)) {
        return;
      }

      try {
        await registerSyncedPhoto(memberId, {
          fileName: event?.fileName,
          version: event?.version,
          updatedAt: event?.updatedAt,
          hash: event?.hash,
        });
      } catch (error) {
        state.errors.push({
          memberId,
          direction: "receive",
          message: error?.message || "Failed to record synced photo",
        });
      }

      settledReceives.add(memberId);
      state.transferredCount += 1;
      emit({ phase: "ITEM_DONE", direction: "receive", memberId });
      checkReceiveComplete();
    })
  );

  cleanups.push(
    addSyncListener("photoTransferError", (event) => {
      const memberId = String(event?.memberId ?? "");

      if (toReceiveSet.has(memberId) && !settledReceives.has(memberId)) {
        settledReceives.add(memberId);
        checkReceiveComplete();
      }

      state.errors.push({ memberId, message: event?.message || "Transfer failed" });
      emit({ phase: "ERROR", memberId });
    })
  );

  cleanups.push(
    addSyncListener("photoTransferCancelled", () => {
      state.cancelled = true;
      resolveReceiveWait();
    })
  );

  const runSendLoop = async () => {
    for (const memberId of plan.toSend) {
      if (state.cancelled) break;

      const metadata = await getPhotoMetadata(memberId);

      if (!metadata) {
        state.errors.push({
          memberId,
          direction: "send",
          message: "Missing local photo metadata",
        });
        emit({ phase: "ERROR", direction: "send", memberId });
        continue;
      }

      try {
        await sendPhotoFile(metadata);
        state.transferredCount += 1;
        emit({ phase: "ITEM_DONE", direction: "send", memberId });
      } catch (error) {
        state.errors.push({
          memberId,
          direction: "send",
          message: error?.message || "Send failed",
        });
        emit({ phase: "ERROR", direction: "send", memberId });
      }
    }
  };

  try {
    await Promise.all([runSendLoop(), receiveWaitPromise]);
  } finally {
    cleanups.forEach((listener) => {
      try {
        listener?.remove?.();
      } catch {}
    });
  }

  emit({ phase: "DONE", state: state.cancelled ? "CANCELLED" : "COMPLETE" });

  return state;
}