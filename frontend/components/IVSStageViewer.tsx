"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../lib/apiBase";

type ViewerStatus = "loading" | "connecting" | "watching" | "reconnecting" | "ended" | "error";

interface IVSStageViewerProps {
  projectId: string;
  userId: string;
}

export function IVSStageViewer({ projectId, userId }: IVSStageViewerProps) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);

  const joinStage = useCallback(async () => {
    setStatus("connecting");
    console.log("[ivs-viewer] Requesting viewer token...");

    try {
      // 1. Get viewer token
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
      console.log("[ivs-viewer] Viewer token received");

      // 2. Load IVS SDK
      const IVSBroadcastClient = (await import("amazon-ivs-web-broadcast")).default;

      // 3. Create stage with subscriber strategy
      const strategy = {
        stageStreamsToPublish: () => [],
        shouldPublishParticipant: () => false,
        shouldSubscribeToParticipant: () => IVSBroadcastClient.SubscribeType.AUDIO_VIDEO,
      };

      const stage = new IVSBroadcastClient.Stage(data.token, strategy);
      stageRef.current = stage;

      // Handle connection state
      stage.on(IVSBroadcastClient.StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-viewer] Connection state:", state);
        if (state === IVSBroadcastClient.ConnectionState.CONNECTED) {
          setStatus("watching");
        } else if (state === IVSBroadcastClient.ConnectionState.DISCONNECTED) {
          setStatus("ended");
        }
      });

      // Handle remote participant streams
      stage.on(IVSBroadcastClient.StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("[ivs-viewer] Streams received from:", participant.userId, "count:", streams.length);

        const container = videoContainerRef.current;
        if (!container) return;

        // Clear previous video elements
        container.innerHTML = "";

        for (const stream of streams) {
          if (stream.mediaStreamTrack) {
            const mediaStream = new MediaStream([stream.mediaStreamTrack]);

            if (stream.mediaStreamTrack.kind === "video") {
              const video = document.createElement("video");
              video.srcObject = mediaStream;
              video.autoplay = true;
              video.playsInline = true;
              video.muted = false; // Viewers hear audio
              video.style.width = "100%";
              video.style.aspectRatio = "16/9";
              video.style.objectFit = "cover";
              video.style.borderRadius = "16px";
              container.appendChild(video);
              video.play().catch(() => {
                // Autoplay blocked — mute and retry
                video.muted = true;
                video.play().catch(() => {});
              });
            } else if (stream.mediaStreamTrack.kind === "audio") {
              const audio = document.createElement("audio");
              audio.srcObject = mediaStream;
              audio.autoplay = true;
              container.appendChild(audio);
            }
          }
        }
      });

      // Handle participant leaving
      stage.on(IVSBroadcastClient.StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-viewer] Host left:", participant.userId);
        if (videoContainerRef.current) {
          videoContainerRef.current.innerHTML = "";
        }
        setStatus("ended");
      });

      await stage.join();
      console.log("[ivs-viewer] Joined stage as subscriber");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join stream";
      console.error("[ivs-viewer] Error:", msg);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [projectId, userId]);

  // Join on mount
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
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      {status === "loading" || status === "connecting" ? (
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
          <div className="text-center">
            <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">Connecting to live stream...</p>
          </div>
        </div>
      ) : status === "error" ? (
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
          <div className="text-center px-6">
            <p className="text-sm text-red-400">{errorMsg || "Failed to load stream"}</p>
            <button
              onClick={() => { setStatus("loading"); joinStage(); }}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-white"
            >
              Retry
            </button>
          </div>
        </div>
      ) : status === "ended" ? (
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
          <p className="text-sm text-zinc-500">Stream has ended</p>
        </div>
      ) : null}

      {/* Video container — IVS SDK renders into this */}
      <div ref={videoContainerRef} className={status === "watching" ? "" : "hidden"} />
    </div>
  );
}
