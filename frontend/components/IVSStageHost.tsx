"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "../lib/apiBase";

// Dev-only debug log. NODE_ENV is inlined by Next.js's DefinePlugin
// at build time (this file has no @solana/web3.js import, so the
// inliner fires correctly here). In production, the && short-circuits
// so the strings + JSON serialisations are never evaluated and the
// browser console stays clean during the demo recording.
const __debug = process.env.NODE_ENV === "development";

type HostStatus = "idle" | "requesting_camera" | "previewing" | "connecting" | "live" | "error" | "ended";

interface IVSStageHostProps {
  projectId: string;
  userId: string;
  autoStart?: boolean;
  onLive: () => void;
  onEnd: () => void;
  onError: (msg: string) => void;
  // Audit #4 Phase 3 (Q6) — pre-stream guard. When the merchant
  // clicks Go Live without a pinned offer, surface a confirm
  // dialog before requesting camera. Null / undefined means
  // "no pinned offer yet" → confirm fires; a non-empty string
  // (offer UUID) means everything's wired up → confirm skipped.
  pinnedOfferId?: string | null;
  // Optional Privy bearer-token resolver. When provided, the host
  // checks /api/merchant/trial-status on mount and hides the Go Live
  // button if the merchant's plan is suspended. Without it the gate
  // still works server-side (create-stage returns 402) but the UI
  // won't lead with a "Shop paused" notice.
  getToken?: () => Promise<string | null | undefined>;
}

// Stable refs outside component to survive re-renders and strict mode
let _stageInstance: any = null;
let _localStreams: any[] = [];
let _videoTrackId: string | null = null;
let _audioTrackId: string | null = null;

export function IVSStageHost({ projectId, userId, autoStart, onLive, onEnd, onError, pinnedOfferId, getToken }: IVSStageHostProps) {
  const [status, setStatus] = useState<HostStatus>(() => {
    // If stage exists from a previous render, stay in live state
    return _stageInstance ? "live" : "idle";
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // When getUserMedia fails, the browser's err.name tells us why
  // (NotAllowedError when the OS or browser blocks the permission,
  // NotFoundError when no camera/mic is attached, NotReadableError
  // when another app holds the device). The "Try Again" button alone
  // can't recover from a denied permission — the user has to flip
  // the setting in browser/OS first. errorKind drives the recovery
  // copy below the error banner so the merchant knows what to do
  // instead of staring at a raw "Permission denied" string.
  const [errorKind, setErrorKind] = useState<
    "permission_denied" | "no_device" | "device_busy" | "generic" | null
  >(null);
  // Suspension flag — Phase 2 grace-period rollout. When the merchant's
  // plan is suspended (3-day payment-failure grace elapsed without a
  // recovery), Go Live is replaced with a plain-English notice. The
  // backend /api/ivs/create-stage already rejects suspended hosts with
  // 402, but the UI should not lead them to a button that errors out.
  const [isSuspended, setIsSuspended] = useState(false);
  useEffect(() => {
    if (!getToken) return;
    let cancelled = false;
    async function checkSuspension() {
      try {
        const token = await getToken!();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/merchant/trial-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setIsSuspended(Boolean(json?.is_suspended));
      } catch {
        // Fail open — never lock a host out of Go Live because of a
        // network blip checking trial status.
      }
    }
    checkSuspension();
    return () => { cancelled = true; };
  }, [getToken]);
  const previewRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Heartbeat poll handle. While the stage is live, the host
  // posts to /api/ivs/heartbeat every 5s so the backend can
  // detect an abrupt disconnect (tab close, laptop sleep,
  // network drop) and flip is_live=false within ~15s. Without
  // this, viewers landed on /embed/* and saw "Waiting for host
  // video..." indefinitely after a host crash.
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    const send = () => {
      // Fire-and-forget. A single failed beat doesn't end the
      // stream; the backend's 60s threshold tolerates up to
      // ~12 missed polls. Catch silently — we never want a
      // heartbeat failure to interrupt the live UI.
      fetch(`${API_BASE}/api/ivs/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
        keepalive: true,
      }).catch(() => {});
    };
    send(); // immediate first beat so the freshly-live state is recorded
    heartbeatTimerRef.current = setInterval(send, 5000);
  }

  const hasPinnedOffer = Boolean(
    pinnedOfferId && pinnedOfferId.trim() !== "",
  );

  const startPreview = useCallback(async () => {
    // Pinned-offer gate is now upstream of this call — the idle-state
    // UI swaps the "Start camera" button for a "Pin a featured item"
    // link when no offer is pinned, so the merchant never gets a
    // mid-flow window.confirm() dialog after they've already committed
    // to going live. If someone hits this path with no pin (e.g. an
    // autoStart caller), drop straight back to idle silently rather
    // than firing a permission prompt for a stream that won't be useful.
    if (typeof window !== "undefined" && !hasPinnedOffer) {
      setStatus("idle");
      return;
    }

    setStatus("requesting_camera");
    setErrorMsg(null);
    setErrorKind(null);
    __debug && console.log("[ivs-host] Requesting camera/mic");

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("This browser can't access your camera.");
      setErrorKind("generic");
      setStatus("error");
      onError("Camera not supported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      __debug && console.log("[ivs-host] Camera acquired:", stream.getTracks().map(t => `${t.kind}:${t.id}:${t.readyState}`));
      cameraStreamRef.current = stream;

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.play().catch(() => {});
      }
      setStatus("previewing");
    } catch (err) {
      // err.name is a DOMException identifier; cross-browser stable.
      // Map the three failure modes a real merchant actually hits to
      // friendly copy + an errorKind so the UI can show the right
      // recovery path. Anything else falls through to "generic".
      const name = err instanceof Error ? err.name : "";
      const rawMsg = err instanceof Error ? err.message : "Camera failed";
      let friendly = "Camera or microphone couldn't start.";
      let kind: typeof errorKind = "generic";
      if (name === "NotAllowedError" || name === "SecurityError") {
        friendly = "Camera and microphone access was blocked.";
        kind = "permission_denied";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        friendly = "No camera or microphone was found on this device.";
        kind = "no_device";
      } else if (name === "NotReadableError" || name === "AbortError") {
        friendly = "Your camera or microphone is being used by another app.";
        kind = "device_busy";
      }
      console.error("[ivs-host] getUserMedia failed:", name, rawMsg);
      setErrorMsg(friendly);
      setErrorKind(kind);
      setStatus("error");
      onError(rawMsg);
    }
  }, [onError, hasPinnedOffer]);

  useEffect(() => {
    if (autoStart && status === "idle") startPreview();
  }, [autoStart, status, startPreview]);

  // Permission-denied auto-recovery. When the merchant lands on the
  // permission_denied error state, the recovery copy tells them to
  // flip camera + mic on in the browser's address-bar prompt. The
  // moment that toggle lands, the Permissions API fires a change
  // event — we re-call startPreview() so the camera comes up without
  // them having to tap Try Again. Browsers that don't expose the
  // Permissions API (older Safari) just fall through to the manual
  // Try Again button below; nothing breaks.
  useEffect(() => {
    if (status !== "error" || errorKind !== "permission_denied") return;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const watch = async (name: PermissionName) => {
      try {
        const perm = await navigator.permissions.query({ name });
        if (cancelled) return;
        const handler = () => {
          if (cancelled) return;
          if (perm.state === "granted" || perm.state === "prompt") {
            startPreview();
          }
        };
        handler();
        perm.addEventListener("change", handler);
        cleanups.push(() => perm.removeEventListener("change", handler));
      } catch {
        // Unknown permission name on this browser — skip silently.
      }
    };

    watch("camera" as PermissionName);
    watch("microphone" as PermissionName);

    return () => {
      cancelled = true;
      cleanups.forEach(fn => fn());
    };
  }, [status, errorKind, startPreview]);

  const goLive = useCallback(async () => {
    // Guard: don't rejoin if already connected
    if (_stageInstance) {
      __debug && console.log("[ivs-host] Stage already exists, skipping");
      setStatus("live");
      // Re-arm the heartbeat in case this is a re-mount on the
      // same module-level stage — without it, navigating away
      // and back would leave the host live in the UI but no
      // longer beating the backend.
      startHeartbeat();
      return;
    }

    setStatus("connecting");
    __debug && console.log("[ivs-host] Creating IVS stage...");

    try {
      const res = await fetch(`${API_BASE}/api/ivs/create-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: userId },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Stage creation failed (${res.status})`);
      }
      const data = await res.json();
      __debug && console.log("[ivs-host] Stage:", data.stage_id, "token:", !!data.host_token);
      if (!data.host_token) throw new Error("No host token");

      // Load SDK
      const { Stage, LocalStageStream, StageEvents, ConnectionState, SubscribeType } =
        await import("amazon-ivs-web-broadcast");

      // Get tracks — verify they're alive
      const stream = cameraStreamRef.current;
      if (!stream) throw new Error("Camera stream lost");
      const vt = stream.getVideoTracks()[0];
      const at = stream.getAudioTracks()[0];
      if (!vt || vt.readyState !== "live") throw new Error(`Video track not live: ${vt?.readyState}`);
      if (!at || at.readyState !== "live") throw new Error(`Audio track not live: ${at?.readyState}`);

      __debug && console.log("[ivs-host] Tracks verified:", {
        video: `id=${vt.id} state=${vt.readyState} enabled=${vt.enabled}`,
        audio: `id=${at.id} state=${at.readyState} enabled=${at.enabled}`,
      });

      // Create LocalStageStream ONCE — store in module-level vars
      if (!_localStreams.length || _videoTrackId !== vt.id || _audioTrackId !== at.id) {
        _localStreams = [new LocalStageStream(vt), new LocalStageStream(at)];
        _videoTrackId = vt.id;
        _audioTrackId = at.id;
        __debug && console.log("[ivs-host] LocalStageStreams created (new). Count:", _localStreams.length);
      } else {
        __debug && console.log("[ivs-host] LocalStageStreams reused (same track IDs). Count:", _localStreams.length);
      }

      // Frozen strategy — all references are stable
      const frozenStreams = _localStreams;
      const strategy = {
        stageStreamsToPublish: () => {
          __debug && console.log("[ivs-host] stageStreamsToPublish → returning", frozenStreams.length, "frozen streams");
          return frozenStreams;
        },
        shouldPublishParticipant: () => true,
        shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
      };

      // Create stage
      const stage = new Stage(data.host_token, strategy);
      _stageInstance = stage;

      // Log ALL events
      for (const evt of Object.values(StageEvents) as string[]) {
        stage.on(evt, (...args: any[]) => {
          const s = args.map((a: any) => {
            if (a && typeof a === "object") return JSON.stringify({ userId: a.userId, isLocal: a.isLocal, isPublishing: a.isPublishing, message: a.message, code: a.code });
            return String(a);
          }).join(", ");
          __debug && console.log(`[IVS-HOST] ${evt} → ${s}`);
        });
      }

      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
        __debug && console.log("[ivs-host] Connection:", state);
        if (state === ConnectionState.CONNECTED) {
          __debug && console.log("[ivs-host] ✓ CONNECTED — calling onLive");
          setStatus("live");
          startHeartbeat();
          onLive();
        }
      });

      __debug && console.log("[ivs-host] Joining stage...");
      await stage.join();
      __debug && console.log("[ivs-host] ✓ stage.join() resolved");

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      console.error("[ivs-host] Error:", msg, err);
      setErrorMsg(msg); setStatus("error"); onError(msg);
      _stageInstance = null;
      _localStreams = [];
    }
  }, [projectId, userId, onLive, onError]);

  const endStream = useCallback(async () => {
    __debug && console.log("[ivs-host] Ending stream (user action)...");

    // Stop heartbeat first so the explicit end isn't accompanied
    // by stray heartbeats racing the /end-stage call.
    stopHeartbeat();

    if (_stageInstance) {
      try { _stageInstance.leave(); } catch {}
      _stageInstance = null;
    }
    _localStreams = [];
    _videoTrackId = null;
    _audioTrackId = null;

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
    } catch {}

    setStatus("ended");
    onEnd();
  }, [projectId, userId, onEnd]);

  // Cleanup ONLY on true unmount (component removed from tree entirely)
  // Do NOT clean up on re-renders — stage must persist
  useEffect(() => {
    return () => {
      // Only clean up if the component is being removed from the page entirely
      // (not just a re-render). Check if we should keep the stage alive.
      // The module-level _stageInstance will persist across re-mounts.
      __debug && console.log("[ivs-host] useEffect cleanup — stage preserved in module scope");
      // Always stop the heartbeat interval on cleanup. If the
      // component is genuinely unmounting (navigation away, tab
      // close) the backend's 15s threshold will trip and the
      // bubble + Discover will flip to offline within seconds —
      // exactly the auto-end-stale behaviour we want.
      stopHeartbeat();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className={`overflow-hidden rounded-2xl border border-zinc-800 bg-black ${status === "previewing" || status === "live" ? "" : "hidden"}`}>
        <video ref={previewRef} autoPlay muted playsInline className="w-full" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
      </div>

      {status === "idle" && isSuspended && (
        <div className="text-center py-6">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
            !
          </div>
          <div className="text-sm font-bold text-zinc-200">Your shop is paused</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Going live is off until you update your payment method. Open your dashboard to fix it.
          </p>
          <a
            href="/dashboard"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover"
          >
            Open Dashboard →
          </a>
        </div>
      )}
      {status === "idle" && !isSuspended && !hasPinnedOffer && (
        // No pinned offer yet — surface the requirement before the
        // merchant taps Start camera, instead of catching them with a
        // confirm() dialog after they've already committed. The link
        // points at the offers section on the same page (the page-
        // level layout includes #offers-section), so the merchant
        // pins one item and lands right back here ready to go live.
        <div className="text-center py-4">
          <div className="mx-auto mb-5 max-w-md rounded-xl border border-default bg-surface-card px-4 py-3 text-left">
            <div className="text-sm font-semibold text-primary">
              Pick what you&apos;re selling first.
            </div>
            <div className="mt-1 text-xs text-secondary">
              Pin one featured item so viewers see something to buy
              the moment they join.
            </div>
          </div>
          <a
            href="#offers-section"
            className="inline-flex items-center justify-center rounded-2xl bg-brand-teal px-10 py-4 text-lg font-bold text-brand-navy shadow-lg transition hover:bg-brand-teal-hover hover:text-white active:scale-[0.98]"
          >
            Pin a featured item →
          </a>
          <p className="mt-3 text-sm text-zinc-500">Then you&apos;re one tap from live.</p>
        </div>
      )}

      {status === "idle" && !isSuspended && hasPinnedOffer && (
        <div className="text-center py-4">
          <ol className="mx-auto mb-5 max-w-md space-y-1 text-left text-sm text-zinc-400">
            <li><span className="font-bold text-zinc-200">1.</span> Tap Start camera.</li>
            <li><span className="font-bold text-zinc-200">2.</span> Allow camera and microphone.</li>
            <li><span className="font-bold text-zinc-200">3.</span> Customers see you on your website.</li>
          </ol>
          <button onClick={startPreview} className="rounded-2xl bg-red-500 px-10 py-4 text-lg font-bold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-400 active:scale-[0.98]">
            Start camera
          </button>
          <p className="mt-3 text-sm text-zinc-500">Start selling in seconds.</p>
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
          <button onClick={goLive} className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-400">Start Live</button>
          <button onClick={() => { endStream(); setStatus("idle"); }} className="rounded-xl border border-zinc-800 px-5 py-3 text-sm text-zinc-400 hover:text-white">Cancel</button>
        </div>
      )}

      {status === "connecting" && (
        <div className="text-center py-4">
          <div className="h-3 w-3 animate-ping rounded-full bg-red-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Connecting...</p>
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
          <button onClick={endStream} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20">End Stream</button>
        </div>
      )}

      {status === "error" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
            <div className="font-semibold">{errorMsg}</div>
            {errorKind === "permission_denied" && (
              <div className="mt-2 text-xs leading-relaxed text-red-400/80">
                Tap the camera or lock icon in your browser&apos;s address bar
                and allow camera and microphone for this site, then tap
                Try Again. On iPhone or Android, you may need to open
                Settings and turn camera and microphone on for your
                browser.
              </div>
            )}
            {errorKind === "no_device" && (
              <div className="mt-2 text-xs leading-relaxed text-red-400/80">
                Plug in a camera and microphone (or use a phone with
                them built in), then tap Try Again.
              </div>
            )}
            {errorKind === "device_busy" && (
              <div className="mt-2 text-xs leading-relaxed text-red-400/80">
                Close any other app using your camera (Zoom, FaceTime,
                another browser tab), then tap Try Again.
              </div>
            )}
          </div>
          <button onClick={startPreview} className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">Try Again</button>
        </div>
      )}

      {status === "ended" && (
        <div className="text-center py-4">
          <p className="text-sm text-zinc-500">Stream ended</p>
          <button onClick={() => setStatus("idle")} className="mt-2 rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-white">Go Live Again</button>
        </div>
      )}
    </div>
  );
}
