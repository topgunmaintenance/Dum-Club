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

  const isHls = src.split("?")[0].endsWith(".m3u8");
  const nativeHls = el.canPlayType("application/vnd.apple.mpegurl") !== "";
  if (!isHls || nativeHls) {
    el.src = src;
    return;
  }
  loadHlsJs()
    .then((Hls) => {
      if (!Hls || !Hls.isSupported()) {
        el.src = src; // last resort — some browsers may still cope
        return;
      }
      const hls = new Hls({ enableWorker: false });
      hls.loadSource(src);
      hls.attachMedia(el);
    })
    .catch(() => {
      el.src = src;
    });
}
