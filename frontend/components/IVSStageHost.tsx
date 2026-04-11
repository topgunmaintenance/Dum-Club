"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../lib/apiBase";

type HostStatus = "idle" | "requesting_camera" | "previewing" | "connecting" | "live" | "error" | "ended";

interface IVSStageHostProps {
  projectId: string;
  userId: string;
  onLive: () => void;
  onEnd: () => void;
  onError: (msg: string) => void;
}

// Stable refs outside component to survive re-renders and strict mode
let _stageInstance: any = null;
let _localStreams: any[] = [];
let _videoTrackId: string | null = null;
let _audioTrackId: string | null = null;

export function IVSStageHost({ projectId, userId, onLive, onEnd, onError }: IVSStageHostProps) {
  const [status, setStatus] = useState<HostStatus>(() => {
    // If stage exists from a previous render, stay in live state
    return _stageInstance ? "live" : "idle";
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const startPreview = useCallback(async () => {
    setStatus("requesting_camera");
    setErrorMsg(null);
    console.log("[ivs-host] Requesting camera/mic");

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Camera not supported"); setStatus("error"); onError("Camera not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      console.log("[ivs-host] Camera acquired:", stream.getTracks().map(t => `${t.kind}:${t.id}:${t.readyState}`));
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
  }, [onError]);

  const goLive = useCallback(async () => {
    // Guard: don't rejoin if already connected
    if (_stageInstance) {
      console.log("[ivs-host] Stage already exists, skipping");
      setStatus("live");
      return;
    }

    setStatus("connecting");
    console.log("[ivs-host] Creating IVS stage...");

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
      console.log("[ivs-host] Stage:", data.stage_id, "token:", !!data.host_token);
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

      console.log("[ivs-host] Tracks verified:", {
        video: `id=${vt.id} state=${vt.readyState} enabled=${vt.enabled}`,
        audio: `id=${at.id} state=${at.readyState} enabled=${at.enabled}`,
      });

      // Create LocalStageStream ONCE — store in module-level vars
      if (!_localStreams.length || _videoTrackId !== vt.id || _audioTrackId !== at.id) {
        _localStreams = [new LocalStageStream(vt), new LocalStageStream(at)];
        _videoTrackId = vt.id;
        _audioTrackId = at.id;
        console.log("[ivs-host] LocalStageStreams created (new). Count:", _localStreams.length);
      } else {
        console.log("[ivs-host] LocalStageStreams reused (same track IDs). Count:", _localStreams.length);
      }

      // Frozen strategy — all references are stable
      const frozenStreams = _localStreams;
      const strategy = {
        stageStreamsToPublish: () => {
          console.log("[ivs-host] stageStreamsToPublish → returning", frozenStreams.length, "frozen streams");
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
          console.log(`[IVS-HOST] ${evt} → ${s}`);
        });
      }

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-host] Connection:", state);
        if (state === ConnectionState.CONNECTED) {
          console.log("[ivs-host] ✓ CONNECTED — calling onLive");
          setStatus("live");
          onLive();
        }
      });

      console.log("[ivs-host] Joining stage...");
      await stage.join();
      console.log("[ivs-host] ✓ stage.join() resolved");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      console.error("[ivs-host] Error:", msg, err);
      setErrorMsg(msg); setStatus("error"); onError(msg);
      _stageInstance = null;
      _localStreams = [];
    }
  }, [projectId, userId, onLive, onError]);

  const endStream = useCallback(async () => {
    console.log("[ivs-host] Ending stream (user action)...");

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
      console.log("[ivs-host] useEffect cleanup — stage preserved in module scope");
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
