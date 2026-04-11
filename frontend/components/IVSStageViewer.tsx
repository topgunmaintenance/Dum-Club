"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../lib/apiBase";

type ViewerStatus = "loading" | "connecting" | "watching" | "ended" | "error";

interface IVSStageViewerProps {
  projectId: string;
  userId: string;
}

export function IVSStageViewer({ projectId, userId }: IVSStageViewerProps) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<any>(null);

  const joinStage = useCallback(async () => {
    setStatus("connecting");
    setHasVideo(false);
    console.log("[ivs-viewer] Requesting viewer token...");

    try {
      const res = await fetch(`${API_BASE}/api/ivs/viewer-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Token request failed (${res.status})`);
      }

      const data = await res.json();
      if (!data.token) throw new Error("No viewer token received from server");
      console.log("[ivs-viewer] Viewer token received, length:", data.token.length);

      const { Stage, StageEvents, ConnectionState, SubscribeType } =
        await import("amazon-ivs-web-broadcast");
      console.log("[ivs-viewer] IVS SDK loaded");

      const strategy = {
        stageStreamsToPublish: () => [],
        shouldPublishParticipant: () => false,
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };

      const stage = new Stage(data.token, strategy);
      stageRef.current = stage;

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-viewer] Connection state:", state);
        if (state === ConnectionState.CONNECTED) {
          setStatus("watching");
        } else if (state === ConnectionState.DISCONNECTED) {
          setStatus("ended");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
        console.log("[ivs-viewer] Participant joined:", participant?.userId, "isLocal:", participant?.isLocal);
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("[ivs-viewer] === STREAMS ADDED ===");
        console.log("[ivs-viewer] From:", participant?.userId, "isLocal:", participant?.isLocal);
        console.log("[ivs-viewer] Stream count:", streams?.length);

        if (!streams || streams.length === 0) {
          console.warn("[ivs-viewer] No streams in event");
          return;
        }

        for (const stageStream of streams) {
          const track = stageStream.mediaStreamTrack;
          if (!track) {
            console.warn("[ivs-viewer] Stream missing mediaStreamTrack, checking isMuted:", stageStream.isMuted);
            continue;
          }

          console.log("[ivs-viewer] Track:", track.kind, "readyState:", track.readyState, "enabled:", track.enabled, "id:", track.id);

          if (track.kind === "video") {
            const videoEl = videoRef.current;
            if (!videoEl) {
              console.error("[ivs-viewer] VIDEO REF IS NULL — cannot attach track");
              return;
            }
            const ms = new MediaStream([track]);
            videoEl.srcObject = ms;
            console.log("[ivs-viewer] srcObject set on video element");
            console.log("[ivs-viewer] Video element state: muted=", videoEl.muted, "autoplay=", videoEl.autoplay, "readyState=", videoEl.readyState);
            console.log("[ivs-viewer] Video element size:", videoEl.offsetWidth, "x", videoEl.offsetHeight);

            videoEl.play().then(() => {
              console.log("[ivs-viewer] video.play() succeeded");
              setHasVideo(true);
            }).catch((e) => {
              console.warn("[ivs-viewer] video.play() failed:", e.message, "— retrying muted");
              videoEl.muted = true;
              videoEl.play().then(() => {
                console.log("[ivs-viewer] video.play() muted succeeded");
                setHasVideo(true);
              }).catch((e2) => {
                console.error("[ivs-viewer] video.play() muted also failed:", e2.message);
              });
            });
          } else if (track.kind === "audio") {
            const audioEl = audioRef.current;
            if (audioEl) {
              audioEl.srcObject = new MediaStream([track]);
              audioEl.play().catch(() => {});
              console.log("[ivs-viewer] Audio track attached");
            }
          }
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (participant: any) => {
        console.log("[ivs-viewer] Streams removed from:", participant?.userId);
        if (videoRef.current) videoRef.current.srcObject = null;
        if (audioRef.current) audioRef.current.srcObject = null;
        setHasVideo(false);
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-viewer] Participant left:", participant?.userId);
        if (!participant?.isLocal) {
          if (videoRef.current) videoRef.current.srcObject = null;
          if (audioRef.current) audioRef.current.srcObject = null;
          setHasVideo(false);
          setStatus("ended");
        }
      });

      console.log("[ivs-viewer] Joining stage...");
      await stage.join();
      console.log("[ivs-viewer] stage.join() resolved");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join stream";
      console.error("[ivs-viewer] Error:", msg, err);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [projectId, userId]);

  useEffect(() => {
    joinStage();
    return () => {
      if (stageRef.current) {
        try { stageRef.current.leave(); } catch {}
        stageRef.current = null;
      }
    };
  }, [joinStage]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black" style={{ minHeight: 200 }}>
      {/* Video — ALWAYS visible, muted for autoplay, red debug border */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          minHeight: 300,
          aspectRatio: "16/9",
          objectFit: "cover",
          background: "#111",
          border: hasVideo ? "none" : "2px solid #333",
        }}
      />
      <audio ref={audioRef} autoPlay style={{ display: "none" }} />

      {/* Status overlays — positioned OVER the video */}
      {!hasVideo && (status === "loading" || status === "connecting" || status === "watching") && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
          <div className="text-center">
            <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">
              {status === "watching" ? "Waiting for host video..." : "Connecting to live stream..."}
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center justify-center" style={{ minHeight: 200 }}>
          <div className="text-center px-6">
            <p className="text-sm text-red-400">{errorMsg || "Failed to load stream"}</p>
            <button
              onClick={() => { setErrorMsg(null); joinStage(); }}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-white"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {status === "ended" && (
        <div className="flex items-center justify-center" style={{ minHeight: 200 }}>
          <p className="text-sm text-zinc-500">Stream has ended</p>
        </div>
      )}
    </div>
  );
}
