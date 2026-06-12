"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type ViewerStatus = "loading" | "connecting" | "watching" | "reconnecting" | "ended" | "error";

interface IVSStageViewerProps {
  projectId: string;
  userId: string;
  // Compact muted-autoplay mode for the homepage LiveRail cards:
  // video only (no audio element, no tap-to-hear overlay, no error
  // copy beyond the spinner), smaller pre-frame height floor, and the
  // viewer-token request is tagged context:"homepage_preview" so
  // future metering can tell preview joins from watch-view joins.
  // Everything else (claim/wait guard, retries, token refresh) is
  // identical to the full watch view.
  preview?: boolean;
}

// Module-level dedup: at most one active stage subscription per project
// across all mounted viewer instances (e.g. the embed bubble preview and
// the full overlay on the same page), so one visitor isn't double-counted
// against the viewer cap. Claims are owner-tagged so an instance can only
// release its OWN claim, and a loser WAITS for the slot instead of bailing
// permanently — the old single-variable guard left the second mount on a
// silent black "Connecting..." with no path to ever join.
let _claimSeq = 0;
const _activeClaims = new Map<string, number>(); // projectId -> claim owner

export function IVSStageViewer({ projectId, userId, preview = false }: IVSStageViewerProps) {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stageRef = useRef<any>(null);
  const mountedRef = useRef(true);
  // Re-join trigger. Bumping this re-runs the join effect from scratch
  // (cleanup of the previous run leaves the stage and releases the claim
  // first). The old Retry buttons only flipped `status`, which re-rendered
  // but never re-joined — every error/ended state was terminal.
  const [joinNonce, setJoinNonce] = useState(0);
  // Consecutive automatic retries since the last healthy connection.
  // Capped so a genuinely dead stream can't grind token mints against
  // the backend's per-viewer-per-session budget (MAX_TOKENS_PER_VIEWER).
  const autoRetriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  // Manual retry from the error / ended overlays.
  const manualRetry = () => {
    autoRetriesRef.current = 0;
    setErrorMsg(null);
    setHasVideo(false);
    setStatus("loading");
    setJoinNonce((n) => n + 1);
  };

  useEffect(() => {
    mountedRef.current = true;
    // Per-run cancellation. With joinNonce in the deps a re-join is an
    // ordinary effect re-run, so each run only needs to know whether IT
    // has been cleaned up. Stage event handlers close over this flag —
    // a late event from a left stage can't clobber the next run's state.
    let cancelled = false;
    const owner = ++_claimSeq;
    let claimed = false;
    let waitTimer: number | null = null;

    // Automatic retry with capped backoff: 2s / 4s / 8s, then give up
    // into `fallback` with the manual button as the recovery path.
    const scheduleAutoRetry = (fallback: ViewerStatus, msg?: string) => {
      if (cancelled || !mountedRef.current) return;
      const attempt = autoRetriesRef.current;
      setHasVideo(false);
      if (attempt >= 3) {
        if (msg) setErrorMsg(msg);
        setStatus(fallback);
        return;
      }
      autoRetriesRef.current = attempt + 1;
      setStatus("reconnecting");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setJoinNonce((n) => n + 1);
      }, 2000 * 2 ** attempt);
    };

    async function fetchToken(): Promise<string> {
      const res = await fetch(`${API_BASE}/api/ivs/viewer-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify(
          preview
            ? { project_id: projectId, context: "homepage_preview" }
            : { project_id: projectId }
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Token failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.token) throw new Error("No token");
      return data.token as string;
    }

    async function join() {
      setStatus(autoRetriesRef.current > 0 ? "reconnecting" : "connecting");
      console.log("[ivs-viewer] === JOIN START (single) ===");

      try {
        // 1. Get token
        let token = await fetchToken();
        console.log("[ivs-viewer] Token OK");
        if (cancelled) return;

        // 2. Load SDK
        const IVS = await import("amazon-ivs-web-broadcast");
        const { Stage, StageEvents, ConnectionState, SubscribeType } = IVS;
        if (cancelled) return;

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

        // 4-11. Build a stage with all listeners attached. Factored into
        // a function so the stale-stage retry below can rebuild from a
        // fresh token without duplicating handler registration.
        const buildStage = (tok: string) => {
          const stage = new Stage(tok, strategy);

          // Register ALL event listeners (debug visibility)
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

          // Connection state
          stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
            if (cancelled || !mountedRef.current) return;
            console.log("[ivs-viewer] CONNECTION:", state);
            if (state === ConnectionState.CONNECTED) {
              // Healthy again — reset the backoff budget.
              autoRetriesRef.current = 0;
              setStatus("watching");
            } else if (state === ConnectionState.DISCONNECTED) {
              // A disconnect can be a real stream end OR a network blip.
              // Auto-retry first; settle into "ended" when the budget is
              // spent (the manual button remains as recovery).
              scheduleAutoRetry("ended");
            }
          });

          // Participant joined — log everything
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

          // Subscribe state changed
          stage.on(StageEvents.STAGE_PARTICIPANT_SUBSCRIBE_STATE_CHANGED, (p: any, state: any) => {
            console.log("[ivs-viewer] SUBSCRIBE_STATE:", p?.userId, "isLocal:", p?.isLocal, "state:", state);
          });

          // Publish state changed
          stage.on(StageEvents.STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, (p: any, state: any) => {
            console.log("[ivs-viewer] PUBLISH_STATE:", p?.userId, "isLocal:", p?.isLocal, "state:", state);
          });

          // STREAMS ADDED — the critical handler
          stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (participant: any, streams: any[]) => {
            console.log("[ivs-viewer] ★★★ STREAMS_ADDED ★★★");
            console.log("[ivs-viewer]   from:", participant?.userId, "isLocal:", participant?.isLocal);
            console.log("[ivs-viewer]   count:", streams?.length);

            if (!streams || cancelled) return;
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
                  if (!cancelled && mountedRef.current) setHasVideo(true);
                }).catch(e => console.error("[ivs-viewer] play() failed:", e.message));
              }

              if (!preview && track instanceof MediaStreamTrack && track.kind === "audio") {
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
                      if (!cancelled && mountedRef.current) setAudioBlocked(false);
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
                  if (!cancelled && mountedRef.current) setAudioBlocked(true);
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

          // Participant left
          stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: any) => {
            console.log("[ivs-viewer] LEFT:", p?.userId, "isLocal:", p?.isLocal);
            if (!p?.isLocal) {
              if (videoRef.current) videoRef.current.srcObject = null;
              // A non-local LEFT is the genuine host-gone signal — no
              // auto-retry here; "Tap to check again" covers the
              // false-positive (works now: it re-runs the join effect).
              if (!cancelled && mountedRef.current) { setHasVideo(false); setStatus("ended"); }
            }
          });

          return stage;
        };

        // 12. Join — with ONE fresh-token rebuild if the first attempt is
        // rejected. Covers a stale/deleted stage or an expired token: the
        // backend mints against the CURRENT DB stage ARN, so a fresh token
        // heals an out-of-date first attempt instead of dead-ending.
        let stage = buildStage(token);
        try {
          console.log("[ivs-viewer] Calling stage.join()...");
          await stage.join();
        } catch (joinErr) {
          try { stage.leave(); } catch {}
          if (cancelled) return;
          const m = joinErr instanceof Error ? joinErr.message : String(joinErr);
          console.warn("[ivs-viewer] stage.join() failed — refreshing token once:", m);
          token = await fetchToken();
          if (cancelled) return;
          stage = buildStage(token);
          await stage.join();
        }
        console.log("[ivs-viewer] stage.join() resolved");

        if (cancelled) {
          try { stage.leave(); } catch {}
          return;
        }
        stageRef.current = stage;

      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        console.error("[ivs-viewer] ERROR:", msg);
        if (!cancelled && mountedRef.current) {
          setErrorMsg(msg);
          scheduleAutoRetry("error", msg);
        }
      }
    }

    // Claim the project's subscription slot, or wait for it. The waiting
    // instance polls until the holder unmounts (releasing the claim) and
    // then joins — replacing the old permanent bail that left the second
    // mount black forever.
    const claimOrWait = () => {
      if (cancelled) return;
      const holder = _activeClaims.get(projectId);
      if (holder === undefined) {
        _activeClaims.set(projectId, owner);
        claimed = true;
        join();
      } else {
        console.log("[ivs-viewer] Stage held by another instance, waiting for the slot...");
        waitTimer = window.setTimeout(claimOrWait, 1000);
      }
    };
    claimOrWait();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (waitTimer !== null) window.clearTimeout(waitTimer);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (stageRef.current) {
        try { stageRef.current.leave(); } catch {}
        stageRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
        audioRef.current = null;
      }
      // Release the slot only if THIS run owns it — a waiting (never-
      // claimed) instance must not free another instance's claim.
      if (claimed && _activeClaims.get(projectId) === owner) {
        _activeClaims.delete(projectId);
      }
    };
  }, [projectId, userId, joinNonce]);

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
    <div className={`relative overflow-hidden bg-black ${preview ? "min-h-[90px] rounded-lg" : "min-h-[180px] rounded-2xl border border-zinc-800"}`}>
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
        className={`block w-full bg-zinc-900 ${preview ? "min-h-[90px]" : "min-h-[180px]"}`}
        style={{ aspectRatio: "16/9", objectFit: "cover" }}
      />

      {!hasVideo && (status === "loading" || status === "connecting" || status === "reconnecting" || status === "watching") && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
            <p className="text-sm text-zinc-400">
              {status === "watching"
                ? "Waiting for host video..."
                : status === "reconnecting"
                  ? "Reconnecting..."
                  : "Connecting..."}
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90">
          <div className="text-center px-6">
            <p className="text-sm text-red-400">{errorMsg || "Stream connection failed."}</p>
            {/* Re-runs the join effect via manualRetry. The previous
                handler only flipped status, so the button never
                actually reconnected. */}
            <button onClick={manualRetry}
              className="mt-3 rounded-lg border border-zinc-800 px-4 py-2 text-xs text-zinc-400 hover:text-white">
              Retry
            </button>
          </div>
        </div>
      )}

      {status === "ended" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/90 px-6 text-center">
          <p className="text-sm text-zinc-400">Looks like the stream ended.</p>
          {/* Tap-to-retry: a real "stream ended" looks identical to a
              mobile-network blip from the customer's side. A retry
              that succeeds catches the false-positive; a retry that
              fails returns the same ended view + the same button.
              manualRetry re-runs the join effect from scratch (the
              previous handler only flipped status and never
              reconnected). */}
          <button
            type="button"
            onClick={manualRetry}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white"
          >
            Tap to check again
          </button>
        </div>
      )}

      {/* ── Audio unmute banner ──────────────────────────────────────
           When the browser's autoplay policy blocks audio.play(), the
           existing document-level click/touchstart listener will resume
           playback on the next interaction — but viewers have no way to
           know audio is available. This overlay gives them a visible tap
           target. Dismisses automatically via the "playing" event listener
           on the audio element. */}
      {!preview && audioBlocked && hasVideo && (
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
