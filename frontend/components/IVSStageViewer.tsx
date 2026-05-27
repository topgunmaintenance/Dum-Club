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
  // Per-instance guard. The module-level `_activeStageProjectId`
  // alone can't catch React StrictMode double-mounts in dev or a
  // rapid prop-change re-run, because both pass the guard check
  // before the cleanup that nulls it out runs. The ref makes each
  // mount idempotent: even if useEffect fires twice for the same
  // instance, the second pass short-circuits before calling
  // stage.join() and the backend doesn't see a duplicate viewer.
  const joinAttemptedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    // Per-instance: this useEffect already ran for this mount.
    if (joinAttemptedRef.current) {
      return;
    }
    // Module-level: another mount of the same project elsewhere
    // (e.g., the full overlay opened while the bubble preview is
    // still subscribed) is already holding the slot. Bail rather
    // than double-counting the visitor against MAX_VIEWERS_PER_STREAM.
    if (_activeStageProjectId === projectId) {
      console.log("[ivs-viewer] Stage already active for this project, skipping");
      return;
    }
    joinAttemptedRef.current = true;
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
      // Reset both guards in cleanup so a genuine re-mount on
      // the same instance (StrictMode dev double-mount or a
      // prop change) can join cleanly the second time.
      joinAttemptedRef.current = false;
      _activeStageProjectId = null;
    };
  }, [projectId, userId]);

  return (
    // P0 Android-viewer fix: restore a small min-height floor on the
    // wrapper. PR #249 removed both the wrapper's min-height: 200 and
    // the video's min-height: 300 in pursuit of an iPhone crop fix
    // (300px floor on a 219px natural-16:9 mobile box was forcing
    // object-fit: cover to crop ~70px off each side). Removing the
    // 300px crop trigger was correct; removing the wrapper's 200px
    // safety net was the regression. On Android Chrome / Samsung
    // Internet, a <video> with aspect-ratio: 16/9 + srcObject from
    // a freshly-attached WebRTC MediaStream can render at 0px height
    // for the first ~frame, and some Android browsers then refuse to
    // engage playback into the now-zero-size element. The 180px floor
    // here is below the natural-16:9 height at every standard mobile
    // width (390 × 9/16 = 219, 360 × 9/16 = 202) so it never engages
    // on the layout — it's purely the pre-frame safety floor that
    // keeps the element non-collapsed long enough for WebRTC to bind.
    <div className="relative min-h-[180px] overflow-hidden rounded-2xl border border-zinc-800 bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        // P0 Android fix: belt-and-suspenders signals for hasVideo.
        // 1. onCanPlay — fires the moment the element has enough
        //    decoded data to start playback. On Android, this is
        //    a more reliable signal than the play() promise
        //    resolution we already use in STREAMS_ADDED, which can
        //    silently never resolve on some Chromium-based mobile
        //    browsers when WebRTC attaches into a freshly-rendered
        //    video element.
        // 2. onLoadedMetadata — fires when intrinsic dimensions
        //    (videoWidth/videoHeight) are known. Catches the case
        //    where WebRTC successfully decoded a frame but the
        //    canplay event was throttled / batched away.
        // 3. onError — surfaces decode / source errors so they're
        //    visible in the UI (the "Waiting for host video..."
        //    overlay swaps to an error message via errorMsg state).
        // Existing play().then() path in STREAMS_ADDED is preserved
        // as the primary signal; these are additive safety nets.
        onCanPlay={() => {
          if (videoRef.current?.srcObject) {
            console.log("[ivs-viewer] onCanPlay fired — marking hasVideo");
            if (mountedRef.current) setHasVideo(true);
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v?.srcObject) {
            console.log("[ivs-viewer] onLoadedMetadata", v.videoWidth, "x", v.videoHeight);
            if (mountedRef.current && v.videoWidth > 0) setHasVideo(true);
          }
        }}
        onError={(e) => {
          const el = e.currentTarget;
          const code = el.error?.code;
          const msg = el.error?.message || "Video element error";
          console.error("[ivs-viewer] video onError code:", code, "msg:", msg);
          if (mountedRef.current) setErrorMsg(`Playback error (${code}): ${msg}`);
        }}
        // Aspect-ratio drives the natural height; the 180px floor on
        // BOTH the wrapper and this element is the WebRTC-attachment
        // safety floor described above, not a layout choice. On a
        // 390px portrait phone the natural box is 219px (above the
        // floor); on a 360px the natural box is 202px (still above);
        // the floor only engages pre-first-frame to prevent 0px
        // collapse.
        className="block min-h-[180px] w-full bg-zinc-900"
        style={{ aspectRatio: "16/9", objectFit: "cover" }}
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
