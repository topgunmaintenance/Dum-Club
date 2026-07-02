"use client";

/**
 * GoLiveDemoPhone — the homepage's interactive "watch a shop go live" demo.
 *
 * A phone-frame walkthrough of the merchant onboarding flow (sign up ->
 * verify -> snap a photo -> choose how to sell -> live/storefront result).
 * Per the design handoff, every step here is SIMULATED: short timers stand
 * in for the real Stripe Connect verification and photo upload, and the
 * live-result screen's viewer count / chat / "sold" counter are static demo
 * data, not a real broadcast. This is a marketing device to prove the flow
 * is simple before a visitor commits to signing up — the real onboarding
 * lives at /merchant and the real broadcast is the IVS Go Live flow
 * (components/IVSStageHost.tsx, components/LiveRoom.tsx).
 *
 * Autoplay defaults OFF (the handoff's own instruction: the design tool's
 * autoplay-on-loop default is a demo-booth/investor-deck aid, not meant to
 * ship — a real visitor should drive the flow themselves).
 */

import { useEffect, useRef, useState } from "react";

type BusinessKey = "food" | "services" | "moving";

type DemoBusiness = {
  label: string;
  shopName: string;
  tagline: string;
  itemName: string;
  price: number;
  unit: string;
  startViewers: number;
  chatSenderName: string;
  chatMessage: string;
  photoId: string; // Unsplash photo path, matched to the business type
};

/* Hotlinked from Unsplash's CDN (license allows commercial use, no
   attribution required); IDs hand-picked to match each demo business.
   Used for the camera viewfinder, the listing preview, and the live-video
   backdrop so the demo reads like a real show instead of a striped box. */
const unsplashUrl = (photoId: string, w = 640) =>
  `https://images.unsplash.com/${photoId}?w=${w}&q=60&auto=format&fit=crop`;

const BUSINESSES: Record<BusinessKey, DemoBusiness> = {
  food: {
    label: "Food",
    shopName: "Sunrise Bakery",
    tagline: "fresh sourdough, baked this morning",
    itemName: "Sourdough loaf",
    price: 12,
    unit: "loaf",
    startViewers: 64,
    chatSenderName: "jenna_m",
    chatMessage: "is there a gluten-free option?",
    photoId: "photo-1613396874083-2d5fbe59ae79",
  },
  services: {
    label: "Services",
    shopName: "Bright Clean Co.",
    tagline: "same-day deep cleans, booked live",
    itemName: "Deep clean visit",
    price: 89,
    unit: "visit",
    startViewers: 31,
    chatSenderName: "dave.k",
    chatMessage: "do you cover apartments too?",
    photoId: "photo-1581578949510-fa7315c4c350",
  },
  moving: {
    label: "Moving",
    shopName: "Metro Movers",
    tagline: "weekend crews, first-come first-served",
    itemName: "2-person moving crew",
    price: 220,
    unit: "job",
    startViewers: 22,
    chatSenderName: "priya_r",
    chatMessage: "how far in advance should I book?",
    photoId: "photo-1616432043562-3671ea2e5242",
  },
};

const STEP_LABELS = ["Sign Up", "Verify", "Snap", "Choose", "Result"];

export function GoLiveDemoPhone() {
  const [businessKey, setBusinessKey] = useState<BusinessKey>("food");
  const [step, setStep] = useState(0);
  const [path, setPath] = useState<"live" | "post" | null>(null);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const [soldCount, setSoldCount] = useState(0);
  const [viewers, setViewers] = useState(BUSINESSES.food.startViewers);

  const business = BUSINESSES[businessKey];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function resetFlags() {
    setPath(null);
    setVerified(false);
    setVerifying(false);
    setPhotoTaken(false);
    setSnapping(false);
    setSoldCount(0);
  }

  function restart() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStep(0);
    setViewers(business.startViewers);
    resetFlags();
  }

  function selectBusiness(key: BusinessKey) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setBusinessKey(key);
    setStep(0);
    setViewers(BUSINESSES[key].startViewers);
    resetFlags();
  }

  function next() {
    setStep((s) => Math.min(4, s + 1));
  }

  function back() {
    setStep((s) => Math.max(0, s - 1));
  }

  function verifyNow() {
    if (verifying) return;
    setVerifying(true);
    setVerified(true);
    timerRef.current = setTimeout(() => {
      setVerifying(false);
      next();
    }, 650);
  }

  function snapPhoto() {
    if (snapping) return;
    setSnapping(true);
    setPhotoTaken(true);
    timerRef.current = setTimeout(() => {
      setSnapping(false);
      next();
    }, 500);
  }

  function choose(p: "live" | "post") {
    setPath(p);
    setStep(4);
  }

  function markSold() {
    setSoldCount((c) => c + 1);
    setViewers((v) => v + 3);
  }

  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center">
      {/* ── Phone frame ── */}
      <div className="relative mx-auto w-[280px] shrink-0 rounded-[36px] border border-white/10 bg-black p-2.5 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        <div className="h-[560px] overflow-hidden rounded-[28px] bg-surface-page">
          {step === 0 && <StepSignUp onNext={next} />}
          {step === 1 && (
            <StepVerify
              business={business}
              verified={verified}
              verifying={verifying}
              onBack={back}
              onVerify={verifyNow}
            />
          )}
          {step === 2 && (
            <StepSnap
              business={business}
              photoTaken={photoTaken}
              snapping={snapping}
              onBack={back}
              onSnap={snapPhoto}
            />
          )}
          {step === 3 && <StepChoose onBack={back} onChoose={choose} />}
          {step === 4 && path === "post" && (
            <StepResultPost business={business} onRestart={restart} />
          )}
          {step === 4 && path === "live" && (
            <StepResultLive
              business={business}
              viewers={viewers}
              soldCount={soldCount}
              onMarkSold={markSold}
              onRestart={restart}
            />
          )}
        </div>
      </div>

      {/* ── Copy + controls ── */}
      <div className="w-full max-w-[460px] text-white">
        <h2 className="text-3xl font-bold sm:text-[36px]">Watch a shop go live</h2>
        <p className="mt-2 text-white/60">
          Pick a business type, then try the exact flow an owner walks through.
        </p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          {(Object.keys(BUSINESSES) as BusinessKey[]).map((key) => {
            const active = key === businessKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectBusiness(key)}
                aria-pressed={active}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-mint-fill text-mint-fill-ink"
                    : "border border-white/15 bg-white/[0.08] text-white/70 hover:brightness-125"
                }`}
              >
                {BUSINESSES[key].label}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex items-center gap-2" aria-hidden="true">
          {STEP_LABELS.map((label, i) => (
            <span
              key={label}
              className={`rounded-full transition-all ${
                i === step ? "h-[7px] w-[22px] bg-mint-fill" : "h-[7px] w-[7px] bg-white/25"
              }`}
            />
          ))}
        </div>

        <p className="mt-3 text-sm text-white/45">
          Currently demoing: {business.tagline}
        </p>
      </div>
    </div>
  );
}

/* ── Step screens ── */

function PhoneHeader({
  title,
  onBack,
  eyebrow,
}: {
  title: string;
  onBack?: () => void;
  eyebrow?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-5 pt-6">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-default text-secondary transition hover:text-primary"
        >
          ←
        </button>
      )}
      <div>
        {eyebrow && (
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
            {eyebrow}
          </div>
        )}
        <div className="text-[15px] font-bold text-primary">{title}</div>
      </div>
    </div>
  );
}

function StepSignUp({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex h-full flex-col px-6 pt-10">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border-2 border-mint-text text-lg font-bold text-mint-text">
        D
      </div>
      <h3 className="mt-5 text-center text-lg font-bold text-primary">Welcome to DUM Club</h3>
      <p className="mt-1.5 text-center text-sm text-secondary">Sign up to start selling live.</p>
      <div className="mt-6 space-y-3">
        <input
          readOnly
          value=""
          placeholder="Business email"
          className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none"
        />
        <input
          readOnly
          value=""
          placeholder="Business name"
          className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none"
        />
      </div>
      <button
        type="button"
        onClick={onNext}
        className="mt-5 w-full rounded-xl bg-mint-fill py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
      >
        Continue
      </button>
      <p className="mt-4 text-center text-[12px] text-secondary">
        Already have an account? <span className="font-semibold text-mint-text">Log in</span>
      </p>
    </div>
  );
}

function StepVerify({
  business,
  verified,
  verifying,
  onBack,
  onVerify,
}: {
  business: DemoBusiness;
  verified: boolean;
  verifying: boolean;
  onBack: () => void;
  onVerify: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="Verify your business" onBack={onBack} />
      <div className="px-6 pt-2">
        <p className="text-sm text-secondary">
          Connect Stripe so buyers know you&apos;re legit. About 90 seconds.
        </p>
        <div className="mt-5 rounded-2xl border border-default bg-surface-card p-4">
          <div className="text-sm font-bold text-primary">Stripe · {business.shopName}</div>
          <div className="mt-3 space-y-2">
            {["Business verified", "Payouts enabled"].map((label) => (
              <div key={label} className="flex items-center gap-2.5 text-sm text-secondary">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    verified ? "bg-mint-fill text-mint-fill-ink" : "border border-default text-transparent"
                  }`}
                >
                  ✓
                </span>
                {label}
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="mt-5 w-full rounded-xl bg-mint-fill py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90 disabled:opacity-60"
        >
          {verifying ? "Verified · redirecting…" : "Verify with Stripe"}
        </button>
      </div>
    </div>
  );
}

function StepSnap({
  business,
  photoTaken,
  snapping,
  onBack,
  onSnap,
}: {
  business: DemoBusiness;
  photoTaken: boolean;
  snapping: boolean;
  onBack: () => void;
  onSnap: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="Snap what you're selling" onBack={onBack} />
      <div className="px-6 pt-2">
        <p className="text-sm text-secondary">Point, shoot, done. We&apos;ll fill in the rest.</p>
        <div
          className="mt-5 flex h-36 items-center justify-center rounded-2xl border border-default bg-cover bg-center text-muted"
          style={{ backgroundImage: `url(${unsplashUrl(business.photoId)})` }}
        >
          {snapping && (
            <span className="rounded-full bg-surface-card px-3 py-1 text-[11px] font-semibold text-secondary shadow-sm">
              Nice shot! Auto-filled:
            </span>
          )}
        </div>
        {snapping ? (
          <div className="mt-3 rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm">
            <span className="font-bold text-primary">{business.itemName}</span>
            <span className="ml-2 font-mono text-mint-text">${business.price}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSnap}
            disabled={photoTaken}
            className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full border-4 border-default bg-surface-card transition hover:border-strong"
            aria-label="Take photo"
          >
            <span className="h-11 w-11 rounded-full bg-mint-fill" />
          </button>
        )}
      </div>
    </div>
  );
}

function StepChoose({
  onBack,
  onChoose,
}: {
  onBack: () => void;
  onChoose: (path: "live" | "post") => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <PhoneHeader title="How do you want to sell it?" onBack={onBack} />
      <div className="space-y-3 px-6 pt-4">
        <button
          type="button"
          onClick={() => onChoose("post")}
          className="w-full rounded-2xl border border-default bg-surface-card p-4 text-left transition hover:border-strong"
        >
          <div className="text-sm font-bold text-primary">Post to Storefront</div>
          <div className="mt-1 text-[12px] text-secondary">List it now, sell whenever</div>
        </button>
        <button
          type="button"
          onClick={() => onChoose("live")}
          className="w-full rounded-2xl border-2 border-mint-text bg-mint-card p-4 text-left"
        >
          <div className="text-sm font-bold text-mint-text">Go Live Now</div>
          <div className="mt-1 text-[12px] text-mint-text/80">Sell it in real time, on camera</div>
        </button>
      </div>
    </div>
  );
}

function StepResultPost({
  business,
  onRestart,
}: {
  business: DemoBusiness;
  onRestart: () => void;
}) {
  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <span className="inline-flex w-fit items-center rounded-full bg-mint-card px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-mint-text">
        Listed · Live on storefront
      </span>
      <h3 className="mt-4 text-lg font-bold text-primary">You&apos;re live, well, listed!</h3>
      <div className="mt-4 rounded-2xl border border-default bg-surface-card p-4">
        <div
          className="h-24 rounded-xl bg-surface-muted bg-cover bg-center"
          style={{ backgroundImage: `url(${unsplashUrl(business.photoId)})` }}
        />
        <div className="mt-3 text-sm font-bold text-primary">{business.itemName}</div>
        <div className="font-mono text-sm text-mint-text">${business.price}</div>
        <div className="mt-1 text-[12px] text-secondary">{business.shopName}</div>
      </div>
      <button
        type="button"
        onClick={onRestart}
        className="mt-5 w-full rounded-xl border border-default py-3 text-sm font-bold text-primary transition hover:border-strong"
      >
        Restart Demo
      </button>
    </div>
  );
}

function StepResultLive({
  business,
  viewers,
  soldCount,
  onMarkSold,
  onRestart,
}: {
  business: DemoBusiness;
  viewers: number;
  soldCount: number;
  onMarkSold: () => void;
  onRestart: () => void;
}) {
  return (
    <div
      className="flex h-full flex-col bg-dum-video bg-cover bg-center text-white"
      style={{
        // Photo backdrop with a dark wash so the chat/overlay chrome stays
        // readable — reads like a paused camera frame, not a striped box.
        backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.65)), url(${unsplashUrl(business.photoId)})`,
      }}
    >
      <div className="flex items-center justify-between px-4 pt-5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wide">Live</span>
        </span>
        <span className="font-mono text-[11px] font-semibold text-white/80">
          👀 {viewers.toLocaleString()}
        </span>
      </div>

      <div className="mt-3 mx-4 rounded-xl bg-black/40 px-3 py-2.5">
        <div className="text-sm font-bold">{business.itemName}</div>
        <div className="font-mono text-sm text-dum-live-accent">
          ${business.price} / {business.unit}
        </div>
      </div>

      <div className="mt-3 flex-1 space-y-2 px-4">
        <div className="rounded-xl bg-black/35 px-3 py-2 text-[12.5px]">
          <span className="font-bold text-dum-live-accent">{business.chatSenderName}</span>{" "}
          <span className="text-white/90">{business.chatMessage}</span>
        </div>
        {soldCount > 0 && (
          <div className="rounded-xl bg-mint-fill/20 px-3 py-2 text-[12.5px] font-semibold text-dum-live-accent">
            🎉 Someone just bought {business.itemName}!
          </div>
        )}
      </div>

      <div className="px-4 pb-5">
        <button
          type="button"
          onClick={onMarkSold}
          className="w-full rounded-xl bg-mint-fill py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90"
        >
          Mark as SOLD · ${business.price}
          {soldCount > 0 && <span className="ml-1 opacity-70">({soldCount} sold)</span>}
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="mt-2 w-full text-center text-[12px] font-semibold text-white/60 hover:text-white"
        >
          Restart demo
        </button>
      </div>
    </div>
  );
}
