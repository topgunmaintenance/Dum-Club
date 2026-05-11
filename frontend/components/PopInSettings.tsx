"use client";

/**
 * PopInSettings — merchant dashboard controls for the DUM Pop-In
 * Seller (migration 038, PR #135).
 *
 * Reads + writes `projects.popin_config` (JSONB) via PATCH
 * /api/projects/{id} — the same endpoint that already updates
 * title / description / promo_copy. Backend sanitizes the JSONB
 * shape, so this UI only owns presentation + a thin save action.
 *
 * Modes Recorded Video / Live Video / Automatic are rendered as
 * visually disabled "Coming soon" options so the spec's display-
 * mode selector is honest about what's actually wired today
 * (Bubble only — see PR #133).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { PopInSeller, type PopInOffer } from "./PopInSeller";
import { trackEvent } from "../lib/analytics";
import {
  uploadPopinVideo,
  validatePopinVideo,
  POPIN_VIDEO_MAX_BYTES,
} from "../lib/popinVideoUpload";

import { API_BASE } from "../lib/apiBase";

type PopInConfig = {
  enabled?: boolean;
  greeting?: string;
  returning_greeting?: string;
  delay_seconds?: number;
  once_per_session?: boolean;
  offer_id?: string | null;
  mode?: "bubble" | "recorded" | "live" | "auto";
  video_url?: string | null;
};

type MerchantProject = {
  id: string;
  title?: string;
  name?: string;
  popin_config?: PopInConfig | null;
};

type OfferOption = {
  id: string;
  title?: string | null;
  price_usd?: number | null;
  project_id?: string | null;
};

type PopInSettingsProps = {
  project: MerchantProject;
  /** Subset of merchant offers — typically supplied from the
   *  dashboard's existing analytics.top_offers payload. Used to
   *  populate the "Offer override" dropdown. */
  offers: OfferOption[];
  /** Privy bearer token used to authenticate the PATCH request. */
  getToken: () => Promise<string | null>;
  /** Optional callback fired after a successful save (e.g. so the
   *  dashboard can refresh its in-memory project list). */
  onSaved?: (config: PopInConfig) => void;
};

const MODES: Array<{
  value: "bubble" | "recorded" | "live" | "auto";
  label: string;
  description: string;
  active: boolean;
}> = [
  {
    value: "bubble",
    label: "Bubble",
    description: "Floating greeting + offer chip on your embed.",
    active: true,
  },
  {
    value: "recorded",
    label: "Recorded Video",
    description: "Short pre-recorded clip from the seller, muted by default.",
    active: true,
  },
  {
    value: "live",
    label: "Live Video",
    description: "Small live stream bubble of the seller. Coming soon.",
    active: false,
  },
  {
    value: "auto",
    label: "Automatic",
    description: "DUM chooses the best mode for each visitor. Future.",
    active: false,
  },
];

export function PopInSettings({
  project,
  offers,
  getToken,
  onSaved,
}: PopInSettingsProps) {
  const initial = project.popin_config ?? {};
  const merchantName = (project.title || project.name || "your business").trim();

  const [enabled, setEnabled] = useState<boolean>(initial.enabled !== false);
  const [greeting, setGreeting] = useState<string>(initial.greeting ?? "");
  const [returningGreeting, setReturningGreeting] = useState<string>(
    initial.returning_greeting ?? "",
  );
  const [delaySeconds, setDelaySeconds] = useState<number>(
    typeof initial.delay_seconds === "number" ? initial.delay_seconds : 5,
  );
  const [oncePerSession, setOncePerSession] = useState<boolean>(
    initial.once_per_session === true,
  );
  const [offerId, setOfferId] = useState<string>(initial.offer_id ?? "");
  // Mode is editable for the two active modes (bubble + recorded).
  // Coming-soon modes (live / auto) are rendered as disabled radios
  // so the merchant can't select them; the backend rejects them too.
  const [mode, setMode] = useState<"bubble" | "recorded">(
    initial.mode === "recorded" ? "recorded" : "bubble",
  );
  const [videoUrl, setVideoUrl] = useState<string>(initial.video_url ?? "");

  // Upload UI state. uploadingVideo is set during the network hop so
  // we can show an indeterminate "Uploading…" indicator. uploadError
  // captures both client-side validation failures (size, MIME) and
  // Supabase Storage errors. The hidden file input is opened via
  // fileInputRef.current.click() from the "Upload Video" button so
  // we can style the trigger freely.
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAdvancedUrl, setShowAdvancedUrl] = useState<boolean>(
    // Auto-expand the manual URL section if the merchant already has
    // a URL saved (typically pasted from a CDN before upload shipped)
    // — they were using the advanced path, don't hide it from them.
    Boolean(initial.video_url),
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFilePicked(file: File | null) {
    if (!file) return;
    setUploadError(null);
    const check = validatePopinVideo(file);
    if (check.ok !== true) {
      setUploadError(check.error);
      return;
    }
    setUploadingVideo(true);
    const result = await uploadPopinVideo(file, project.id);
    setUploadingVideo(false);
    if (result.ok !== true) {
      setUploadError(result.error);
      return;
    }
    setVideoUrl(result.url);
    // If the merchant uploaded a video while Bubble was selected,
    // flip mode → recorded so they don't have to make a second choice.
    // If they were already on recorded, no-op.
    if (mode !== "recorded") setMode("recorded");
  }

  function handleRemoveVideo() {
    setVideoUrl("");
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null);

  // Auto-dismiss the status banner after a few seconds.
  useEffect(() => {
    if (!saveStatus) return;
    const t = window.setTimeout(() => setSaveStatus(null), 3500);
    return () => window.clearTimeout(t);
  }, [saveStatus]);

  // Restrict the offer dropdown to offers on this project.
  const projectOffers = useMemo(
    () => offers.filter((o) => !o.project_id || o.project_id === project.id),
    [offers, project.id],
  );

  // Preview-card offer. Prefer the override; otherwise show the first
  // active offer the merchant has on this project so the preview is
  // never empty.
  const previewOffer: PopInOffer | null = useMemo(() => {
    const target =
      projectOffers.find((o) => o.id === (offerId || ""))
      ?? projectOffers[0]
      ?? null;
    if (!target) return null;
    return {
      id: target.id,
      title: target.title || "Featured offer",
      price_usd: Number(target.price_usd ?? 0),
    };
  }, [projectOffers, offerId]);

  const previewGreeting =
    (returningGreeting.trim() ||
      greeting.trim() ||
      `Welcome to ${merchantName}. Today's featured offer is below.`);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveStatus(null);

    // Strip empty strings + nulls so the JSONB stays compact and the
    // server defaults to "use defaults" for any omitted field.
    const payload: PopInConfig = {
      enabled,
      delay_seconds: Math.max(0, Math.min(60, Math.round(delaySeconds))),
      once_per_session: oncePerSession,
      mode,
    };
    const g = greeting.trim();
    const rg = returningGreeting.trim();
    if (g) payload.greeting = g;
    if (rg) payload.returning_greeting = rg;
    payload.offer_id = offerId.trim() || null;
    const vu = videoUrl.trim();
    payload.video_url = vu || null;

    // Client-side URL sanity check — server enforces the same rule
    // but we want to surface the error inline before the network hop.
    if (vu) {
      const lo = vu.toLowerCase();
      if (!lo.startsWith("http://") && !lo.startsWith("https://")) {
        setSaveStatus({
          kind: "error",
          message: "Video URL must start with http:// or https://",
        });
        setSaving(false);
        return;
      }
      if (vu.length > 2048) {
        setSaveStatus({
          kind: "error",
          message: "Video URL is too long (max 2048 characters).",
        });
        setSaving(false);
        return;
      }
    }

    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ popin_config: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || `Save failed (${res.status})`);
      }
      // Lightweight tracking — reuses the existing popin_click event
      // type so we don't need a new schema migration just for "saved
      // settings." metadata.target makes it filterable.
      trackEvent("popin_click", {
        project_id: project.id,
        metadata: { target: "settings_save" },
      });
      setSaveStatus({ kind: "ok", message: "Pop-In settings saved." });
      onSaved?.(payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveStatus({ kind: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="popin-settings-heading"
      className="mt-8 rounded-2xl border border-default bg-surface-card p-6 sm:p-8"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
          Pop-In Seller
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <span className="text-secondary">{enabled ? "Enabled" : "Disabled"}</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-brand-teal"
          />
        </label>
      </div>
      <h2
        id="popin-settings-heading"
        className="mb-5 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
      >
        Control how your Pop-In greets visitors
      </h2>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* ── Form column ─────────────────────────────────── */}
        <div className="space-y-5">
          <Field
            label="First-visit greeting"
            help={`Leave blank for default: "Welcome to ${merchantName}. Today's featured offer is below."`}
          >
            <textarea
              value={greeting}
              onChange={(e) => setGreeting(e.target.value.slice(0, 280))}
              rows={2}
              placeholder={`Welcome to ${merchantName}. Today's featured offer is below.`}
              className="w-full resize-none rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-brand-teal"
            />
          </Field>

          <Field
            label="Returning-visitor greeting"
            help="Shown to visitors who have been to your storefront before."
          >
            <textarea
              value={returningGreeting}
              onChange={(e) => setReturningGreeting(e.target.value.slice(0, 280))}
              rows={2}
              placeholder={`Welcome back to ${merchantName}. Today's featured offer is below.`}
              className="w-full resize-none rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-brand-teal"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Display delay (seconds)" help="0 to 60. Default 5.">
              <input
                type="number"
                min={0}
                max={60}
                value={delaySeconds}
                onChange={(e) =>
                  setDelaySeconds(
                    Math.max(0, Math.min(60, Number(e.target.value) || 0)),
                  )
                }
                className="w-full rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary outline-none focus:border-brand-teal"
              />
            </Field>

            <Field label="Show only once per session">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={oncePerSession}
                  onChange={(e) => setOncePerSession(e.target.checked)}
                  className="h-4 w-4 accent-brand-teal"
                />
                <span>Hide the Pop-In after a visitor has seen it once.</span>
              </label>
            </Field>
          </div>

          <Field
            label="Offer override (optional)"
            help="Leave blank to use your pinned offer."
          >
            <select
              value={offerId}
              onChange={(e) => setOfferId(e.target.value)}
              className="w-full rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary outline-none focus:border-brand-teal"
            >
              <option value="">Use pinned offer</option>
              {projectOffers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title || "Untitled"}
                  {o.price_usd != null ? ` · $${o.price_usd}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Display mode"
            help="Bubble + Recorded Video are live. Live + Automatic are on the roadmap."
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    m.active
                      ? mode === m.value
                        ? "border-brand-teal bg-brand-teal-soft"
                        : "border-default bg-surface-card hover:border-strong"
                      : "cursor-not-allowed border-dashed border-default bg-surface-muted opacity-60"
                  }`}
                >
                  <input
                    type="radio"
                    name="popin-mode"
                    value={m.value}
                    checked={mode === m.value}
                    onChange={() => {
                      if (!m.active) return;
                      if (m.value === "bubble" || m.value === "recorded") {
                        setMode(m.value);
                      }
                    }}
                    disabled={!m.active}
                    className="mt-0.5 h-4 w-4 accent-brand-teal"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-brand-navy">
                      {m.label}
                      {!m.active && (
                        <span className="ml-2 rounded-full bg-surface-card px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted">
                          Coming soon
                        </span>
                      )}
                    </span>
                    <span className="block text-[12px] leading-relaxed text-secondary">
                      {m.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {/* Video upload — primary path. Hidden file input with a
               styled button trigger; the input itself is mobile-
               friendly (accept="video/*" opens the photo library +
               camera shortcut on iOS Safari and Chrome Android,
               capture="user" hints front-camera selfie capture).
               If the merchant already has a saved URL we show
               Replace + Remove instead of Upload. */}
          <Field
            label="Pop-In video"
            help={`Record a short clip on your phone or upload an MP4 / WebM / MOV. Max ${Math.round(POPIN_VIDEO_MAX_BYTES / 1024 / 1024)} MB. Plays muted in the bubble; visitors tap to unmute.`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,video/*"
              capture="user"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                handleFilePicked(f);
              }}
              className="hidden"
              aria-label="Choose or record Pop-In video"
            />

            {videoUrl ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-default bg-surface-muted">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={videoUrl}
                    muted
                    playsInline
                    controls
                    preload="metadata"
                    className="block aspect-video w-full bg-black object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingVideo}
                    className="inline-flex items-center justify-center rounded-lg border border-default bg-surface-card px-3 py-2 text-xs font-semibold text-primary transition hover:border-strong disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploadingVideo ? "Uploading…" : "Replace video"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveVideo}
                    disabled={uploadingVideo}
                    className="inline-flex items-center justify-center rounded-lg border border-default px-3 py-2 text-xs font-semibold text-secondary transition hover:text-state-live disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingVideo}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-default bg-surface-card px-4 text-sm font-semibold text-primary transition hover:border-brand-teal hover:text-brand-teal disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {uploadingVideo ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-default border-t-brand-teal" />
                      <span>Uploading…</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">🎬</span>
                      <span>Upload video</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {uploadError ? (
              <p className="mt-2 text-[12px] font-medium text-state-live">
                {uploadError}
              </p>
            ) : null}

            {/* Manual URL — advanced path. Collapsed by default unless
                 the merchant already has a saved URL (pre-upload
                 vintage). Useful for CDN-hosted clips or for shops
                 reusing a marketing reel. */}
            <details
              open={showAdvancedUrl}
              onToggle={(e) =>
                setShowAdvancedUrl((e.target as HTMLDetailsElement).open)
              }
              className="mt-3"
            >
              <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-[0.18em] text-secondary transition hover:text-primary">
                Or paste a video URL
              </summary>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value.slice(0, 2048))}
                placeholder="https://example.com/intro.mp4"
                disabled={mode !== "recorded"}
                className="mt-2 w-full rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-brand-teal disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Paste any public MP4 / WebM URL. Useful if your clip is
                already hosted on a CDN. Uploaded videos and pasted
                URLs share the same field.
              </p>
            </details>
          </Field>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {saveStatus ? (
              <span
                className={`text-sm font-medium ${
                  saveStatus.kind === "ok"
                    ? "text-brand-teal"
                    : "text-state-live"
                }`}
              >
                {saveStatus.message}
              </span>
            ) : null}
          </div>
        </div>

        {/* ── Preview column ─────────────────────────────── */}
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-secondary">
            Live preview
          </div>
          <div className="rounded-2xl border border-dashed border-default bg-surface-muted p-4">
            {previewOffer ? (
              <div className="pointer-events-none">
                <PopInSeller
                  greeting={previewGreeting}
                  merchantName={merchantName}
                  avatarUrl={null}
                  offer={previewOffer}
                  onOfferClick={() => {}}
                  onDismiss={() => {}}
                  floating={false}
                  videoUrl={
                    mode === "recorded" && videoUrl.trim()
                      ? videoUrl.trim()
                      : null
                  }
                />
              </div>
            ) : (
              <div className="rounded-xl border border-default bg-surface-card px-4 py-6 text-center text-[12px] text-muted">
                Add an offer on your storefront to see the Pop-In preview.
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted">
              Visitors see the Pop-In after the delay above. Returning
              visitors see the second greeting (or the first one if you
              leave that field blank).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-brand-navy">
        {label}
      </span>
      {children}
      {help ? (
        <span className="mt-1 block text-[11px] leading-relaxed text-muted">
          {help}
        </span>
      ) : null}
    </label>
  );
}

