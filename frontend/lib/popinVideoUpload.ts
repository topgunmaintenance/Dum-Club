/**
 * popinVideoUpload — uploads a phone-recorded video to Supabase
 * Storage and returns its public URL. Mirrors the offer-image upload
 * pattern (`uploadOfferImage` in app/project/[id]/page.tsx) so the
 * existing `offers` bucket + RLS policies get reused — no new
 * infrastructure.
 *
 * Validation lives here, not on the server. The Pop-In Seller flow
 * ultimately writes the returned URL into `projects.popin_config.
 * video_url`, where the existing PR #136 backend sanitizer enforces
 * http(s)-only + 2048-char cap as a safety net. The fields validated
 * here (MIME, size, extension) are merchant-experience guardrails:
 * we want to fail fast in the dashboard before the file uploads.
 */

import { createClient } from "./supabase/client";

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
): Promise<PopinVideoUploadResult> {
  const check = validatePopinVideo(file);
  if (check.ok !== true) return { ok: false, error: check.error };

  if (!projectId) {
    return { ok: false, error: "Project not loaded yet — try again." };
  }

  const supabase = createClient();
  const extRaw = (file.name.split(".").pop() || "mp4").toLowerCase();
  // Re-validate the extension we actually use for the path so a
  // forged filename can't insert weird characters into the storage
  // key. ALLOWED_EXT membership was already verified above for
  // non-empty extensions; default to mp4 when missing.
  const ext = ALLOWED_EXT.has(extRaw) ? extRaw : "mp4";
  const path = `popin-videos/${projectId}/${Date.now()}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from("offers")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || `video/${ext === "mov" ? "quicktime" : ext}`,
      });
    if (error) {
      console.error("[popin-video] upload error:", error);
      return {
        ok: false,
        error: error.message || "Upload failed. Please try again.",
      };
    }
    const { data } = supabase.storage.from("offers").getPublicUrl(path);
    if (!data?.publicUrl) {
      return { ok: false, error: "Upload succeeded but URL not returned." };
    }
    return { ok: true, url: data.publicUrl };
  } catch (err: unknown) {
    console.error("[popin-video] unexpected upload error:", err);
    const msg = err instanceof Error ? err.message : "Upload failed.";
    return { ok: false, error: msg };
  }
}
