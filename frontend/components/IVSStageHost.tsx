"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../lib/apiBase";

// Dev-only debug log. NODE_ENV is inlined by Next.js's DefinePlugin
// at build time (this file has no @solana/web3.js import, so the
// inliner fires correctly here). In production, the && short-circuits
// so the strings + JSON serialisations are never evaluated and the
// browser console stays clean during the demo recording.
const __debug = process.env.NODE_ENV === "development";

type HostStatus = "idle" | "requesting_camera" | "previewing" | "connecting" | "live" | "error" | "ended";

interface IVSStageHostProps {
  projectId: string;
  userId: string;
  autoStart?: boolean;
  onLive: () => void;
  onEnd: () => void;
  onError: (msg: string) => void;
  // Audit #4 Phase 3 (Q6) — pre-stream guard. When the merchant
  // clicks Go Live without a pinned offer, surface a confirm
  // dialog before requesting camera. Null / undefined means
  // "no pinned offer yet" → confirm fires; a non-empty string
  // (offer UUID) means everything's wired up → confirm skipped.
  pinnedOfferId?: string | null;
}

// Stable refs outside component to survive re-renders and strict mode
let _stageInstance: any = null;
let _localStreams: any[] = [];
let _videoTrackId: string | null = null;
let _audioTrackId: string | null = null;

export function IVSStageHost({ projectId, userId, autoStart, onLive, onEnd, onError, pinnedOfferId }: IVSStageHostProps) {
  const [status, setStatus] = useState<HostStatus>(() => {
    // If stage exists from a previous render, stay in live state
    return _stageInstance ? "live" : "idle";
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Heartbeat poll handle. While the stage is live, the host
  // posts to /api/ivs/heartbeat every 5s so the backend can
  // detect an abrupt disconnect (tab close, laptop sleep,
  // network drop) and flip is_live=false within ~15s. Without
  // this, viewers landed on /embed/* and saw "Waiting for host
  // video..." indefinitely after a host crash.
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    const send = () => {
      // Fire-and-forget. A single failed beat doesn't end the
      // stream; the backend's 60s threshold tolerates up to
      // ~12 missed polls. Catch silently — we never want a
      // heartbeat failure to interrupt the live UI.
      fetch(`${API_BASE}/api/ivs/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
        keepalive: true,
      }).catch(() => {});
    };
    send(); // immediate first beat so the freshly-live state is recorded
    heartbeatTimerRef.current = setInterval(send, 5000);
  }

  const startPreview = useCallback(async () => {
    // Audit #4 Phase 3 (Q6) — pre-stream guard. If the merchant
    // is about to go live without a pinned offer, the buyers
    // who land during the show will see a stream with nothing
    // to buy. Surface a confirm dialog before we even request
    // camera access; OK = "go live anyway", Cancel = "let me
    // pin first." Cancel is the safer default — the merchant
    // has to actively press OK to override.
    if (
      typeof window !== "undefined" &&
      (!pinnedOfferId || pinnedOfferId.trim() === "")
    ) {
      const ok = window.confirm(
        "You haven't pinned a product yet. Viewers won't see anything to buy.\n\nGo live anyway? Click Cancel to pin first.",
      );
      if (!ok) return;
    }

    setStatus("requesting_camera");
    setErrorMsg(null);
    __debug && console.log("[ivs-host] Requesting camera/mic");

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Camera not supported"); setStatus("error"); onError("Camera not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      __debug && console.log("[ivs-host] Camera acquired:", stream.getTracks().map(t => `${t.kind}:${t.id}:${t.readyState}`));
      cameraStreamRef.current = stream;

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }
      setStatus("previewing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera failed";
      console.error("[ivs-host] getUserMedia failed:", msg);
      setErrorMsg(msg); setStatus("error"); onError(msg);
    }
  }, [onError, pinnedOfferId]);

  useEffect(() => {
    if (autoStart && status === "idle") startPreview();
  }, [autoStart, status, startPreview]);

  const goLive = useCallback(async () => {
    // Guard: don't rejoin if already connected
    if (_stageInstance) {
      __debug && console.log("[ivs-host] Stage already exists, skipping");
      setStatus("live");
      // Re-arm the heartbeat in case this is a re-mount on the
      // same module-level stage — without it, navigating away
      // and back would leave the host live in the UI but no
      // longer beating the backend.
      startHeartbeat();
      return;
    }

    setStatus("connecting");
    __debug && console.log("[ivs-host] Creating IVS stage...");

    try {
      const res = await fetch(`${API_BASE}/api/ivs/create-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Stage creation failed (${res.status})`);
      }
      const data = await res.json();
      __debug && console.log("[ivs-host] Stage:", data.stage_id, "token:", !!data.host_token);
      if (!data.host_token) throw new Error("No host token");

      // Load SDK
      const { Stage, LocalStageStream, StageEvents, ConnectionState, SubscribeType } =
        await import("amazon-ivs-web-broadcast");

      // Get tracks — verify they're alive
      const stream = cameraStreamRef.current;
      if (!stream) throw new Error("Camera stream lost");
      const vt = stream.getVideoTracks()[0];
      const at = stream.getAudioTracks()[0];
      if (!vt || vt.readyState !== "live") throw new Error(`Video track not live: ${vt?.readyState}`);
      if (!at || at.readyState !== "live") throw new Error(`Audio track not live: ${at?.readyState}`);

      __debug && console.log("[ivs-host] Tracks verified:", {
        video: `id=${vt.id} state=${vt.readyState} enabled=${vt.enabled}`,
        audio: `id=${at.id} state=${at.readyState} enabled=${at.enabled}`,
      });

      // Create LocalStageStream ONCE — store in module-level vars
      if (!_localStreams.length || _videoTrackId !== vt.id || _audioTrackId !== at.id) {
        _localStreams = [new LocalStageStream(vt), new LocalStageStream(at)];
        _videoTrackId = vt.id;
        _audioTrackId = at.id;
        __debug && console.log("[ivs-host] LocalStageStreams created (new). Count:", _localStreams.length);
      } else {
        __debug && console.log("[ivs-host] LocalStageStreams reused (same track IDs). Count:", _localStreams.length);
      }

      // Frozen strategy — all references are stable
      const frozenStreams = _localStreams;
      const strategy = {
        stageStreamsToPublish: () => {
          __debug && console.log("[ivs-host] stageStreamsToPublish → returning", frozenStreams.length, "frozen streams");
          return frozenStreams;
        },
        shouldPublishParticipant: () => true,
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };

      // Create stage
      const stage = new Stage(data.host_token, strategy);
      _stageInstance = stage;

      // Log ALL events
      for (const evt of Object.values(StageEvents) as string[]) {
        stage.on(evt, (...args: any[]) => {
          const s = args.map((a: any) => {
            if (a && typeof a === "object") return JSON.stringify({ userId: a.userId, isLocal: a.isLocal, isPublishing: a.isPublishing, message: a.message, code: a.code });
            return String(a);
          }).join(", ");
          __debug && console.log(`[IVS-HOST] ${evt} → ${s}`);
        });
      }

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        __debug && console.log("[ivs-host] Connection:", state);
        if (state === ConnectionState.CONNECTED) {
          __debug && console.log("[ivs-host] ✓ CONNECTED — calling onLive");
          setStatus("live");
          startHeartbeat();
          onLive();
        }
      });

      __debug && console.log("[ivs-host] Joining stage...");
      await stage.join();
      __debug && console.log("[ivs-host] ✓ stage.join() resolved");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      console.error("[ivs-host] Error:", msg, err);
      setErrorMsg(msg); setStatus("error"); onError(msg);
      _stageInstance = null;
      _localStreams = [];
    }
  }, [projectId, userId, onLive, onError]);

  const endStream = useCallback(async () => {
    __debug && console.log("[ivs-host] Ending stream (user action)...");

    // Stop heartbeat first so the explicit end isn't accompanied
    // by stray heartbeats racing the /end-stage call.
    stopHeartbeat();

    if (_stageInstance) {
      try { _stageInstance.leave(); } catch {}
      _stageInstance = null;
    }
    _localStreams = [];
    _videoTrackId = null;
    _audioTrackId = null;

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }

    try {
      await fetch(`${API_BASE}/api/ivs/end-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });
    } catch {}

    setStatus("ended");
    onEnd();
  }, [projectId, userId, onEnd]);

  // Cleanup ONLY on true unmount (component removed from tree entirely)
  // Do NOT clean up on re-renders — stage must persist
  useEffect(() => {
    return () => {
      // Only clean up if the component is being removed from the page entirely
      // (not just a re-render). Check if we should keep the stage alive.
      // The module-level _stageInstance will persist across re-mounts.
      __debug && console.log("[ivs-host] useEffect cleanup — stage preserved in module scope");
      // Always stop the heartbeat interval on cleanup. If the
      // component is genuinely unmounting (navigation away, tab
      // close) the backend's 15s threshold will trip and the
      // bubble + Discover will flip to offline within seconds —
      // exactly the auto-end-stale behaviour we want.
      stopHeartbeat();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className={`overflow-hidden rounded-2xl border border-zinc-800 bg-black ${status === "previewing" || status === "live" ? "" : "hidden"}`}>
        <video ref={previewRef} autoPlay muted playsInline className="w-full" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
      </div>

      {status === "idle" && (
        <div className="text-center py-4">
          <button onClick={startPreview} className="rounded-2xl bg-red-500 px-10 py-4 text-lg font-bold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-400 active:scale-[0.98]">
            Go Live
          </button>
          <p className="mt-3 text-sm text-zinc-500">Start selling in seconds</p>
        </div>
      )}

      {status === "requesting_camera" && (
        <div className="text-center py-8">
          <div className="h-3 w-3 animate-pulse rounded-full bg-amber-400 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Requesting camera access...</p>
        </div>
      )}

      {status === "previewing" && (
        <div className="flex gap-3">
          <button onClick={goLive} className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400">Start Live</button>
          <button onClick={() => { endStream(); setStatus("idle"); }} className="rounded-xl border border-zinc-800 px-5 py-3 text-sm text-zinc-400 hover:text-white">Cancel</button>
        </div>
      )}

      {status === "connecting" && (
        <div className="text-center py-4">
          <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Connecting...</p>
        </div>
      )}

      {status === "live" && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <span className="text-sm font-bold text-red-400">LIVE</span>
          </div>
          <button onClick={endStream} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20">End Stream</button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">{errorMsg}</div>
          <button onClick={() => { setStatus("idle"); setErrorMsg(null); }} className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">Try Again</button>
        </div>
      )}

      {status === "ended" && (
        <div className="text-center py-4">
          <p className="text-sm text-zinc-500">Stream ended</p>
          <button onClick={() => setStatus("idle")} className="mt-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">Go Live Again</button>
        </div>
      )}
    </div>
  );
}
