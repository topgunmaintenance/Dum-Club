/**
 * attachVideoSource — plays a video URL in ANY browser (embed/replay
 * audit 2026-07-07).
 *
 * IVS records replays as HLS (.m3u8 playlists). A bare <video src>
 * plays HLS natively only in Safari; Chrome/Firefox/Android show a
 * black box. This helper feeds mp4/webm (merchant uploads) straight
 * to the element, and for HLS lazy-loads hls.js from the CDN once and
 * attaches a MediaSource pipeline. Idempotent per element+src so ref
 * callbacks can call it on every render.
 */

let hlsPromise: Promise<any> | null = null;

function loadHlsJs(): Promise<any> {
  const w = window as any;
  if (w.Hls) return Promise.resolve(w.Hls);
  if (!hlsPromise) {
    hlsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js";
      s.async = true;
      s.onload = () => resolve((window as any).Hls);
      s.onerror = () => reject(new Error("hls.js failed to load"));
      document.head.appendChild(s);
    });
  }
  return hlsPromise;
}

export function attachVideoSource(el: HTMLVideoElement | null, src: string | null | undefined): void {
  if (!el || !src) return;
  if (el.dataset.dumSrc === src) return; // already wired for this URL
  el.dataset.dumSrc = src;

  // Audit finding 5 (2026-07-07): destroy any previous Hls pipeline
  // before re-attaching, or a URL swap leaves the old instance polling
  // segments against the same element forever.
  const prev = (el as any).__dumHls;
  if (prev) {
    try {
      prev.destroy();
    } catch {
      /* already dead */
    }
    (el as any).__dumHls = null;
  }

  const isHls = src.split("?")[0].endsWith(".m3u8");
  const nativeHls = el.canPlayType("application/vnd.apple.mpegurl") !== "";
  if (!isHls || nativeHls) {
    el.src = src;
    return;
  }
  loadHlsJs()
    .then((Hls) => {
      // Stale-src guard (finding 5): if the URL changed while the CDN
      // script loaded, let the newer attach win — don't wire the old one.
      if (el.dataset.dumSrc !== src) return;
      if (!Hls || !Hls.isSupported()) {
        el.src = src; // last resort — some browsers may still cope
        return;
      }
      const hls = new Hls({ enableWorker: false });
      (el as any).__dumHls = hls;
      hls.loadSource(src);
      hls.attachMedia(el);
    })
    .catch(() => {
      if (el.dataset.dumSrc === src) el.src = src;
    });
}

/** True when the element is genuinely presenting video a human could be
 *  watching — used by the metering beats so nobody is billed for a
 *  paused, errored, or never-started player (audit finding 4). */
export function isActuallyPlaying(el: HTMLVideoElement | null): boolean {
  if (!el) return false;
  return !el.paused && !el.ended && !el.error && el.readyState >= 2;
}
