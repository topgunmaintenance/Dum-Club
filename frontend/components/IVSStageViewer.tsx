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
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<any>(null);

  const joinStage = useCallback(async () => {
    setStatus("connecting");
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
      console.log("[ivs-viewer] Viewer token received");

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
          console.log("[ivs-viewer] CONNECTED — waiting for host streams");
          setStatus("watching");
        } else if (state === ConnectionState.DISCONNECTED) {
          console.log("[ivs-viewer] DISCONNECTED");
          setStatus("ended");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
        console.log("[ivs-viewer] Participant joined:", participant?.userId, participant?.isLocal ? "(local)" : "(remote/host)");
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("[ivs-viewer] Streams received from:", participant?.userId,
          "count:", streams?.length,
          "kinds:", streams?.map((s: any) => s.mediaStreamTrack?.kind));

        if (!streams || streams.length === 0) {
          console.warn("[ivs-viewer] No streams in event");
          return;
        }

        // Attach tracks to our persistent video/audio elements
        for (const stageStream of streams) {
          const track = stageStream.mediaStreamTrack;
          if (!track) {
            console.warn("[ivs-viewer] Stream has no mediaStreamTrack");
            continue;
          }

          console.log("[ivs-viewer] Attaching track:", track.kind, "readyState:", track.readyState, "enabled:", track.enabled);

          if (track.kind === "video" && videoRef.current) {
            // Use a MediaStream with this single track
            const ms = new MediaStream([track]);
            videoRef.current.srcObject = ms;
            videoRef.current.play().catch(() => {
              // Autoplay policy — mute and retry
              console.log("[ivs-viewer] Autoplay blocked, muting and retrying");
              if (videoRef.current) {
                videoRef.current.muted = true;
                videoRef.current.play().catch((e) => {
                  console.error("[ivs-viewer] Video play failed even muted:", e);
                });
              }
            });
            console.log("[ivs-viewer] Video track attached to <video> element");
          } else if (track.kind === "audio" && audioRef.current) {
            const ms = new MediaStream([track]);
            audioRef.current.srcObject = ms;
            audioRef.current.play().catch(() => {});
            console.log("[ivs-viewer] Audio track attached to <audio> element");
          }
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (participant: any, streams: any[]) => {
        console.log("[ivs-viewer] Streams removed from:", participant?.userId);
        if (videoRef.current) videoRef.current.srcObject = null;
        if (audioRef.current) audioRef.current.srcObject = null;
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-viewer] Participant left:", participant?.userId);
        if (videoRef.current) videoRef.current.srcObject = null;
        if (audioRef.current) audioRef.current.srcObject = null;
        setStatus("ended");
      });

      console.log("[ivs-viewer] Joining stage...");
      await stage.join();
      console.log("[ivs-viewer] stage.join() resolved — connected");

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
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      {/* Video element — always in DOM, visible when watching */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          width: "100%",
          aspectRatio: "16/9",
          objectFit: "cover",
          display: status === "watching" ? "block" : "none",
        }}
      />
      {/* Hidden audio element for separate audio track */}
      <audio ref={audioRef} autoPlay style={{ display: "none" }} />

      {/* Status overlays */}
      {(status === "loading" || status === "connecting") && (
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
          <div className="text-center">
            <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">Connecting to live stream...</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
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
        <div className="flex items-center justify-center bg-zinc-900" style={{ aspectRatio: "16/9" }}>
          <p className="text-sm text-zinc-500">Stream has ended</p>
        </div>
      )}
    </div>
  );
}
