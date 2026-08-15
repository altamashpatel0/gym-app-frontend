// src/pages/photo-sync/PhotoSync.jsx
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  CircleAlert,
  Link2,
  Loader2,
  RefreshCw,
  Smartphone,
  Unplug,
  Wifi,
} from "lucide-react";
import toast from "react-hot-toast";
import AppLayout from "../../components/layout/AppLayout";
import {
  addConflictResponder,
  addSyncListener,
  calculateSyncPreview,
  cancelActiveTransfer,
  connectToPeer,
  discoverPeers,
  disconnect,
  exchangePhotoIndex,
  getDeviceIdentity,
  resolvePhotoConflict,
  runFullPhotoSync,
  startHost,
  stopDiscovery,
} from "../../utils/photoSync/photoSyncManager";
import { getMemberPhoto } from "../../utils/memberPhotoStorage";

const initialPreview = {
  alreadySynced: 0,
  toSend: 0,
  toReceive: 0,
  conflicts: 0,
  conflictDetails: [],
  details: null,
};

function formatUpdatedAt(value) {
  if (!value) return "Unknown date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PhotoSync() {
  const [status, setStatus] = useState("IDLE");
  const [device, setDevice] = useState(null);
  const [hostSession, setHostSession] = useState(null);
  const [peers, setPeers] = useState([]);
  const [connectedPeer, setConnectedPeer] = useState(null);
  const [remoteIndex, setRemoteIndex] = useState(null);
  const [preview, setPreview] = useState(initialPreview);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [transferState, setTransferState] = useState(null);

  // PHASE 3C — conflict resolution state (session-only; recalculated from
  // scratch on every new sync, never persisted).
  const [resolvedConflicts, setResolvedConflicts] = useState({});
  const [resolvingMemberId, setResolvingMemberId] = useState(null);
  const [bulkResolving, setBulkResolving] = useState(false);
  const [localPreviews, setLocalPreviews] = useState({});

  const statusText = useMemo(() => {
    const map = {
      IDLE: "Ready to sync",
      WAITING_FOR_PEER: "Waiting for another device…",
      DISCOVERING: "Searching for nearby GymOps devices…",
      CONNECTING: "Connecting…",
      CONNECTED: "Connected",
      EXCHANGING_INDEX: "Comparing photo indexes…",
      PREVIEW_READY: "Sync preview ready",
      TRANSFERRING: "Transferring photos…",
      SYNC_COMPLETE: "Photo sync complete",
      CANCELLED: "Sync cancelled",
      DISCONNECTED: "Device disconnected",
      ERROR: "Connection error",
    };
    return map[status] || status;
  }, [status]);

  useEffect(() => {
    getDeviceIdentity().then(setDevice).catch(() => {});

    const listeners = [];

    listeners.push(
      addSyncListener("peerFound", (event) => {
        const peer = event;
        setPeers((current) => {
          const key = `${peer.host}:${peer.port}`;
          if (current.some((item) => `${item.host}:${item.port}` === key)) {
            return current;
          }
          return [...current, peer];
        });
      })
    );

    listeners.push(
      addSyncListener("hostReady", () => {
        setStatus("WAITING_FOR_PEER");
        setBusy(false);
      })
    );

    listeners.push(
      addSyncListener("connected", async (event) => {
        setConnectedPeer(event);
        setStatus("EXCHANGING_INDEX");

        try {
          await exchangePhotoIndex();
        } catch (error) {
          setStatus("ERROR");
          toast.error(error?.message || "Could not exchange photo index");
        }
      })
    );

    listeners.push(
      addSyncListener("indexReceived", async (event) => {
        try {
          setRemoteIndex(event.index);
          const result = await calculateSyncPreview(event.index);
          setPreview(result);
          setResolvedConflicts({});
          setStatus("PREVIEW_READY");
        } catch (error) {
          setStatus("ERROR");
          toast.error(error?.message || "Could not calculate sync preview");
        }
      })
    );

    // PHASE 3C — honor the peer's USE_REMOTE conflict decisions for the
    // whole session. This only ever reads and sends THIS device's own
    // existing photo file; it never writes or replaces anything locally,
    // so it's safe to keep active for the life of the connection.
    listeners.push(addConflictResponder());

    listeners.push(
      addSyncListener("disconnected", () => {
        setConnectedPeer(null);
        setRemoteIndex(null);
        setResolvedConflicts({});
        setResolvingMemberId(null);
        setBulkResolving(false);
        setStatus("DISCONNECTED");
      })
    );

    listeners.push(
      addSyncListener("connectionError", (event) => {
        setBusy(false);
        setStatus("ERROR");
        toast.error(event?.message || "Connection failed");
      })
    );

    return () => {
      listeners.forEach((listener) => {
        try {
          listener?.remove?.();
        } catch {}
      });
      cancelActiveTransfer().catch(() => {});
      stopDiscovery().catch(() => {});
      disconnect().catch(() => {});
    };
  }, []);

  const handleStartHost = async () => {
    try {
      setBusy(true);
      setPeers([]);
      setPreview(initialPreview);
      setStatus("WAITING_FOR_PEER");
      const session = await startHost();
      setHostSession(session);
    } catch (error) {
      setBusy(false);
      setStatus("ERROR");
      toast.error(error?.message || "Could not start sync host");
    }
  };

  const handleDiscover = async () => {
    try {
      setBusy(true);
      setPeers([]);
      setPreview(initialPreview);
      setStatus("DISCOVERING");
      await discoverPeers();
      setBusy(false);
    } catch (error) {
      setBusy(false);
      setStatus("ERROR");
      toast.error(error?.message || "Could not search for devices");
    }
  };

  const handleConnect = async (peer) => {
    if (!peer?.sessionToken) {
      toast.error("No temporary pairing token was advertised by this device.");
      return;
    }

    try {
      setBusy(true);
      setStatus("CONNECTING");
      await connectToPeer(peer, peer.sessionToken);
    } catch (error) {
      setBusy(false);
      setStatus("ERROR");
      toast.error(error?.message || "Connection failed");
    }
  };

  const handleCancel = async () => {
    setBusy(false);
    setSyncing(false);
    setPeers([]);
    setConnectedPeer(null);
    setRemoteIndex(null);
    setPreview(initialPreview);
    setTransferState(null);
    setResolvedConflicts({});
    setResolvingMemberId(null);
    setBulkResolving(false);

    await cancelActiveTransfer().catch(() => {});
    await stopDiscovery().catch(() => {});
    await disconnect().catch(() => {});
    setStatus("CANCELLED");
  };

  const handleTransferPhotos = async () => {
    if (!remoteIndex) return;

    try {
      setSyncing(true);
      setStatus("TRANSFERRING");
      setTransferState({
        totalCount: 0,
        transferredCount: 0,
        percentOverall: 0,
        errors: [],
      });

      const result = await runFullPhotoSync(remoteIndex, {
        onProgress: setTransferState,
      });

      setSyncing(false);
      setStatus(result.cancelled ? "CANCELLED" : "SYNC_COMPLETE");

      if (result.cancelled) {
        toast("Photo sync cancelled");
      } else if (result.errors?.length) {
        toast.error(`${result.errors.length} photo(s) failed to sync`);
      } else {
        toast.success("Photo sync complete");
      }
    } catch (error) {
      setSyncing(false);
      setStatus("ERROR");
      toast.error(error?.message || "Photo sync failed");
    }
  };

  const handleCancelTransfer = async () => {
    await cancelActiveTransfer().catch(() => {});
  };

  // PHASE 3C — load this device's own existing photo for each conflicting
  // member so the UI can show a real "Local photo" thumbnail. The remote
  // photo is intentionally NOT fetched here — downloading the full image
  // just for a preview would mean transferring it before the user has
  // decided anything, which is exactly what this feature must not do.
  useEffect(() => {
    const memberIds = (preview.conflictDetails || []).map((c) => c.memberId);
    if (memberIds.length === 0) return;

    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        memberIds.map(async (memberId) => {
          try {
            const dataUrl = await getMemberPhoto(memberId);
            return [memberId, dataUrl];
          } catch {
            return [memberId, null];
          }
        })
      );

      if (!cancelled) {
        setLocalPreviews((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preview.conflictDetails]);

  const unresolvedConflicts = (preview.conflictDetails || []).filter(
    (conflict) => !resolvedConflicts[conflict.memberId]
  );

  const handleResolveConflict = async (memberId, decision) => {
    setResolvingMemberId(memberId);

    try {
      await resolvePhotoConflict(memberId, decision);
      setResolvedConflicts((current) => ({ ...current, [memberId]: decision }));

      if (decision === "USE_REMOTE") {
        toast.success(`Member ${memberId}: using the other device's photo`);
      } else if (decision === "KEEP_LOCAL") {
        toast.success(`Member ${memberId}: kept this device's photo`);
      } else {
        toast(`Member ${memberId}: conflict skipped`);
      }
    } catch (error) {
      toast.error(
        error?.message || `Could not resolve the photo conflict for member ${memberId}`
      );
    } finally {
      setResolvingMemberId(null);
    }
  };

  const handleResolveAllConflicts = async (decision) => {
    setBulkResolving(true);

    try {
      for (const conflict of unresolvedConflicts) {
        // Sequential on purpose — resolvePhotoConflict()'s USE_REMOTE path
        // relies on being the only active "photoOffer" listener for its
        // memberId at a time; running these concurrently would let two
        // offers race against each other on the same connection.
        // eslint-disable-next-line no-await-in-loop
        await handleResolveConflict(conflict.memberId, decision);
      }
    } finally {
      setBulkResolving(false);
    }
  };

  return (
    <AppLayout title="Photo Sync">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold text-white">Photo Sync</h1>
          <p className="mt-1 text-sm text-gray-400">
            Transfer member photos directly between trusted devices on the same
            local network. No internet connection or cloud storage is used —
            photos move device-to-device only while both devices stay
            connected.
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-surface-card p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand-500/10 p-3 text-brand-400">
              <Smartphone size={22} />
            </div>
            <div>
              <div className="text-sm font-medium text-white">
                This Device
              </div>
              <div className="text-xs text-gray-400">
                {device?.deviceName || "GymOps Device"}
              </div>
              <div className="mt-1 break-all text-[11px] text-gray-500">
                {device?.deviceId || "Generating device ID…"}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-surface-card p-5">
          <div className="flex items-center gap-3">
            <Wifi size={20} className="text-brand-400" />
            <div>
              <div className="text-sm font-medium text-white">
                Connection
              </div>
              <div className="text-sm text-gray-400">{statusText}</div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={handleStartHost}
              disabled={busy || status === "CONNECTED"}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && status === "WAITING_FOR_PEER" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Link2 size={16} />
              )}
              Start Sync
            </button>

            <button
              onClick={handleDiscover}
              disabled={busy || status === "CONNECTED"}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} />
              Find Device
            </button>

            {(busy ||
              syncing ||
              status === "WAITING_FOR_PEER" ||
              status === "DISCOVERING" ||
              status === "CONNECTING" ||
              status === "CONNECTED" ||
              status === "TRANSFERRING") && (
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 px-4 py-2.5 text-sm font-medium text-red-300 hover:bg-red-500/10"
              >
                <Unplug size={16} />
                Cancel
              </button>
            )}
          </div>

          {hostSession?.sessionToken && status === "WAITING_FOR_PEER" && (
            <div className="mt-5 rounded-xl border border-brand-500/20 bg-brand-500/5 p-4">
              <div className="text-xs uppercase tracking-wide text-brand-300">
                Temporary Sync Code
              </div>
              <div className="mt-2 break-all font-mono text-lg text-white">
                {hostSession.sessionToken}
              </div>
              <div className="mt-2 text-xs text-gray-400">
                This code is only for the current sync session. Do not reuse it
                later.
              </div>
            </div>
          )}

          {peers.length > 0 && status === "DISCOVERING" && (
            <div className="mt-5 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Nearby Devices
              </div>

              {peers.map((peer) => (
                <div
                  key={`${peer.host}:${peer.port}`}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="text-sm font-medium text-white">
                      {peer.deviceName || peer.serviceName}
                    </div>
                    <div className="text-xs text-gray-500">
                      Local network device
                    </div>
                  </div>

                  <button
                    onClick={() => handleConnect(peer)}
                    className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white"
                  >
                    Connect
                  </button>
                </div>
              ))}
            </div>
          )}

          {status === "DISCOVERING" && peers.length === 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-gray-500">
              No GymOps device found yet. Keep both phones on the same Wi-Fi or
              hotspot and wait a few seconds.
            </div>
          )}
        </section>

        {connectedPeer && (
          <section className="rounded-2xl border border-emerald-500/20 bg-surface-card p-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-emerald-400" size={20} />
              <div>
                <div className="text-sm font-medium text-white">
                  Connected
                </div>
                <div className="text-xs text-gray-400">
                  {connectedPeer.peerDeviceName || "GymOps Device"}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-surface-card p-5">
          <div className="flex items-center gap-2">
            <RefreshCw size={18} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-white">
              Sync Preview
            </h2>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              icon={<CheckCircle2 size={17} />}
              label="Already Synced"
              value={preview.alreadySynced}
            />
            <Stat
              icon={<ArrowUpFromLine size={17} />}
              label="To Send"
              value={preview.toSend}
            />
            <Stat
              icon={<ArrowDownToLine size={17} />}
              label="To Receive"
              value={preview.toReceive}
            />
            <Stat
              icon={<CircleAlert size={17} />}
              label="Conflicts"
              value={preview.conflicts}
            />
          </div>

          {status === "PREVIEW_READY" && !transferState && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {preview.toSend + preview.toReceive + preview.conflicts > 0 ? (
                <button
                  onClick={handleTransferPhotos}
                  disabled={syncing || Boolean(resolvingMemberId) || bulkResolving}
                  title={
                    resolvingMemberId || bulkResolving
                      ? "Finish resolving photo conflicts first"
                      : undefined
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={16} />
                  Transfer Photos
                </button>
              ) : (
                <div className="text-xs text-gray-500">
                  Both devices already have the same photos. Nothing to
                  transfer.
                </div>
              )}
            </div>
          )}

          {transferState && (
            <div className="mt-4 rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>
                  Syncing {transferState.transferredCount} /{" "}
                  {transferState.totalCount}
                </span>
                <span>{transferState.percentOverall}%</span>
              </div>

              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${transferState.percentOverall}%` }}
                />
              </div>

              {transferState.memberId && (
                <div className="mt-2 text-[11px] text-gray-500">
                  {transferState.direction === "send"
                    ? "Sending"
                    : "Receiving"}{" "}
                  photo for member {transferState.memberId}
                  {typeof transferState.itemPercent === "number"
                    ? ` — ${transferState.itemPercent}%`
                    : ""}
                </div>
              )}

              {transferState.errors?.length > 0 && (
                <div className="mt-3 space-y-1">
                  {transferState.errors.map((err, idx) => (
                    <div
                      key={`${err.memberId}-${idx}`}
                      className="flex items-center gap-1.5 text-[11px] text-red-300"
                    >
                      <CircleAlert size={12} />
                      Member {err.memberId}: {err.message || "Transfer failed"}
                    </div>
                  ))}
                </div>
              )}

              {syncing && (
                <button
                  onClick={handleCancelTransfer}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-400/20 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
                >
                  <Unplug size={14} />
                  Cancel Transfer
                </button>
              )}
            </div>
          )}
        </section>

        {preview.conflictDetails?.length > 0 && (
          <section className="rounded-2xl border border-amber-500/20 bg-surface-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CircleAlert size={18} className="text-amber-400" />
                <h2 className="text-sm font-semibold text-white">
                  Photo Conflicts
                </h2>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                  {unresolvedConflicts.length} of {preview.conflictDetails.length}{" "}
                  unresolved
                </span>
              </div>

              {unresolvedConflicts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleResolveAllConflicts("KEEP_LOCAL")}
                    disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Keep All Local
                  </button>
                  <button
                    onClick={() => handleResolveAllConflicts("USE_REMOTE")}
                    disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use All Remote
                  </button>
                  <button
                    onClick={() => handleResolveAllConflicts("SKIP")}
                    disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Skip All
                  </button>
                </div>
              )}
            </div>

            <p className="mt-2 text-xs text-gray-400">
              Both devices have a photo for these members, and the photos are
              different. Nothing is transferred until you choose an option
              for each one below.
            </p>

            <div className="mt-4 space-y-4">
              {preview.conflictDetails.map((conflict) => {
                const resolution = resolvedConflicts[conflict.memberId];
                const isResolving = resolvingMemberId === conflict.memberId;
                const localPreviewUrl = localPreviews[conflict.memberId];

                return (
                  <div
                    key={conflict.memberId}
                    className="rounded-xl border border-white/10 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-white">
                        Member #{conflict.memberId}
                      </div>

                      {resolution && (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                          <CheckCircle2 size={13} />
                          {resolution === "USE_REMOTE"
                            ? "Using remote photo"
                            : resolution === "KEEP_LOCAL"
                            ? "Kept local photo"
                            : "Skipped"}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          Local Photo
                        </div>
                        <div className="mt-1.5 flex h-24 w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/20">
                          {localPreviewUrl ? (
                            <img
                              src={localPreviewUrl}
                              alt={`Local photo for member ${conflict.memberId}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Smartphone size={20} className="text-gray-600" />
                          )}
                        </div>
                        <div className="mt-1.5 text-[11px] text-gray-500">
                          Updated: {formatUpdatedAt(conflict.local?.updatedAt)}
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                          Remote Photo
                        </div>
                        <div className="mt-1.5 flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 text-center">
                          <div className="px-2 text-[11px] text-gray-500">
                            Preview not downloaded yet
                          </div>
                        </div>
                        <div className="mt-1.5 text-[11px] text-gray-500">
                          Updated: {formatUpdatedAt(conflict.remote?.updatedAt)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() =>
                          handleResolveConflict(conflict.memberId, "KEEP_LOCAL")
                        }
                        disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isResolving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : null}
                        Keep Local
                      </button>
                      <button
                        onClick={() =>
                          handleResolveConflict(conflict.memberId, "USE_REMOTE")
                        }
                        disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isResolving ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : null}
                        Use Remote
                      </button>
                      <button
                        onClick={() =>
                          handleResolveConflict(conflict.memberId, "SKIP")
                        }
                        disabled={syncing || bulkResolving || Boolean(resolvingMemberId)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/10 p-4">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}
