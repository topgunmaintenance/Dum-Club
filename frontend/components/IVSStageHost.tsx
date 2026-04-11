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

export function IVSStageHost({ projectId, userId, onLive, onEnd, onError }: IVSStageHostProps) {
  const [status, setStatus] = useState<HostStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<any>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Store LocalStageStream instances so the strategy returns the SAME objects
  const localStreamsRef = useRef<any[]>([]);

  const startPreview = useCallback(async () => {
    setStatus("requesting_camera");
    setErrorMsg(null);
    console.log("[ivs-host] Requesting camera/mic");

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg = "Camera not supported on this browser";
      setErrorMsg(msg);
      setStatus("error");
      onError(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      const tracks = stream.getTracks();
      console.log("[ivs-host] Camera acquired:", tracks.map(t => `${t.kind}:${t.label}:${t.readyState}`));
      cameraStreamRef.current = stream;

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }

      setStatus("previewing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera access failed";
      console.error("[ivs-host] getUserMedia failed:", msg);
      setErrorMsg(msg.includes("NotAllowed") ? "Camera access denied" : msg);
      setStatus("error");
      onError(msg);
    }
  }, [onError]);

  const goLive = useCallback(async () => {
    setStatus("connecting");
    console.log("[ivs-host] Creating IVS stage...");

    try {
      // 1. Create stage + get host token
      const res = await fetch(`${API_BASE}/api/ivs/create-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });

      // Backend handles stale stage cleanup atomically — no 409 retry needed
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Stage creation failed (${res.status})`);
      }
      const data = await res.json();
      console.log("[ivs-host] Stage response:", { stage_id: data.stage_id, has_token: !!data.host_token });

      if (!data.host_token) {
        throw new Error("No host token received");
      }

      // 2. Load IVS SDK dynamically
      const { Stage, LocalStageStream, StageEvents, ConnectionState, SubscribeType } =
        await import("amazon-ivs-web-broadcast");
      console.log("[ivs-host] IVS SDK loaded");

      // 3. Get camera tracks
      const stream = cameraStreamRef.current;
      if (!stream) throw new Error("Camera stream lost");

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack) throw new Error("No video track available");
      if (!audioTrack) throw new Error("No audio track available");

      console.log("[ivs-host] Tracks:", {
        video: `${videoTrack.kind}:${videoTrack.readyState}:${videoTrack.enabled}`,
        audio: `${audioTrack.kind}:${audioTrack.readyState}:${audioTrack.enabled}`,
      });

      // 4. Create LocalStageStream instances ONCE and store them
      // The SDK requires the SAME objects returned from stageStreamsToPublish on every call
      const localVideoStream = new LocalStageStream(videoTrack);
      const localAudioStream = new LocalStageStream(audioTrack);
      localStreamsRef.current = [localVideoStream, localAudioStream];
      console.log("[ivs-host] LocalStageStreams created:", localStreamsRef.current.length);

      // 5. Strategy — returns stored instances, not new ones
      const strategy = {
        stageStreamsToPublish: () => {
          console.log("[ivs-host] stageStreamsToPublish called, returning", localStreamsRef.current.length, "streams");
          return localStreamsRef.current;
        },
        shouldPublishParticipant: (participant: any) => {
          console.log("[ivs-host] shouldPublishParticipant called for:", participant?.userId || "local");
          return true;
        },
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };

      // 6. Create and join stage
      const stage = new Stage(data.host_token, strategy);
      stageRef.current = stage;

      // Log ALL events
      const allEvents = Object.values(StageEvents) as string[];
      for (const evt of allEvents) {
        stage.on(evt, (...args: any[]) => {
          const summary = args.map((a: any) => {
            if (a && typeof a === "object") {
              return JSON.stringify({ userId: a.userId, isLocal: a.isLocal, isPublishing: a.isPublishing, message: a.message, code: a.code, category: a.category });
            }
            return String(a);
          }).join(", ");
          console.log(`[IVS-HOST] ${evt} → ${summary}`);
        });
      }

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-host] Connection state changed:", state);
        if (state === ConnectionState.CONNECTED) {
          console.log("[ivs-host] CONNECTED — now live");
          setStatus("live");
          onLive();
        } else if (state === ConnectionState.DISCONNECTED) {
          console.log("[ivs-host] DISCONNECTED");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
        console.log("[ivs-host] Participant joined:", participant?.userId, participant?.isLocal ? "(local)" : "(remote)");
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-host] Participant left:", participant?.userId);
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("[ivs-host] Streams added for:", participant?.userId, "count:", streams?.length,
          participant?.isLocal ? "(local — publishing confirmed)" : "(remote)");
      });

      console.log("[ivs-host] Joining stage...");
      await stage.join();
      console.log("[ivs-host] stage.join() resolved — connected to stage");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to go live";
      console.error("[ivs-host] Error:", msg, err);
      setErrorMsg(msg);
      setStatus("error");
      onError(msg);
    }
  }, [projectId, userId, onLive, onError]);

  const endStream = useCallback(async () => {
    console.log("[ivs-host] Ending stream...");

    if (stageRef.current) {
      try { stageRef.current.leave(); } catch {}
      stageRef.current = null;
    }
    localStreamsRef.current = [];

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
    } catch (err) {
      console.error("[ivs-host] End stage API error:", err);
    }

    setStatus("ended");
    onEnd();
  }, [projectId, userId, onEnd]);

  useEffect(() => {
    return () => {
      if (stageRef.current) {
        try { stageRef.current.leave(); } catch {}
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className={`overflow-hidden rounded-2xl border border-zinc-800 bg-black ${status === "previewing" || status === "live" ? "" : "hidden"}`}>
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className="w-full"
          style={{ aspectRatio: "16/9", objectFit: "cover" }}
        />
      </div>

      {status === "idle" && (
        <div className="text-center py-4">
          <button
            onClick={startPreview}
            className="rounded-2xl bg-red-500 px-10 py-4 text-lg font-bold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-400 active:scale-[0.98]"
          >
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
          <button onClick={goLive} className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400">
            Start Live
          </button>
          <button onClick={() => { endStream(); setStatus("idle"); }} className="rounded-xl border border-zinc-800 px-5 py-3 text-sm text-zinc-400 hover:text-white">
            Cancel
          </button>
        </div>
      )}

      {status === "connecting" && (
        <div className="text-center py-4">
          <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Connecting to live stage...</p>
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
          <button onClick={endStream} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20">
            End Stream
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {errorMsg || "Something went wrong"}
          </div>
          <button onClick={() => { setStatus("idle"); setErrorMsg(null); }} className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">
            Try Again
          </button>
        </div>
      )}

      {status === "ended" && (
        <div className="text-center py-4">
          <p className="text-sm text-zinc-500">Stream ended</p>
          <button onClick={() => setStatus("idle")} className="mt-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">
            Go Live Again
          </button>
        </div>
      )}
    </div>
  );
}
