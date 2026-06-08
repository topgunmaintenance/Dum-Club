/**
 * popinVideoUpload — uploads a phone-recorded video to the offers
 * Storage bucket via the server-mediated /api/popin/upload-video
 * endpoint (Path 2 hardening sprint PR 5 of 6 — the last browser-
 * direct anon-key upload site is gone after this PR). Validation
 * lives here so we fail-fast in the dashboard before the network
 * hop; the backend re-validates as defense-in-depth.
 *
 * The returned URL ultimately flows into `projects.popin_config.
 * video_url`, where the existing PR #136 backend sanitizer enforces
 * http(s)-only + 2048-char cap as a safety net.
 *
 * This module is a plain .ts helper (not a React component), so the
 * Privy bearer is threaded in by the caller (PopInSettings.tsx)
 * rather than fetched inside. Keeps the helper testable in isolation
 * and avoids coupling lib code to the auth provider.
 */

import { API_BASE } from "./apiBase";

// 50 MB client-side ceiling — matches the Supabase project default
// and fits ~60s of 1080p mobile video. Larger files reject before
// the network hop, sparing slow mobile uploads.
export const POPIN_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

// MIME allow-list. video/quicktime covers iPhone's default .mov
// recording. Some desktop browsers can't decode .mov, but the
// PopInSeller component's `videoErrored` fallback in PR #136
// handles that gracefully (visitor sees the avatar bubble instead).
const ALLOWED_MIME_PREFIX = "video/";
const ALLOWED_MIME = new Set<string>([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // Some Android cameras report this for .mp4 clips. Accept it.
  "video/x-m4v",
]);

const ALLOWED_EXT = new Set<string>(["mp4", "webm", "mov", "m4v"]);

export type PopinVideoUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type PopinVideoValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validatePopinVideo(file: File): PopinVideoValidation {
  if (!file) return { ok: false, error: "No file selected." };
  if (file.size <= 0) return { ok: false, error: "Selected file is empty." };
  if (file.size > POPIN_VIDEO_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `File is ${mb} MB. Pop-In videos must be under 50 MB.`,
    };
  }
  // Some mobile browsers leave file.type empty on freshly-recorded
  // clips. Fall back to extension check in that case.
  const mime = (file.type || "").toLowerCase();
  if (mime) {
    if (!mime.startsWith(ALLOWED_MIME_PREFIX)) {
      return { ok: false, error: "Please choose a video file." };
    }
    if (!ALLOWED_MIME.has(mime) && !mime.startsWith(ALLOWED_MIME_PREFIX)) {
      return { ok: false, error: `Unsupported video type: ${mime}` };
    }
  }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext && !ALLOWED_EXT.has(ext)) {
    return { ok: false, error: `Unsupported extension: .${ext}` };
  }
  return { ok: true };
}

export async function uploadPopinVideo(
  file: File,
  projectId: string,
  token: string,
): Promise<PopinVideoUploadResult> {
  const check = validatePopinVideo(file);
  if (check.ok !== true) return { ok: false, error: check.error };

  if (!projectId) {
    return { ok: false, error: "Project not loaded yet. Please try again." };
  }
  if (!token) {
    return { ok: false, error: "Please sign in to upload a video." };
  }

  try {
    const fd = new FormData();
    fd.append("project_id", projectId);
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/popin/upload-video`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      let detail: string | undefined;
      try {
        detail = (await res.json())?.detail;
      } catch {
        // non-JSON error body
      }
      console.error(
        `[popin-video] upload HTTP ${res.status}:`,
        detail || "(no detail)",
      );
      if (res.status === 401) {
        return { ok: false, error: "Please sign in to upload a video." };
      }
      if (res.status === 404) {
        return {
          ok: false,
          error: "Project not found. Try refreshing the page.",
        };
      }
      if (res.status === 413) {
        return {
          ok: false,
          error: detail || "Video is too large. Pop-In videos must be under 50 MB.",
        };
      }
      if (res.status === 400) {
        return {
          ok: false,
          error: detail || "Please choose an MP4, WebM, or MOV video file.",
        };
      }
      return { ok: false, error: "Upload failed. Please try again." };
    }
    const body = (await res.json()) as { public_url?: string };
    if (!body.public_url) {
      return { ok: false, error: "Upload succeeded but URL not returned." };
    }
    return { ok: true, url: body.public_url };
  } catch (err: unknown) {
    console.error("[popin-video] unexpected upload error:", err);
    return { ok: false, error: "Upload failed. Please try again." };
  }
}
