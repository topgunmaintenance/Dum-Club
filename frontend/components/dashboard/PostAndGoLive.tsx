"use client";

/**
 * PostAndGoLive — single-screen composer for the dashboard.
 *
 * One screen, one action: take a photo, type a price, hit Post & Go
 * Live. Wraps the existing offer-create + pin + auto-go-live wiring;
 * no new endpoints, no schema change. Mobile-first: camera capture,
 * decimal keyboard, title autofocus after image, sticky bottom CTA.
 *
 * Flow on Post:
 *   1. (if image) upload to Supabase storage "offers" bucket — same
 *      pattern as the existing project-page offer form.
 *   2. POST /api/offers/create with the canonical OfferCreate payload.
 *   3. POST /api/projects/{id}/pin-offer to pin the new offer.
 *   4. router.push(`/project/<slug>?golive=1`) — the project page
 *      already reads ?golive=1 and passes autoStart to IVSStageHost.
 *
 * Stripe gating: the backend offer-create endpoint already hard-blocks
 * unverified merchants (_assert_merchant_stripe_verified). So when
 * stripe_connect_status !== "verified", the CTA reads
 *   "Post (Connect Stripe to accept payments)"
 * and the click routes to /merchant instead of attempting the POST —
 * the spec's UX intent, honoured without fighting the backend gate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "../../lib/apiBase";
import { errorText } from "../../lib/errorText";
import { createClient } from "../../lib/supabase/client";
import { sanitizeBearerToken } from "../../lib/offers";

type Project = {
  id: string;
  slug?: string | null;
  title?: string | null;
  name?: string | null;
};

type Props = {
  project: Project;
  stripeVerified: boolean;
  getToken: () => Promise<string | null | undefined>;
  // Caller's Privy DID. The pin-offer endpoint authenticates the owner
  // off the user_id header (the privy id), not the Bearer token, so this
  // must be the real DID — sending anything else 403s and the auto-pin
  // is silently dropped, stranding the merchant on the go-live screen
  // with no featured offer.
  userId: string;
};

type Chip = "quantity" | "shipping" | "description";

export function PostAndGoLive({ project, stripeVerified, getToken, userId }: Props) {
  const router = useRouter();

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [openChip, setOpenChip] = useState<Chip | null>(null);
  const [quantity, setQuantity] = useState("");
  const [shipping, setShipping] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Autofocus the title field as soon as the image is set — keeps the
  // mobile keyboard up immediately after the camera dismisses.
  useEffect(() => {
    if (imageFile) titleInputRef.current?.focus();
  }, [imageFile]);

  // Clean up the object URL when the image is replaced or unmounts.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const priceNum = useMemo(() => {
    const cleaned = price.replace(/[^0-9.]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [price]);

  const canPost = Boolean(title.trim() && priceNum);

  function pickImage(file: File) {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function uploadImage(file: File): Promise<string | null> {
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `offer-images/${project.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("offers")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (upErr) {
        console.error("[post-go-live] image upload:", upErr);
        return null;
      }
      const { data } = supabase.storage.from("offers").getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      console.error("[post-go-live] image upload failed:", err);
      return null;
    }
  }

  async function handleSubmit() {
    if (!stripeVerified) {
      // Spec-honoured fallback: don't attempt the POST (backend would
      // 403); route the merchant to /merchant to finish Stripe.
      router.push("/merchant");
      return;
    }
    if (!canPost) return;

    setSubmitting(true);
    setError(null);

    try {
      const token = sanitizeBearerToken(await getToken());
      if (!token) {
        setError("Please sign in to post.");
        setSubmitting(false);
        return;
      }

      let imageUrl: string | null = null;
      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
        // Image upload is best-effort — if it fails, post without an
        // image rather than blocking. Matches the existing offer-form
        // behaviour.
      }

      // Optional chips collapse into existing schema fields so this
      // ships with zero migration: quantity -> quantity_available;
      // shipping note -> appended to delivery_info; description ->
      // description.
      const qty = quantity ? Math.max(0, Math.floor(Number(quantity))) : null;
      const deliveryParts: string[] = [];
      if (shipping.trim()) deliveryParts.push(shipping.trim());

      const body = {
        project_id: project.id,
        title: title.trim(),
        description: description.trim() || null,
        price_usd: priceNum,
        offer_type: "physical_product",
        delivery_info: deliveryParts.length ? deliveryParts.join(" · ") : null,
        token_discount_percent: 0,
        primary_image_url: imageUrl,
        quantity_available: qty,
        unlimited_inventory: qty == null,
      };

      const createRes = await fetch(`${API_BASE}/api/offers/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        const detail = errorText(err.detail, `Post failed (HTTP ${createRes.status})`);
        setError(detail);
        setSubmitting(false);
        return;
      }
      const created = await createRes.json();
      const newOfferId: string | undefined = created?.id;

      // Pin the new offer so when the host goes live, it's the
      // featured item. Best-effort — if pin fails, still redirect
      // (the offer is on the storefront either way; the host can
      // pin from the project page).
      if (newOfferId) {
        try {
          await fetch(
            `${API_BASE}/api/projects/${encodeURIComponent(project.id)}/pin-offer`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                user_id: userId,
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ offer_id: newOfferId }),
            },
          );
        } catch (pinErr) {
          console.error("[post-go-live] pin failed (non-fatal):", pinErr);
        }
      }

      // Redirect to the storefront with the auto-go-live flag set —
      // the project page reads ?golive=1 and fires the existing
      // IVS host autoStart.
      const slugOrId = project.slug || project.id;
      router.push(`/project/${encodeURIComponent(slugOrId)}?golive=1`);
    } catch (err) {
      console.error("[post-go-live] submit failed:", err);
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  const ctaLabel = stripeVerified
    ? submitting
      ? "Posting…"
      : "Post & Go Live"
    : "Post (Connect Stripe to accept payments)";

  return (
    <div className="mx-auto w-full max-w-xl pb-28 sm:pb-0">
      {/* Image / camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickImage(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="block w-full overflow-hidden rounded-2xl border border-dashed border-default bg-surface-card transition hover:border-strong"
        style={{ aspectRatio: "4/3" }}
      >
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreview}
            alt="Item preview"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-secondary">
            <span className="text-3xl" aria-hidden="true">📷</span>
            <span className="text-sm font-medium text-primary">Tap to take a photo</span>
            <span className="text-xs text-secondary">or upload an image/video</span>
          </div>
        )}
      </button>

      {/* Title */}
      <div className="mt-4">
        <label htmlFor="post-title" className="sr-only">Item title</label>
        <input
          id="post-title"
          ref={titleInputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What are you selling?"
          autoComplete="off"
          maxLength={120}
          className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
        />
      </div>

      {/* Price */}
      <div className="mt-3">
        <label htmlFor="post-price" className="sr-only">Price in US dollars</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-secondary">$</span>
          <input
            id="post-price"
            type="text"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
            className="w-full rounded-xl border border-default bg-surface-card pl-8 pr-4 py-3 text-base text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
          />
        </div>
      </div>

      {/* Optional chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        {(["quantity", "shipping", "description"] as Chip[]).map((chip) => {
          const active = openChip === chip;
          const hasValue =
            (chip === "quantity" && quantity.trim()) ||
            (chip === "shipping" && shipping.trim()) ||
            (chip === "description" && description.trim());
          return (
            <button
              key={chip}
              type="button"
              onClick={() => setOpenChip(active ? null : chip)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                active
                  ? "border-brand-teal bg-brand-teal-soft text-brand-teal"
                  : hasValue
                  ? "border-default bg-brand-teal-soft text-brand-teal"
                  : "border-default bg-surface-card text-secondary hover:text-primary"
              }`}
            >
              + {chip}
            </button>
          );
        })}
      </div>

      {openChip === "quantity" && (
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="How many do you have? (leave blank for unlimited)"
          className="mt-3 w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
        />
      )}
      {openChip === "shipping" && (
        <input
          type="text"
          value={shipping}
          onChange={(e) => setShipping(e.target.value)}
          placeholder="Shipping note (e.g. Ships in 2-3 days, USPS Priority)"
          className="mt-3 w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
        />
      )}
      {openChip === "description" && (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the item: condition, size, anything a buyer should know."
          rows={3}
          maxLength={500}
          className="mt-3 w-full resize-none rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
        />
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-[var(--state-live)]/30 bg-state-live/5 px-4 py-3 text-sm text-state-live">
          {error}
        </div>
      )}

      {/* Sticky CTA on mobile; inline on desktop. pb-[max(...)] keeps
          the button clear of the iPhone home indicator without leaving
          an awkward gap on Android. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-default bg-surface-card px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:relative sm:inset-auto sm:mt-6 sm:border-0 sm:bg-transparent sm:p-0">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={stripeVerified ? !canPost || submitting : false}
          aria-label={ctaLabel}
          className={`w-full rounded-xl px-6 py-4 text-sm font-bold uppercase tracking-[0.12em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 ${
            stripeVerified
              ? "bg-brand-teal text-brand-navy hover:bg-brand-teal-hover hover:text-white disabled:opacity-40"
              : "bg-brand-teal-soft text-brand-teal hover:bg-brand-teal hover:text-white"
          }`}
        >
          {ctaLabel} {stripeVerified && !submitting && canPost && "→"}
        </button>
        {!stripeVerified && (
          <p className="mt-2 text-center text-[11px] text-secondary">
            You can post once Stripe is connected. Takes about 60 seconds.
          </p>
        )}
      </div>
    </div>
  );
}
