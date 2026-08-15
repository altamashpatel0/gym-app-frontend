package com.gym.management.tool.sync;

import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

import org.json.JSONObject;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;

import java.nio.charset.StandardCharsets;

import java.security.MessageDigest;

import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Phase 3A: LAN discovery, pairing and photo-index exchange (unchanged
 * behaviourally from the caller's point of view — startHost/discover/
 * connect/sendIndex/stopDiscovery/disconnect all keep the same JS-facing
 * signatures and events).
 *
 * Phase 3B adds actual JPG photo transfer over the same paired LAN
 * connection. Because a single raw base64 photo no longer fits comfortably
 * in one line-delimited JSON message, the wire protocol underneath this
 * plugin was changed from newline-delimited JSON to a simple length-prefixed
 * binary framing:
 *
 *   [1 byte frame type][4 byte big-endian length][payload]
 *
 * Frame type 0x01 (CONTROL) carries UTF-8 JSON, used for everything that was
 * previously sent as a JSON line (hello/pairing, index exchange) plus the
 * new photo-transfer control messages (photoOffer/photoAccept/photoReject/
 * photoComplete/photoAck/photoNack/cancelTransfer/photoError), plus the
 * Phase 3C conflict-resolution relay message (photoConflictDecision). The
 * plugin does not resolve conflicts itself — it only relays the decision
 * JS already made; see LocalLanSyncPlugin#sendConflictDecision and the
 * "photoConflictDecision" case in listenForMessages().
 *
 * Frame type 0x02 (CHUNK) carries a raw slice of JPG bytes for the photo
 * currently being streamed. Chunks are never wrapped in JSON/base64, so a
 * large photo never has to be materialized as one huge string.
 */
@CapacitorPlugin(name = "LocalLanSync")
public class LocalLanSyncPlugin extends Plugin {

    private static final String SERVICE_TYPE = "_gymops-sync._tcp.";
    private static final String PROTOCOL = "gymops-photo-sync";
    private static final int PROTOCOL_VERSION = 1;

    private static final int CONNECT_TIMEOUT = 5000;

    private static final byte FRAME_CONTROL = 0x01;
    private static final byte FRAME_CHUNK = 0x02;

    // Generous cap on any single frame (control JSON or one chunk). Chunks
    // are always CHUNK_SIZE or smaller; this mainly guards against a
    // corrupted/hostile length prefix on an already-authenticated socket.
    private static final int MAX_FRAME_SIZE = 8 * 1024 * 1024;

    private static final int CHUNK_SIZE = 64 * 1024;

    private static final long OFFER_RESPONSE_TIMEOUT_MS = 20_000;
    private static final long ACK_TIMEOUT_MS = 60_000;

    private NsdManager nsdManager;
    private NsdManager.RegistrationListener registrationListener;
    private NsdManager.DiscoveryListener discoveryListener;

    private ServerSocket serverSocket;
    private Socket activeSocket;

    // Streams for the current paired connection. Populated once pairing
    // succeeds (either as host or as connecting peer) and cleared on
    // disconnect.
    private DataOutputStream out;
    private DataInputStream in;
    private final Object writeLock = new Object();

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String currentSessionToken;
    private String currentDeviceName;

    // ---- Incoming photo offer awaiting a JS-side accept/reject decision ---
    private volatile String pendingOfferMemberId;
    private volatile JSONObject pendingOfferMeta;

    // ---- State for a photo currently being received from the peer -------
    private volatile String receivingMemberId;
    private volatile JSONObject receivingOffer;
    private FileOutputStream receivingStream;
    private File receivingTempFile;
    private MessageDigest receivingDigest;
    private volatile long receivingBytesWritten;
    private final AtomicBoolean receivingCancelled = new AtomicBoolean(false);

    // ---- State for a photo currently being sent to the peer --------------
    private volatile String sendingMemberId;
    private final AtomicBoolean sendingCancelled = new AtomicBoolean(false);

    private final LinkedBlockingQueue<String> offerResponseQueue = new LinkedBlockingQueue<>();
    private final LinkedBlockingQueue<String> completeAckQueue = new LinkedBlockingQueue<>();

    @Override
    public void load() {
        super.load();
        nsdManager = (NsdManager) getContext().getSystemService(NsdManager.class);
    }

    // =========================================================
    // START HOST
    // =========================================================

    @PluginMethod
    public void startHost(PluginCall call) {
        String deviceName = call.getString("deviceName");

        if (deviceName == null || deviceName.trim().isEmpty()) {
            deviceName = "GymOps Device";
        }

        final String finalDeviceName = deviceName.trim();
        final String sessionToken = UUID.randomUUID().toString().replace("-", "");

        currentSessionToken = sessionToken;
        currentDeviceName = finalDeviceName;

        stopHostInternal();

        executor.execute(() -> {
            try {
                ServerSocket server = new ServerSocket(0);
                serverSocket = server;

                int port = server.getLocalPort();

                registerService(finalDeviceName, port, sessionToken);

                JSObject result = new JSObject();
                result.put("deviceName", finalDeviceName);
                result.put("port", port);
                result.put("sessionToken", sessionToken);
                result.put("serviceType", SERVICE_TYPE);

                mainHandler.post(() -> call.resolve(result));

                while (!server.isClosed()) {
                    Socket socket = server.accept();

                    executor.execute(() ->
                            handleIncomingConnection(socket, sessionToken, finalDeviceName)
                    );
                }
            } catch (Exception e) {
                mainHandler.post(() ->
                        call.reject("Failed to start LAN host: " + e.getMessage(), e)
                );
            }
        });
    }

    // =========================================================
    // REGISTER NSD SERVICE
    // =========================================================

    private void registerService(String deviceName, int port, String sessionToken) {
        NsdServiceInfo serviceInfo = new NsdServiceInfo();

        serviceInfo.setServiceName(
                sanitizeName(deviceName) + "-" + UUID.randomUUID().toString().substring(0, 6)
        );
        serviceInfo.setServiceType(SERVICE_TYPE);
        serviceInfo.setPort(port);
        serviceInfo.setAttribute("protocol", PROTOCOL);
        serviceInfo.setAttribute("version", String.valueOf(PROTOCOL_VERSION));
        serviceInfo.setAttribute("token", sessionToken);

        registrationListener = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo info) {
                JSObject data = new JSObject();
                data.put("serviceName", info.getServiceName());
                data.put("port", info.getPort());
                notifyListeners("hostReady", data);
            }

            @Override
            public void onRegistrationFailed(NsdServiceInfo info, int errorCode) {
                JSObject data = new JSObject();
                data.put("errorCode", errorCode);
                data.put("message", "NSD registration failed");
                notifyListeners("hostError", data);
            }

            @Override
            public void onServiceUnregistered(NsdServiceInfo info) {
            }

            @Override
            public void onUnregistrationFailed(NsdServiceInfo info, int errorCode) {
            }
        };

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener);
    }

    // =========================================================
    // DISCOVER DEVICES
    // =========================================================

    @PluginMethod
    public void discover(PluginCall call) {
        stopDiscoveryInternal();

        discoveryListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String serviceType) {
                JSObject data = new JSObject();
                data.put("started", true);
                call.resolve(data);
                notifyListeners("discoveryStarted", data);
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (!SERVICE_TYPE.equals(serviceInfo.getServiceType())) {
                    return;
                }
                resolveService(serviceInfo);
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
                JSObject data = new JSObject();
                data.put("serviceName", serviceInfo.getServiceName());
                notifyListeners("peerLost", data);
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                JSObject data = new JSObject();
                data.put("errorCode", errorCode);
                notifyListeners("discoveryError", data);

                try {
                    nsdManager.stopServiceDiscovery(this);
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
            }
        };

        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener);
        } catch (Exception e) {
            call.reject("Failed to start discovery: " + e.getMessage(), e);
        }
    }

    // =========================================================
    // RESOLVE DEVICE
    // =========================================================

    private void resolveService(NsdServiceInfo serviceInfo) {
        nsdManager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                JSObject data = new JSObject();
                data.put("serviceName", info.getServiceName());
                data.put("errorCode", errorCode);
                notifyListeners("peerResolveError", data);
            }

            @Override
            public void onServiceResolved(NsdServiceInfo info) {
                String host = info.getHost() != null ? info.getHost().getHostAddress() : "";
                String token = "";

                try {
                    byte[] tokenBytes = info.getAttributes().get("token");
                    if (tokenBytes != null) {
                        token = new String(tokenBytes, StandardCharsets.UTF_8);
                    }
                } catch (Exception ignored) {
                }

                JSObject data = new JSObject();
                data.put("serviceName", info.getServiceName());
                data.put("host", host);
                data.put("port", info.getPort());
                data.put("deviceName", info.getServiceName());
                data.put("serviceToken", token);
                data.put("sessionToken", token);

                notifyListeners("peerFound", data);
            }
        });
    }

    // =========================================================
    // CONNECT TO DEVICE
    // =========================================================

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String sessionToken = call.getString("sessionToken");

        if (host == null || host.trim().isEmpty() || port == null || port <= 0
                || sessionToken == null || sessionToken.trim().isEmpty()) {
            call.reject("host, port and sessionToken are required");
            return;
        }

        final String finalHost = host.trim();
        final int finalPort = port;
        final String finalToken = sessionToken.trim();

        executor.execute(() -> {
            Socket socket = null;

            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(finalHost, finalPort), CONNECT_TIMEOUT);

                DataOutputStream output = new DataOutputStream(socket.getOutputStream());
                DataInputStream input = new DataInputStream(socket.getInputStream());

                JSONObject hello = new JSONObject();
                hello.put("type", "hello");
                hello.put("protocol", PROTOCOL);
                hello.put("version", PROTOCOL_VERSION);
                hello.put("sessionToken", finalToken);

                writeFrame(output, FRAME_CONTROL, hello.toString().getBytes(StandardCharsets.UTF_8));

                Frame responseFrame = readFrame(input);
                JSONObject resultJson = new JSONObject(
                        new String(responseFrame.payload, StandardCharsets.UTF_8)
                );

                if (!resultJson.optBoolean("ok", false)) {
                    throw new Exception(resultJson.optString("error", "Pairing rejected"));
                }

                activeSocket = socket;
                out = output;
                in = input;

                JSObject result = new JSObject();
                result.put("connected", true);
                result.put("peerDeviceName", resultJson.optString("deviceName", "GymOps Device"));

                mainHandler.post(() -> {
                    call.resolve(result);
                    notifyListeners("connected", result);
                });

                listenForMessages(socket, input);
            } catch (Exception e) {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }

                mainHandler.post(() -> {
                    call.reject("Connection failed: " + e.getMessage(), e);

                    JSObject data = new JSObject();
                    data.put("message", e.getMessage() != null ? e.getMessage() : "Connection failed");
                    notifyListeners("connectionError", data);
                });
            }
        });
    }

    // =========================================================
    // SEND PHOTO INDEX  (Phase 3A — preserved)
    // =========================================================

    @PluginMethod
    public void sendIndex(PluginCall call) {
        JSObject index = call.getObject("index");

        if (index == null) {
            call.reject("index is required");
            return;
        }

        Socket socket = activeSocket;
        DataOutputStream currentOut = out;

        if (socket == null || socket.isClosed() || currentOut == null) {
            call.reject("No active LAN connection");
            return;
        }

        executor.execute(() -> {
            try {
                JSONObject message = new JSONObject();
                message.put("type", "index");
                message.put("index", new JSONObject(index.toString()));

                writeFrame(currentOut, FRAME_CONTROL, message.toString().getBytes(StandardCharsets.UTF_8));

                mainHandler.post(call::resolve);
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed to send index: " + e.getMessage(), e));
            }
        });
    }

    // =========================================================
    // CONFLICT DECISION  (Phase 3C)
    //
    // Purely a relay: this device tells its paired peer what it decided
    // to do about a member whose photo differs on both sides ("conflict").
    //   - KEEP_LOCAL / SKIP are informational only — no transfer is
    //     triggered by sending them.
    //   - USE_REMOTE means "please push your copy of this member's photo
    //     to me" — the PEER's JS layer (photoSyncManager.js) reacts to the
    //     received "photoConflictDecision" event by calling its own
    //     sendPhoto() for that member, reusing the existing photoOffer /
    //     photoAccept / binary-chunk / hash-verify pipeline unchanged. No
    //     new transfer mechanism is introduced here.
    // =========================================================

    @PluginMethod
    public void sendConflictDecision(PluginCall call) {
        String memberId = call.getString("memberId");
        String decision = call.getString("decision");

        if (memberId == null || memberId.trim().isEmpty()) {
            call.reject("memberId is required");
            return;
        }

        if (!"KEEP_LOCAL".equals(decision) && !"USE_REMOTE".equals(decision) && !"SKIP".equals(decision)) {
            call.reject("decision must be one of KEEP_LOCAL, USE_REMOTE, SKIP");
            return;
        }

        Socket socket = activeSocket;
        DataOutputStream currentOut = out;

        if (socket == null || socket.isClosed() || currentOut == null) {
            call.reject("No active LAN connection");
            return;
        }

        final String finalMemberId = memberId.trim();
        final String finalDecision = decision;

        executor.execute(() -> {
            try {
                JSONObject message = new JSONObject();
                message.put("type", "photoConflictDecision");
                message.put("memberId", finalMemberId);
                message.put("decision", finalDecision);

                writeFrame(currentOut, FRAME_CONTROL, message.toString().getBytes(StandardCharsets.UTF_8));

                mainHandler.post(call::resolve);
            } catch (Exception e) {
                mainHandler.post(() -> call.reject("Failed to send conflict decision: " + e.getMessage(), e));
            }
        });
    }

    // =========================================================
    // SEND PHOTO  (Phase 3B)
    // =========================================================

    @PluginMethod
    public void sendPhoto(PluginCall call) {
        String memberId = call.getString("memberId");
        String fileName = call.getString("fileName");
        String hash = call.getString("hash");
        Integer version = call.getInt("version");
        String updatedAt = call.getString("updatedAt");

        if (memberId == null || memberId.trim().isEmpty()) {
            call.reject("memberId is required");
            return;
        }

        Socket socket = activeSocket;
        DataOutputStream currentOut = out;

        if (socket == null || socket.isClosed() || currentOut == null) {
            call.reject("No active LAN connection");
            return;
        }

        File photoFile = new File(
                new File(getContext().getFilesDir(), "member-photos"),
                memberId + ".jpg"
        );

        if (!photoFile.exists()) {
            call.reject("Local photo file not found for member " + memberId);
            return;
        }

        final String finalMemberId = memberId.trim();
        final String finalFileName =
                (fileName != null && !fileName.trim().isEmpty()) ? fileName.trim() : (finalMemberId + ".jpg");
        final String finalHash = hash != null ? hash : "";
        final int finalVersion = version != null ? version : 1;
        final String finalUpdatedAt = updatedAt != null ? updatedAt : "";
        final long size = photoFile.length();

        sendingMemberId = finalMemberId;
        sendingCancelled.set(false);
        offerResponseQueue.clear();
        completeAckQueue.clear();

        executor.execute(() -> {
            try {
                JSONObject offer = new JSONObject();
                offer.put("type", "photoOffer");
                offer.put("memberId", finalMemberId);
                offer.put("fileName", finalFileName);
                offer.put("size", size);
                offer.put("hash", finalHash);
                offer.put("version", finalVersion);
                offer.put("updatedAt", finalUpdatedAt);

                writeFrame(currentOut, FRAME_CONTROL, offer.toString().getBytes(StandardCharsets.UTF_8));

                String response = offerResponseQueue.poll(OFFER_RESPONSE_TIMEOUT_MS, TimeUnit.MILLISECONDS);

                if (response == null || "disconnected".equals(response)) {
                    throw new IOException("Timed out waiting for peer to respond to photo offer");
                }

                if (response.startsWith("reject")) {
                    String reason = response.contains(":")
                            ? response.substring(response.indexOf(':') + 1)
                            : "Peer declined the photo";

                    sendingMemberId = null;

                    mainHandler.post(() -> {
                        JSObject data = new JSObject();
                        data.put("memberId", finalMemberId);
                        data.put("message", reason);
                        notifyListeners("photoTransferError", data);
                        call.reject(reason);
                    });
                    return;
                }

                // Offer accepted — stream the file as binary chunks.
                try (FileInputStream fis = new FileInputStream(photoFile)) {
                    byte[] buffer = new byte[CHUNK_SIZE];
                    long sent = 0;
                    int read;

                    while ((read = fis.read(buffer)) != -1) {
                        if (sendingCancelled.get()) {
                            JSONObject cancel = new JSONObject();
                            cancel.put("type", "cancelTransfer");
                            cancel.put("memberId", finalMemberId);
                            writeFrame(currentOut, FRAME_CONTROL, cancel.toString().getBytes(StandardCharsets.UTF_8));

                            sendingMemberId = null;

                            mainHandler.post(() -> {
                                JSObject data = new JSObject();
                                data.put("memberId", finalMemberId);
                                notifyListeners("photoTransferCancelled", data);
                                call.reject("Transfer cancelled");
                            });
                            return;
                        }

                        byte[] chunk = (read == buffer.length) ? buffer : Arrays.copyOf(buffer, read);

                        writeFrame(currentOut, FRAME_CHUNK, chunk);
                        sent += read;

                        final long finalSent = sent;
                        mainHandler.post(() -> {
                            JSObject progress = new JSObject();
                            progress.put("memberId", finalMemberId);
                            progress.put("sent", finalSent);
                            progress.put("total", size);
                            progress.put("percent", size > 0 ? (int) ((finalSent * 100) / size) : 100);
                            notifyListeners("photoSendProgress", progress);
                        });
                    }

                    JSONObject complete = new JSONObject();
                    complete.put("type", "photoComplete");
                    complete.put("memberId", finalMemberId);
                    complete.put("size", size);
                    complete.put("hash", finalHash);
                    writeFrame(currentOut, FRAME_CONTROL, complete.toString().getBytes(StandardCharsets.UTF_8));
                }

                String ack = completeAckQueue.poll(ACK_TIMEOUT_MS, TimeUnit.MILLISECONDS);

                if (ack == null || "disconnected".equals(ack)) {
                    throw new IOException("Timed out waiting for transfer confirmation");
                }

                if (ack.startsWith("nack")) {
                    String reason = ack.contains(":") ? ack.substring(ack.indexOf(':') + 1) : "Receiver rejected the photo";

                    sendingMemberId = null;

                    mainHandler.post(() -> {
                        JSObject data = new JSObject();
                        data.put("memberId", finalMemberId);
                        data.put("message", reason);
                        notifyListeners("photoTransferError", data);
                        call.reject(reason);
                    });
                    return;
                }

                sendingMemberId = null;

                mainHandler.post(() -> {
                    JSObject result = new JSObject();
                    result.put("memberId", finalMemberId);
                    result.put("success", true);
                    notifyListeners("photoSendComplete", result);
                    call.resolve(result);
                });
            } catch (Exception e) {
                sendingMemberId = null;

                mainHandler.post(() -> {
                    JSObject data = new JSObject();
                    data.put("memberId", finalMemberId);
                    data.put("message", e.getMessage() != null ? e.getMessage() : "Photo transfer failed");
                    notifyListeners("photoTransferError", data);
                    call.reject("Photo transfer failed: " + e.getMessage(), e);
                });
            }
        });
    }

    // =========================================================
    // ACCEPT / REJECT AN INCOMING PHOTO OFFER
    // =========================================================

    @PluginMethod
    public void acceptPhoto(PluginCall call) {
        String memberId = call.getString("memberId");
        DataOutputStream currentOut = out;

        if (memberId == null || pendingOfferMeta == null || !memberId.equals(pendingOfferMemberId)) {
            call.reject("No matching pending photo offer for member " + memberId);
            return;
        }

        if (currentOut == null) {
            call.reject("No active LAN connection");
            return;
        }

        try {
            File tmpDir = new File(getContext().getCacheDir(), "gymops-sync-tmp");
            if (!tmpDir.exists()) {
                tmpDir.mkdirs();
            }

            File tempFile = new File(tmpDir, memberId + "-" + UUID.randomUUID() + ".part");

            receivingStream = new FileOutputStream(tempFile);
            receivingTempFile = tempFile;
            receivingDigest = MessageDigest.getInstance("SHA-256");
            receivingBytesWritten = 0;
            receivingOffer = pendingOfferMeta;
            receivingMemberId = memberId;
            receivingCancelled.set(false);

            JSONObject accept = new JSONObject();
            accept.put("type", "photoAccept");
            accept.put("memberId", memberId);
            writeFrame(currentOut, FRAME_CONTROL, accept.toString().getBytes(StandardCharsets.UTF_8));

            pendingOfferMemberId = null;
            pendingOfferMeta = null;

            call.resolve();
        } catch (Exception e) {
            cleanupReceivingState();
            call.reject("Failed to accept photo: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void rejectPhoto(PluginCall call) {
        String memberId = call.getString("memberId");
        String reason = call.getString("reason");
        DataOutputStream currentOut = out;

        if (currentOut == null) {
            call.reject("No active LAN connection");
            return;
        }

        try {
            JSONObject reject = new JSONObject();
            reject.put("type", "photoReject");
            reject.put("memberId", memberId != null ? memberId : "");
            reject.put("reason", reason != null ? reason : "Rejected by receiver");
            writeFrame(currentOut, FRAME_CONTROL, reject.toString().getBytes(StandardCharsets.UTF_8));

            if (memberId != null && memberId.equals(pendingOfferMemberId)) {
                pendingOfferMemberId = null;
                pendingOfferMeta = null;
            }

            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to reject photo: " + e.getMessage(), e);
        }
    }

    // =========================================================
    // CANCEL AN ACTIVE TRANSFER
    // =========================================================

    @PluginMethod
    public void cancelTransfer(PluginCall call) {
        sendingCancelled.set(true);
        receivingCancelled.set(true);

        DataOutputStream currentOut = out;

        try {
            if (receivingMemberId != null && currentOut != null) {
                JSONObject cancel = new JSONObject();
                cancel.put("type", "cancelTransfer");
                cancel.put("memberId", receivingMemberId);
                writeFrame(currentOut, FRAME_CONTROL, cancel.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception ignored) {
        }

        cleanupReceivingState();

        notifyListeners("photoTransferCancelled", new JSObject());

        call.resolve();
    }

    // =========================================================
    // RECEIVE MESSAGES (control + binary chunk frames)
    // =========================================================

    private void listenForMessages(Socket socket, DataInputStream input) {
        executor.execute(() -> {
            try {
                while (!socket.isClosed()) {
                    Frame frame = readFrame(input);

                    if (frame.type == FRAME_CONTROL) {
                        JSONObject message = new JSONObject(new String(frame.payload, StandardCharsets.UTF_8));
                        String type = message.optString("type");

                        switch (type) {
                            case "index": {
                                JSONObject index = message.optJSONObject("index");
                                JSObject data = new JSObject();
                                data.put("index", index != null ? index : new JSONObject());
                                mainHandler.post(() -> notifyListeners("indexReceived", data));
                                break;
                            }
                            case "photoOffer": {
                                String offerMemberId = message.optString("memberId");
                                pendingOfferMemberId = offerMemberId;
                                pendingOfferMeta = message;

                                JSObject data = new JSObject();
                                data.put("memberId", offerMemberId);
                                data.put("fileName", message.optString("fileName"));
                                data.put("size", message.optLong("size"));
                                data.put("hash", message.optString("hash"));
                                data.put("version", message.optInt("version"));
                                data.put("updatedAt", message.optString("updatedAt"));

                                mainHandler.post(() -> notifyListeners("photoOffer", data));
                                break;
                            }
                            case "photoAccept":
                                offerResponseQueue.offer("accept");
                                break;
                            case "photoReject":
                                offerResponseQueue.offer("reject:" + message.optString("reason", "Peer declined"));
                                break;
                            case "photoAck":
                                completeAckQueue.offer("ack");
                                break;
                            case "photoNack":
                                completeAckQueue.offer("nack:" + message.optString("reason", "Receiver rejected"));
                                break;
                            case "photoComplete":
                                handlePhotoComplete(message.optString("memberId"));
                                break;
                            case "cancelTransfer": {
                                String cancelledMemberId = message.optString("memberId");

                                if (cancelledMemberId != null && cancelledMemberId.equals(receivingMemberId)) {
                                    cleanupReceivingState();
                                    JSObject data = new JSObject();
                                    data.put("memberId", cancelledMemberId);
                                    mainHandler.post(() -> notifyListeners("photoTransferCancelled", data));
                                }

                                if (cancelledMemberId != null && cancelledMemberId.equals(sendingMemberId)) {
                                    sendingCancelled.set(true);
                                    offerResponseQueue.offer("reject:Peer cancelled transfer");
                                    completeAckQueue.offer("nack:Peer cancelled transfer");
                                }
                                break;
                            }
                            case "photoError": {
                                String erroredMemberId = message.optString("memberId");
                                JSObject data = new JSObject();
                                data.put("memberId", erroredMemberId);
                                data.put("message", message.optString("message", "Peer reported a transfer error"));
                                mainHandler.post(() -> notifyListeners("photoTransferError", data));
                                break;
                            }
                            case "photoConflictDecision": {
                                // Phase 3C — pure relay. This device does not decide
                                // anything here; it just forwards the peer's decision
                                // to JS, which decides how (or whether) to react. See
                                // photoSyncManager.js's "photoConflictDecision" listener.
                                JSObject data = new JSObject();
                                data.put("memberId", message.optString("memberId"));
                                data.put("decision", message.optString("decision"));
                                mainHandler.post(() -> notifyListeners("photoConflictDecision", data));
                                break;
                            }
                            default:
                                break;
                        }
                    } else if (frame.type == FRAME_CHUNK) {
                        handleIncomingChunk(frame.payload);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                offerResponseQueue.offer("disconnected");
                completeAckQueue.offer("disconnected");
                cleanupReceivingState();
                closeActiveSocket();

                mainHandler.post(() -> notifyListeners("disconnected", new JSObject()));
            }
        });
    }

    private void handleIncomingChunk(byte[] payload) {
        if (receivingMemberId == null || receivingStream == null || receivingDigest == null
                || receivingCancelled.get()) {
            // Stray chunk with nothing actively receiving — nothing safe to do with it.
            return;
        }

        try {
            receivingStream.write(payload);
            receivingDigest.update(payload);
            receivingBytesWritten += payload.length;

            final long received = receivingBytesWritten;
            final long total = receivingOffer != null ? receivingOffer.optLong("size", -1) : -1;
            final String progressMemberId = receivingMemberId;

            mainHandler.post(() -> {
                JSObject progress = new JSObject();
                progress.put("memberId", progressMemberId);
                progress.put("received", received);
                progress.put("total", total);
                progress.put("percent", total > 0 ? (int) ((received * 100) / total) : 0);
                notifyListeners("photoReceiveProgress", progress);
            });
        } catch (IOException writeError) {
            cleanupReceivingState();

            JSObject data = new JSObject();
            data.put("message", "Failed to write incoming photo data");
            mainHandler.post(() -> notifyListeners("photoTransferError", data));
        }
    }

    /**
     * Finalize a photo we were receiving: verify size + SHA-256 hash, and
     * only then atomically move it into member-photos/{memberId}.jpg. On
     * any mismatch the temp file is discarded and the existing photo (if
     * any) is left untouched.
     */
    private void handlePhotoComplete(String memberId) {
        DataOutputStream currentOut = out;

        if (memberId == null || !memberId.equals(receivingMemberId)
                || receivingStream == null || receivingDigest == null) {
            return;
        }

        JSONObject offer = receivingOffer;
        File tempFile = receivingTempFile;

        try {
            receivingStream.flush();
            receivingStream.close();
        } catch (Exception ignored) {
        }

        String actualHash = bytesToHex(receivingDigest.digest());
        long expectedSize = offer != null ? offer.optLong("size", -1) : -1;
        String expectedHash = offer != null ? offer.optString("hash", "") : "";
        int version = offer != null ? offer.optInt("version", 1) : 1;
        String updatedAt = offer != null ? offer.optString("updatedAt", "") : "";
        String fileName = offer != null ? offer.optString("fileName", memberId + ".jpg") : memberId + ".jpg";

        boolean sizeOk = expectedSize < 0 || expectedSize == receivingBytesWritten;
        boolean hashOk = expectedHash.isEmpty() || expectedHash.equalsIgnoreCase(actualHash);

        final String finalMemberId = memberId;

        if (sizeOk && hashOk) {
            try {
                File photoDir = new File(getContext().getFilesDir(), "member-photos");
                if (!photoDir.exists()) {
                    photoDir.mkdirs();
                }

                File target = new File(photoDir, finalMemberId + ".jpg");
                boolean renamed = tempFile != null && tempFile.renameTo(target);

                if (!renamed && tempFile != null) {
                    // Cross-filesystem fallback (rename can fail e.g. across
                    // storage volumes) — copy then remove the temp file.
                    copyFile(tempFile, target);
                    tempFile.delete();
                }

                JSONObject ack = new JSONObject();
                ack.put("type", "photoAck");
                ack.put("memberId", finalMemberId);
                writeFrame(currentOut, FRAME_CONTROL, ack.toString().getBytes(StandardCharsets.UTF_8));

                JSObject data = new JSObject();
                data.put("memberId", finalMemberId);
                data.put("fileName", fileName);
                data.put("path", "member-photos/" + finalMemberId + ".jpg");
                data.put("version", version);
                data.put("updatedAt", updatedAt);
                data.put("hash", actualHash);
                data.put("size", receivingBytesWritten);

                mainHandler.post(() -> notifyListeners("photoReceived", data));
            } catch (Exception e) {
                try {
                    JSONObject nack = new JSONObject();
                    nack.put("type", "photoNack");
                    nack.put("memberId", finalMemberId);
                    nack.put("reason", "Failed to store received photo");
                    writeFrame(currentOut, FRAME_CONTROL, nack.toString().getBytes(StandardCharsets.UTF_8));
                } catch (Exception ignored) {
                }

                JSObject data = new JSObject();
                data.put("memberId", finalMemberId);
                data.put("message", "Failed to store received photo: " + e.getMessage());
                mainHandler.post(() -> notifyListeners("photoTransferError", data));
            }
        } else {
            if (tempFile != null && tempFile.exists()) {
                tempFile.delete();
            }

            try {
                JSONObject nack = new JSONObject();
                nack.put("type", "photoNack");
                nack.put("memberId", finalMemberId);
                nack.put("reason", "hash-mismatch");
                writeFrame(currentOut, FRAME_CONTROL, nack.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }

            JSObject data = new JSObject();
            data.put("memberId", finalMemberId);
            data.put("message", "Photo hash verification failed; existing photo was not replaced");
            mainHandler.post(() -> notifyListeners("photoTransferError", data));
        }

        receivingStream = null;
        receivingTempFile = null;
        receivingDigest = null;
        receivingMemberId = null;
        receivingOffer = null;
        receivingBytesWritten = 0;
    }

    private void cleanupReceivingState() {
        if (receivingStream != null) {
            try {
                receivingStream.close();
            } catch (Exception ignored) {
            }
        }

        if (receivingTempFile != null && receivingTempFile.exists()) {
            receivingTempFile.delete();
        }

        receivingStream = null;
        receivingTempFile = null;
        receivingDigest = null;
        receivingMemberId = null;
        receivingOffer = null;
        receivingBytesWritten = 0;
    }

    // =========================================================
    // STOP DISCOVERY
    // =========================================================

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        stopDiscoveryInternal();
        call.resolve();
    }

    private void stopDiscoveryInternal() {
        if (nsdManager == null || discoveryListener == null) {
            return;
        }

        try {
            nsdManager.stopServiceDiscovery(discoveryListener);
        } catch (Exception ignored) {
        }

        discoveryListener = null;
    }

    // =========================================================
    // DISCONNECT
    // =========================================================

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeActiveSocket();
        call.resolve();
        notifyListeners("disconnected", new JSObject());
    }

    // =========================================================
    // INTERNAL CLEANUP
    // =========================================================

    private void closeActiveSocket() {
        if (activeSocket != null) {
            try {
                activeSocket.close();
            } catch (Exception ignored) {
            }
            activeSocket = null;
        }

        out = null;
        in = null;
        sendingMemberId = null;
        pendingOfferMemberId = null;
        pendingOfferMeta = null;

        cleanupReceivingState();
    }

    private void stopHostInternal() {
        closeActiveSocket();

        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (Exception ignored) {
            }
            serverSocket = null;
        }

        if (nsdManager != null && registrationListener != null) {
            try {
                nsdManager.unregisterService(registrationListener);
            } catch (Exception ignored) {
            }
            registrationListener = null;
        }
    }

    private void handleIncomingConnection(Socket socket, String expectedToken, String deviceName) {
        try {
            socket.setSoTimeout(15000);

            DataInputStream input = new DataInputStream(socket.getInputStream());
            DataOutputStream output = new DataOutputStream(socket.getOutputStream());

            Frame helloFrame = readFrame(input);
            JSONObject hello = new JSONObject(new String(helloFrame.payload, StandardCharsets.UTF_8));

            boolean valid = "hello".equals(hello.optString("type"))
                    && PROTOCOL.equals(hello.optString("protocol"))
                    && PROTOCOL_VERSION == hello.optInt("version")
                    && expectedToken.equals(hello.optString("sessionToken"));

            if (!valid) {
                JSONObject reject = new JSONObject();
                reject.put("ok", false);
                reject.put("error", "Pairing rejected");
                writeFrame(output, FRAME_CONTROL, reject.toString().getBytes(StandardCharsets.UTF_8));
                socket.close();
                return;
            }

            // Handshake done — remove the short handshake timeout so a long
            // photo transfer isn't killed by socket idle timeouts.
            socket.setSoTimeout(0);

            activeSocket = socket;
            out = output;
            in = input;

            JSONObject accepted = new JSONObject();
            accepted.put("ok", true);
            accepted.put("deviceName", deviceName);
            writeFrame(output, FRAME_CONTROL, accepted.toString().getBytes(StandardCharsets.UTF_8));

            JSObject data = new JSObject();
            data.put("connected", true);
            data.put("peerDeviceName", "GymOps Device");

            mainHandler.post(() -> notifyListeners("connected", data));

            listenForMessages(socket, input);
        } catch (Exception e) {
            try {
                socket.close();
            } catch (Exception ignored) {
            }

            JSObject data = new JSObject();
            data.put("message", e.getMessage() != null ? e.getMessage() : "Connection failed");

            mainHandler.post(() -> notifyListeners("connectionError", data));
        }
    }

    private String sanitizeName(String name) {
        String cleaned = name.replaceAll("[^A-Za-z0-9_-]", "-");

        if (cleaned.trim().isEmpty()) {
            return "GymOps";
        }

        return cleaned.substring(0, Math.min(cleaned.length(), 30));
    }

    // =========================================================
    // FRAMING HELPERS
    // =========================================================

    private static class Frame {
        final byte type;
        final byte[] payload;

        Frame(byte type, byte[] payload) {
            this.type = type;
            this.payload = payload;
        }
    }

    private Frame readFrame(DataInputStream input) throws IOException {
        int type = input.readUnsignedByte();
        int length = input.readInt();

        if (length < 0 || length > MAX_FRAME_SIZE) {
            throw new IOException("Invalid frame length: " + length);
        }

        byte[] payload = new byte[length];
        input.readFully(payload);

        return new Frame((byte) type, payload);
    }

    private void writeFrame(DataOutputStream output, byte type, byte[] payload) throws IOException {
        synchronized (writeLock) {
            output.writeByte(type);
            output.writeInt(payload.length);
            output.write(payload);
            output.flush();
        }
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static void copyFile(File source, File dest) throws IOException {
        try (FileInputStream fis = new FileInputStream(source);
             FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = fis.read(buffer)) != -1) {
                fos.write(buffer, 0, read);
            }
        }
    }
}
