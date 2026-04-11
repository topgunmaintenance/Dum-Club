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
  const stageRef = useRef<any>(null);
  // Store pending streams if they arrive before ref is ready
  const pendingTrackRef = useRef<MediaStreamTrack | null>(null);

  // Attach a video track to the video element
  const attachVideoTrack = useCallback((track: MediaStreamTrack) => {
    const videoEl = videoRef.current;
    if (!videoEl) {
      console.warn("[ivs-viewer] videoRef.current is null — storing pending track");
      pendingTrackRef.current = track;
      return;
    }
    console.log("[ivs-viewer] Attaching video track to element:", {
      kind: track.kind,
      readyState: track.readyState,
      enabled: track.enabled,
      id: track.id,
    });
    const ms = new MediaStream([track]);
    videoEl.srcObject = ms;

    // Log immediately after assignment
    console.log("[ivs-viewer] After attach — srcObject:", videoEl.srcObject);
    console.log("[ivs-viewer] After attach — readyState:", videoEl.readyState, "paused:", videoEl.paused);

    videoEl.play().then(() => {
      console.log("[ivs-viewer] play() OK — videoWidth:", videoEl.videoWidth, "videoHeight:", videoEl.videoHeight);
      setHasVideo(true);
    }).catch((e) => {
      console.warn("[ivs-viewer] play() failed:", e.message);
      videoEl.muted = true;
      videoEl.play().then(() => {
        console.log("[ivs-viewer] play() muted OK");
        setHasVideo(true);
      }).catch((e2) => {
        console.error("[ivs-viewer] play() muted also failed:", e2.message);
      });
    });
  }, []);

  // Check for pending tracks when ref becomes available
  useEffect(() => {
    if (videoRef.current && pendingTrackRef.current) {
      console.log("[ivs-viewer] Attaching pending track from ref");
      attachVideoTrack(pendingTrackRef.current);
      pendingTrackRef.current = null;
    }
  });

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
      if (!data.token) throw new Error("No viewer token received");
      console.log("[ivs-viewer] Token received, length:", data.token.length);

      const { Stage, StageEvents, ConnectionState, SubscribeType } =
        await import("amazon-ivs-web-broadcast");
      console.log("[ivs-viewer] SDK loaded");

      const strategy = {
        stageStreamsToPublish: () => [],
        shouldPublishParticipant: () => false,
        shouldSubscribeToParticipant: () => {
          console.log("[ivs-viewer] shouldSubscribeToParticipant → AUDIO_VIDEO");
          return SubscribeType.AUDIO_VIDEO;
        },
      };

      const stage = new Stage(data.token, strategy);
      stageRef.current = stage;

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-viewer] Connection:", state);
        if (state === ConnectionState.CONNECTED) {
          setStatus("watching");
        } else if (state === ConnectionState.DISCONNECTED) {
          setStatus("ended");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (p: any) => {
        console.log("[ivs-viewer] PARTICIPANT_JOINED:", {
          userId: p?.userId,
          isLocal: p?.isLocal,
          isPublishing: p?.isPublishing,
        });
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("========================================");
        console.log("[ivs-viewer] STREAMS_ADDED event fired");
        console.log("[ivs-viewer] participant:", JSON.stringify({
          userId: participant?.userId,
          isLocal: participant?.isLocal,
          isPublishing: participant?.isPublishing,
        }));
        console.log("[ivs-viewer] streams count:", streams?.length);

        if (!streams || streams.length === 0) {
          console.warn("[ivs-viewer] Empty streams array");
          return;
        }

        // Log every property of each stream object
        streams.forEach((s: any, i: number) => {
          console.log(`[ivs-viewer] Stream[${i}] full object keys:`, Object.keys(s || {}));
          console.log(`[ivs-viewer] Stream[${i}] typeof:`, typeof s);
          console.log(`[ivs-viewer] Stream[${i}].mediaStreamTrack:`, s?.mediaStreamTrack);
          console.log(`[ivs-viewer] Stream[${i}].streamType:`, s?.streamType);
          console.log(`[ivs-viewer] Stream[${i}].isMuted:`, s?.isMuted);
          console.log(`[ivs-viewer] Stream[${i}].id:`, s?.id);

          // Try every known property name
          const track = s?.mediaStreamTrack || s?.track || s?._track;
          if (track && track instanceof MediaStreamTrack) {
            console.log(`[ivs-viewer] Stream[${i}] GOT TRACK:`, track.kind, track.readyState);
            if (track.kind === "video") {
              attachVideoTrack(track);
            } else if (track.kind === "audio") {
              // Create audio element for audio track
              try {
                const audio = new Audio();
                audio.srcObject = new MediaStream([track]);
                audio.autoplay = true;
                audio.play().catch(() => {});
                console.log("[ivs-viewer] Audio attached via new Audio()");
              } catch (ae) {
                console.error("[ivs-viewer] Audio attach failed:", ae);
              }
            }
          } else {
            console.error(`[ivs-viewer] Stream[${i}] NO VALID TRACK FOUND`);
            console.log(`[ivs-viewer] Stream[${i}] raw dump:`, s);
            // Last resort: try to iterate all properties
            try {
              for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(s) || {})) {
                if (key.toLowerCase().includes("track") || key.toLowerCase().includes("stream") || key.toLowerCase().includes("media")) {
                  console.log(`[ivs-viewer] Stream[${i}] proto.${key}:`, typeof s[key] === "function" ? "function" : s[key]);
                }
              }
            } catch {}
          }
        });
        console.log("========================================");
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (participant: any) => {
        console.log("[ivs-viewer] STREAMS_REMOVED:", participant?.userId);
        if (videoRef.current) videoRef.current.srcObject = null;
        setHasVideo(false);
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
        console.log("[ivs-viewer] PARTICIPANT_LEFT:", participant?.userId, "isLocal:", participant?.isLocal);
        if (!participant?.isLocal) {
          if (videoRef.current) videoRef.current.srcObject = null;
          setHasVideo(false);
          setStatus("ended");
        }
      });

      console.log("[ivs-viewer] Joining stage...");
      await stage.join();
      console.log("[ivs-viewer] Joined OK");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join stream";
      console.error("[ivs-viewer] Error:", msg, err);
      setErrorMsg(msg);
      setStatus("error");
    }
  }, [projectId, userId, attachVideoTrack]);

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
        }}
      />

      {!hasVideo && (status === "loading" || status === "connecting" || status === "watching") && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
          <div className="text-center">
            <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">
              {status === "watching" ? "Waiting for host video..." : "Connecting..."}
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90">
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
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90">
          <p className="text-sm text-zinc-500">Stream has ended</p>
        </div>
      )}
    </div>
  );
}
