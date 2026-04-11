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
  const strategyRef = useRef<any>(null);

  // Request camera and show preview
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
      console.log("[ivs-host] Camera acquired:", stream.getTracks().map(t => `${t.kind}:${t.label}`));
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

  // Go live: create stage, get token, join as publisher
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

      let data: any;
      if (!res.ok) {
        if (res.status === 409) {
          // Stage already exists — get a fresh host token
          console.log("[ivs-host] Stage already exists, requesting host token...");
          const tokenRes = await fetch(`${API_BASE}/api/ivs/host-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json", user_id: userId },
            body: JSON.stringify({ project_id: projectId }),
          });
          if (!tokenRes.ok) {
            const tokenErr = await tokenRes.json().catch(() => ({}));
            throw new Error(tokenErr.detail || "Failed to get host token");
          }
          const tokenData = await tokenRes.json();
          data = { host_token: tokenData.token, stage_id: "existing" };
        } else {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Stage creation failed (${res.status})`);
        }
      } else {
        data = await res.json();
      }
      console.log("[ivs-host] Stage created:", data.stage_id);

      if (!data.host_token) {
        throw new Error("No host token received");
      }

      // 2. Load IVS SDK dynamically
      const { Stage, LocalStageStream, StageEvents, ConnectionState, SubscribeType } = await import("amazon-ivs-web-broadcast");

      // 3. Create stage with strategy
      const stream = cameraStreamRef.current;
      if (!stream) throw new Error("Camera stream lost");

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!videoTrack || !audioTrack) throw new Error("Missing video or audio track");

      // Strategy tells IVS what to publish
      const strategy = {
        stageStreamsToPublish: () => {
          if (!videoTrack.readyState || videoTrack.readyState === "ended") return [];
          return [
            new LocalStageStream(videoTrack),
            new LocalStageStream(audioTrack),
          ];
        },
        shouldPublishParticipant: () => true,
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };
      strategyRef.current = strategy;

      // Create and join stage
      const stage = new Stage(data.host_token, strategy);
      stageRef.current = stage;

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-host] Connection state:", state);
        if (state === ConnectionState.CONNECTED) {
          setStatus("live");
          onLive();
        } else if (state === ConnectionState.DISCONNECTED) {
          console.log("[ivs-host] Disconnected from stage");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
        console.log("[ivs-host] Participant joined:", participant.userId);
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-host] Participant left:", participant.userId);
      });

      await stage.join();
      console.log("[ivs-host] Joined stage as publisher");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to go live";
      console.error("[ivs-host] Error:", msg);
      setErrorMsg(msg);
      setStatus("error");
      onError(msg);
    }
  }, [projectId, userId, onLive, onError]);

  // End stream
  const endStream = useCallback(async () => {
    console.log("[ivs-host] Ending stream...");

    // Leave stage
    if (stageRef.current) {
      try { stageRef.current.leave(); } catch {}
      stageRef.current = null;
    }

    // Stop camera
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop());
      cameraStreamRef.current = null;
    }

    // Tell backend
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

  // Cleanup on unmount
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
      {/* Preview video (always rendered, hidden when not previewing) */}
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

      {/* Status + Controls */}
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
          <button
            onClick={goLive}
            className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400"
          >
            Start Live
          </button>
          <button
            onClick={() => { endStream(); setStatus("idle"); }}
            className="rounded-xl border border-zinc-800 px-5 py-3 text-sm text-zinc-400 hover:text-white"
          >
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
          <button
            onClick={endStream}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20"
          >
            End Stream
          </button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            {errorMsg || "Something went wrong"}
          </div>
          <button
            onClick={() => { setStatus("idle"); setErrorMsg(null); }}
            className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Try Again
          </button>
        </div>
      )}

      {status === "ended" && (
        <div className="text-center py-4">
          <p className="text-sm text-zinc-500">Stream ended</p>
          <button
            onClick={() => setStatus("idle")}
            className="mt-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white"
          >
            Go Live Again
          </button>
        </div>
      )}
    </div>
  );
}
