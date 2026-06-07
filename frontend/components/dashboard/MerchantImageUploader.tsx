"use client";

/**
 * MerchantImageUploader — logo + cover upload widget for the dashboard.
 *
 * Bridges the gap between the image-forward storefront work (#341, #342,
 * #344) and merchant self-service: every merchant past Topgun lands on a
 * logo-less storefront with no UI to fix it. This widget unblocks that.
 *
 * Two slots:
 *   - logo  → business_profiles.logo_url        (small square avatar)
 *   - cover → business_profiles.cover_image_url (wide hero banner)
 *
 * Upload pipeline (mirrors PostAndGoLive.tsx:uploadImage):
 *   1. Client-side validate: image/* MIME, ≤5MB.
 *   2. Upload to Supabase Storage bucket "offers" under the subpath
 *      `business-images/${bizId}/${slot}-${Date.now()}.${ext}`. We
 *      deliberately reuse the existing offers bucket + its existing
 *      RLS policies — no new bucket, no new policy, no migration.
 *      The auth-scoped binding (PATCH /api/business/update only
 *      updates rows where owner_privy_id = current_user.sub) closes
 *      the actual logo-hijack vector, mirroring the offer-image
 *      security posture already shipped.
 *   3. PATCH /api/business/update with the resulting public URL.
 *   4. Bubble the new URL to the parent via onChange so the dashboard
 *      can refresh its local state without a re-fetch.
 *
 * Backwards-compat: merchants who don't upload stay exactly as today
 * (storefront emoji avatar / no cover banner / #344 onError fallback
 * intact). Merchants who upload immediately get image-forward render.
 */

import { useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { API_BASE } from "../../lib/apiBase";

type Slot = "logo" | "cover";

const MAX_BYTES = 5 * 1024 * 1024;

type Props = {
  /** business_profiles.id — the upload subpath is keyed on this. */
  bizId: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  getToken: () => Promise<string | null | undefined>;
  /** Notify parent of saved changes so it can update local state. */
  onChange: (next: { logo_url?: string | null; cover_image_url?: string | null }) => void;
};

export function MerchantImageUploader({
  bizId,
  logoUrl,
  coverImageUrl,
  getToken,
  onChange,
}: Props) {
  const [busy, setBusy] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic preview URLs (createObjectURL) — distinct from the
  // persisted URL so the merchant sees their picked file instantly,
  // even before the upload + PATCH round-trip resolves.
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  function validate(file: File): string | null {
    if (!file.type.startsWith("image/")) {
      return "File must be an image (JPEG, PNG, WebP, GIF).";
    }
    if (file.size > MAX_BYTES) {
      return `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.`;
    }
    return null;
  }

  async function upload(slot: Slot, file: File) {
    setError(null);
    const v = validate(file);
    if (v) {
      setError(v);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (slot === "logo") setLogoPreview(previewUrl);
    else setCoverPreview(previewUrl);

    setBusy(slot);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `business-images/${bizId}/${slot}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("offers")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) {
        setError(upErr.message || "Upload failed. Try again.");
        return;
      }
      const { data } = supabase.storage.from("offers").getPublicUrl(path);
      const publicUrl = data.publicUrl;

      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/update`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          slot === "logo" ? { logo_url: publicUrl } : { cover_image_url: publicUrl },
        ),
      });
      if (!res.ok) {
        setError(`File uploaded but profile save failed (HTTP ${res.status}). Try again.`);
        return;
      }
      onChange(
        slot === "logo" ? { logo_url: publicUrl } : { cover_image_url: publicUrl },
      );
      // Optimistic preview already shows the picked file; the parent
      // now has the persisted URL, so we can drop the preview and let
      // the persisted value render.
      if (slot === "logo") {
        setLogoPreview(null);
        URL.revokeObjectURL(previewUrl);
      } else {
        setCoverPreview(null);
        URL.revokeObjectURL(previewUrl);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(slot: Slot) {
    setError(null);
    setBusy(slot);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/update`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          slot === "logo" ? { logo_url: "" } : { cover_image_url: "" },
        ),
      });
      if (!res.ok) {
        setError(`Could not remove ${slot}. Try again.`);
        return;
      }
      onChange(slot === "logo" ? { logo_url: null } : { cover_image_url: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setBusy(null);
    }
  }

  const shownLogo = logoPreview || logoUrl;
  const shownCover = coverPreview || coverImageUrl;

  return (
    <div className="mt-4 rounded-xl border border-default bg-surface-page p-4">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
        Brand images
      </div>

      {/* Hidden file inputs (click-to-pick). */}
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload("logo", f);
          e.target.value = "";
        }}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload("cover", f);
          e.target.value = "";
        }}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Logo slot — square thumb. */}
        <div className="flex items-start gap-3 sm:w-64">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-default bg-surface-card">
            {shownLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={shownLogo}
                alt="Logo preview"
                className="h-full w-full object-cover"
                onError={() => {
                  if (logoPreview) {
                    URL.revokeObjectURL(logoPreview);
                    setLogoPreview(null);
                  }
                }}
              />
            ) : (
              <span className="text-2xl">🏢</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-primary">Logo</div>
            <div className="text-[11px] text-secondary">
              Square. Up to 5MB. Shows on your storefront and on Discover.
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={busy !== null}
                className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-[11px] font-bold text-primary transition hover:border-brand-teal disabled:opacity-50"
              >
                {busy === "logo" ? "Saving…" : logoUrl ? "Replace" : "Upload"}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => remove("logo")}
                  disabled={busy !== null}
                  className="rounded-lg border border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition hover:text-primary disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Cover slot — wide thumb. */}
        <div className="flex-1">
          <div
            className="mb-2 h-20 w-full overflow-hidden rounded-xl border border-default bg-surface-card sm:h-24"
            style={
              shownCover
                ? { backgroundImage: `url(${shownCover})`, backgroundSize: "cover", backgroundPosition: "center" }
                : undefined
            }
          >
            {!shownCover && (
              <div className="flex h-full w-full items-center justify-center text-[11px] text-secondary">
                No cover banner yet
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-primary">Cover banner</div>
              <div className="text-[11px] text-secondary">
                Wide. Up to 5MB. Shows above your storefront name.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={busy !== null}
                className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-[11px] font-bold text-primary transition hover:border-brand-teal disabled:opacity-50"
              >
                {busy === "cover" ? "Saving…" : coverImageUrl ? "Replace" : "Upload"}
              </button>
              {coverImageUrl && (
                <button
                  type="button"
                  onClick={() => remove("cover")}
                  disabled={busy !== null}
                  className="rounded-lg border border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition hover:text-primary disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-state-live/30 bg-state-live/5 px-3 py-2 text-[11px] text-state-live">
          {error}
        </div>
      )}
    </div>
  );
}
