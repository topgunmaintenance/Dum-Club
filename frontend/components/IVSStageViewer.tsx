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
  const pendingTrackRef = useRef<MediaStreamTrack | null>(null);

  const attachVideoTrack = useCallback((track: MediaStreamTrack) => {
    const videoEl = videoRef.current;
    if (!videoEl) {
      console.warn("[ivs-viewer] videoRef null — storing pending track");
      pendingTrackRef.current = track;
      return;
    }
    console.log("[ivs-viewer] ATTACHING video track:", track.kind, track.readyState, track.enabled);
    const ms = new MediaStream([track]);
    videoEl.srcObject = ms;
    console.log("[ivs-viewer] srcObject set:", videoEl.srcObject !== null);
    videoEl.muted = true;
    videoEl.play().then(() => {
      console.log("[ivs-viewer] play() OK, dimensions:", videoEl.videoWidth, "x", videoEl.videoHeight);
      setHasVideo(true);
    }).catch((e) => {
      console.error("[ivs-viewer] play() failed:", e.message);
    });
  }, []);

  useEffect(() => {
    if (videoRef.current && pendingTrackRef.current) {
      attachVideoTrack(pendingTrackRef.current);
      pendingTrackRef.current = null;
    }
  });

  const joinStage = useCallback(async () => {
    setStatus("connecting");
    setHasVideo(false);

    try {
      const res = await fetch(`${API_BASE}/api/ivs/viewer-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Token failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.token) throw new Error("No token");
      console.log("[ivs-viewer] Token OK, length:", data.token.length);

      const IVS = await import("amazon-ivs-web-broadcast");
      console.log("[ivs-viewer] SDK loaded, available exports:", Object.keys(IVS).filter(k => !k.startsWith("_")).join(", "));

      const { Stage, StageEvents, ConnectionState, SubscribeType } = IVS;
      console.log("[ivs-viewer] StageEvents:", JSON.stringify(StageEvents));

      const strategy = {
        stageStreamsToPublish: () => [],
        shouldPublishParticipant: () => false,
        shouldSubscribeToParticipant: (participant: any) => {
          console.log("[ivs-viewer] shouldSubscribe for:", participant?.userId, "isLocal:", participant?.isLocal, "→ AUDIO_VIDEO");
          return SubscribeType.AUDIO_VIDEO;
        },
      };

      const stage = new Stage(data.token, strategy);
      stageRef.current = stage;

      // === LOG EVERY SINGLE EVENT ===
      const allEvents = Object.values(StageEvents) as string[];
      console.log("[ivs-viewer] Registering listeners for ALL events:", allEvents);
      for (const eventName of allEvents) {
        stage.on(eventName, (...args: any[]) => {
          console.log(`[IVS-EVENT] ${eventName}`, args.length, "args");
          // For streams events, deep log
          if (eventName.includes("Stream") || eventName.includes("stream")) {
            args.forEach((arg: any, i: number) => {
              if (Array.isArray(arg)) {
                console.log(`  arg[${i}] is array, length:`, arg.length);
                arg.forEach((item: any, j: number) => {
                  console.log(`    [${j}] keys:`, Object.keys(item || {}));
                  console.log(`    [${j}] .mediaStreamTrack:`, item?.mediaStreamTrack);
                  console.log(`    [${j}] .streamType:`, item?.streamType);
                  console.log(`    [${j}] .isMuted:`, item?.isMuted);
                  if (item?.mediaStreamTrack) {
                    console.log(`    [${j}] track.kind:`, item.mediaStreamTrack.kind);
                    console.log(`    [${j}] track.readyState:`, item.mediaStreamTrack.readyState);
                  }
                });
              } else if (arg && typeof arg === "object") {
                console.log(`  arg[${i}]:`, JSON.stringify({
                  userId: arg.userId,
                  isLocal: arg.isLocal,
                  isPublishing: arg.isPublishing,
                  id: arg.id,
                }));
              }
            });
          }
        });
      }

      // === SPECIFIC HANDLERS ===
      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        console.log("[ivs-viewer] CONNECTION:", state);
        if (state === ConnectionState.CONNECTED) {
          setStatus("watching");
        } else if (state === ConnectionState.DISCONNECTED) {
          setStatus("ended");
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
        console.log("[ivs-viewer] ★★★ STREAMS_ADDED ★★★");
        console.log("[ivs-viewer] participant:", participant?.userId, "isLocal:", participant?.isLocal);
        console.log("[ivs-viewer] stream count:", streams?.length);

        if (!streams) return;

        for (let i = 0; i < streams.length; i++) {
          const s = streams[i];
          const track = s?.mediaStreamTrack;
          console.log(`[ivs-viewer] stream[${i}]:`, {
            hasTrack: !!track,
            trackKind: track?.kind,
            trackState: track?.readyState,
            streamType: s?.streamType,
            isMuted: s?.isMuted,
          });

          if (track instanceof MediaStreamTrack) {
            if (track.kind === "video") {
              attachVideoTrack(track);
            } else if (track.kind === "audio") {
              try {
                const a = new Audio();
                a.srcObject = new MediaStream([track]);
                a.autoplay = true;
                a.play().catch(() => {});
              } catch {}
            }
          }
        }
      });

      stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: any) => {
        console.log("[ivs-viewer] LEFT:", p?.userId, "isLocal:", p?.isLocal);
        if (!p?.isLocal) {
          if (videoRef.current) videoRef.current.srcObject = null;
          setHasVideo(false);
          setStatus("ended");
        }
      });

      console.log("[ivs-viewer] Calling stage.join()...");
      await stage.join();
      console.log("[ivs-viewer] stage.join() resolved");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      console.error("[ivs-viewer] ERROR:", msg, err);
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
        style={{ width: "100%", minHeight: 300, aspectRatio: "16/9", objectFit: "cover", background: "#111" }}
      />

      {!hasVideo && (status === "loading" || status === "connecting" || status === "watching") && (
        <div className="absolute inset-0 flex items-center justify-center">
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
            <p className="text-sm text-red-400">{errorMsg}</p>
            <button onClick={() => { setErrorMsg(null); joinStage(); }}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-white">
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
