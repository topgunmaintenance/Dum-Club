"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type ViewerStatus = "loading" | "connecting" | "watching" | "ended" | "error";

interface IVSStageViewerProps {
  projectId: string;
  userId: string;
}

// Module-level guard to prevent multiple Stage instances across re-mounts
let _activeStageProjectId: string | null = null;

export function IVSStageViewer({ projectId, userId }: IVSStageViewerProps) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<any>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Guard: only one Stage instance per project across all mounts
    if (_activeStageProjectId === projectId) {
      console.log("[ivs-viewer] Stage already active for this project, skipping");
      return;
    }
    _activeStageProjectId = projectId;

    async function join() {
      setStatus("connecting");
      console.log("[ivs-viewer] === JOIN START (single) ===");

      try {
        // 1. Get token
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
        console.log("[ivs-viewer] Token OK");

        if (!mountedRef.current) return;

        // 2. Load SDK
        const IVS = await import("amazon-ivs-web-broadcast");
        const { Stage, StageEvents, ConnectionState, SubscribeType } = IVS;

        // 3. Strategy
        const strategy = {
          stageStreamsToPublish: () => [],
          shouldPublishParticipant: () => false,
          shouldSubscribeToParticipant: (participant: any) => {
            const sub = participant?.isLocal ? SubscribeType.NONE : SubscribeType.AUDIO_VIDEO;
            console.log("[ivs-viewer] shouldSubscribe:", participant?.userId, "isLocal:", participant?.isLocal, "→", sub);
            return sub;
          },
        };

        // 4. Create stage
        const stage = new Stage(data.token, strategy);
        stageRef.current = stage;

        // 5. Register ALL event listeners
        const allEvents = Object.values(StageEvents) as string[];
        for (const evt of allEvents) {
          stage.on(evt, (...args: any[]) => {
            const summary = args.map((a: any) => {
              if (Array.isArray(a)) return `[array:${a.length}]`;
              if (a && typeof a === "object") return JSON.stringify({ userId: a.userId, isLocal: a.isLocal, isPublishing: a.isPublishing, id: a.id });
              return String(a);
            }).join(", ");
            console.log(`[IVS] ${evt} → ${summary}`);
          });
        }

        // 6. Connection state
        stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
          if (!mountedRef.current) return;
          console.log("[ivs-viewer] CONNECTION:", state);
          if (state === ConnectionState.CONNECTED) setStatus("watching");
          else if (state === ConnectionState.DISCONNECTED) setStatus("ended");
        });

        // 7. Participant joined — log everything
        stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (p: any) => {
          console.log("[ivs-viewer] JOINED:", JSON.stringify({
            userId: p?.userId,
            id: p?.id,
            isLocal: p?.isLocal,
            isPublishing: p?.isPublishing,
            audioMuted: p?.audioMuted,
            videoStopped: p?.videoStopped,
            capabilities: p?.capabilities ? Array.from(p.capabilities) : [],
          }));
        });

        // 8. Subscribe state changed
        stage.on(StageEvents.STAGE_PARTICIPANT_SUBSCRIBE_STATE_CHANGED, (p: any, state: any) => {
          console.log("[ivs-viewer] SUBSCRIBE_STATE:", p?.userId, "isLocal:", p?.isLocal, "state:", state);
        });

        // 9. Publish state changed
        stage.on(StageEvents.STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, (p: any, state: any) => {
          console.log("[ivs-viewer] PUBLISH_STATE:", p?.userId, "isLocal:", p?.isLocal, "state:", state);
        });

        // 10. STREAMS ADDED — the critical handler
        stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
          console.log("[ivs-viewer] ★★★ STREAMS_ADDED ★★★");
          console.log("[ivs-viewer]   from:", participant?.userId, "isLocal:", participant?.isLocal);
          console.log("[ivs-viewer]   count:", streams?.length);

          if (!streams) return;
          for (let i = 0; i < streams.length; i++) {
            const s = streams[i];
            const track = s?.mediaStreamTrack;
            console.log(`[ivs-viewer]   stream[${i}]: type=${s?.streamType} muted=${s?.isMuted} hasTrack=${!!track} trackKind=${track?.kind} trackState=${track?.readyState}`);

            if (track instanceof MediaStreamTrack && track.kind === "video") {
              const videoEl = videoRef.current;
              if (!videoEl) {
                console.error("[ivs-viewer] videoRef is null!");
                return;
              }
              videoEl.srcObject = new MediaStream([track]);
              videoEl.muted = true;
              videoEl.play().then(() => {
                console.log("[ivs-viewer] play() OK:", videoEl.videoWidth, "x", videoEl.videoHeight);
                if (mountedRef.current) setHasVideo(true);
              }).catch(e => console.error("[ivs-viewer] play() failed:", e.message));
            }

            if (track instanceof MediaStreamTrack && track.kind === "audio") {
              console.log("[ivs-viewer] Setting up audio track:", track.id, "state:", track.readyState, "enabled:", track.enabled);
              try {
                // Store in ref to prevent garbage collection
                if (!audioRef.current) {
                  audioRef.current = new Audio();
                  // Whenever audio actually starts producing sound — whether
                  // via initial autoplay, the document-level click listener,
                  // or the visible "Tap to hear audio" overlay — hide the
                  // blocked overlay. Single source of truth for the UI state.
                  audioRef.current.addEventListener("playing", () => {
                    if (mountedRef.current) setAudioBlocked(false);
                  });
                }
                const a = audioRef.current;
                a.srcObject = new MediaStream([track]);
                a.muted = false;
                a.volume = 1.0;
                a.autoplay = true;
                // Optimistically show the "Tap to hear audio" overlay the
                // moment the audio track arrives. If autoplay succeeds, the
                // "playing" event listener above flips this back to false
                // within a frame. If autoplay is blocked, the existing
                // document-level recovery handler takes over. Doing this
                // BEFORE calling play() avoids a 30s+ delay waiting for the
                // play() promise to reject under autoplay policy.
                if (mountedRef.current) setAudioBlocked(true);
                a.play().then(() => {
                  console.log("[ivs-viewer] Audio play() OK — paused:", a.paused, "volume:", a.volume, "muted:", a.muted);
                }).catch((e) => {
                  console.warn("[ivs-viewer] Audio play() blocked by autoplay policy:", e.message);
                  // audioBlocked is already true from the pre-play set above;
                  // the visible overlay is therefore already on screen. The
                  // document-level listeners below remain the primary
                  // recovery path for the actual unmute.
                  // Autoplay was blocked — unmute on next user interaction
                  const unmute = () => {
                    a.play().then(() => console.log("[ivs-viewer] Audio resumed after user gesture")).catch(() => {});
                    document.removeEventListener("click", unmute);
                    document.removeEventListener("touchstart", unmute);
                  };
                  document.addEventListener("click", unmute, { once: true });
                  document.addEventListener("touchstart", unmute, { once: true });
                });
              } catch (e) {
                console.error("[ivs-viewer] Audio setup error:", e);
              }
            }
          }
        });

        // 11. Participant left
        stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: any) => {
          console.log("[ivs-viewer] LEFT:", p?.userId, "isLocal:", p?.isLocal);
          if (!p?.isLocal) {
            if (videoRef.current) videoRef.current.srcObject = null;
            if (mountedRef.current) { setHasVideo(false); setStatus("ended"); }
          }
        });

        // 12. Join
        console.log("[ivs-viewer] Calling stage.join()...");
        await stage.join();
        console.log("[ivs-viewer] stage.join() resolved");

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        console.error("[ivs-viewer] ERROR:", msg);
        if (mountedRef.current) { setErrorMsg(msg); setStatus("error"); }
      }
    }

    join();

    return () => {
      mountedRef.current = false;
      if (stageRef.current) {
        try { stageRef.current.leave(); } catch {}
        stageRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
        audioRef.current = null;
      }
      _activeStageProjectId = null;
    };
  }, [projectId, userId]);

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
            <button onClick={() => { setErrorMsg(null); _activeStageProjectId = null; setStatus("loading"); }}
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

      {/* ── Audio unmute banner ──────────────────────────────────────
           When the browser's autoplay policy blocks audio.play(), the
           existing document-level click/touchstart listener will resume
           playback on the next interaction — but viewers have no way to
           know audio is available. This overlay gives them a visible tap
           target. Dismisses automatically via the "playing" event listener
           on the audio element. */}
      {audioBlocked && hasVideo && (
        <button
          type="button"
          aria-label="Tap to hear audio"
          onClick={() => {
            // Direct resume as a belt-and-suspenders backup to the
            // existing document-level listener. Safe to call even if the
            // listener also fires — play() on an already-playing element
            // is a no-op. Do not change any other audio logic.
            const a = audioRef.current;
            if (a) a.play().catch(() => {});
          }}
          className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-400/50 bg-black/85 px-5 py-3 text-sm font-bold text-white shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_16px_rgba(0,255,163,0.15)] backdrop-blur-md transition hover:border-emerald-400/80 hover:bg-black/95 animate-pulse"
          style={{ minHeight: 44, minWidth: 44 }}
        >
          <span className="text-base leading-none">🔊</span>
          <span className="leading-none">Tap to hear audio</span>
        </button>
      )}
    </div>
  );
}
