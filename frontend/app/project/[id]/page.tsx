"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

import { IVS_REALTIME_ENABLED, isIVSSession } from "../../../lib/liveProvider";
import { ENABLE_AI_FEATURES } from "../../../lib/featureFlags";
import { deriveStoreStatusCta } from "../../../lib/storeStatus";
const IVSStageHost = dynamic(() => import("../../../components/IVSStageHost").then(m => ({ default: m.IVSStageHost })), { ssr: false });
const IVSStageViewer = dynamic(() => import("../../../components/IVSStageViewer").then(m => ({ default: m.IVSStageViewer })), { ssr: false });
// The SOL checkout UI lives behind SOL_CHECKOUT_ENABLED (false in prod).
// SolanaCheckoutButton is lazy-imported via next/dynamic({ ssr: false })
// so the @solana/wallet-adapter packages — and the Phantom/Solflare
// adapters + adapter-ui CSS — stay out of the consumer page chunk in
// prod. The component mounts WalletProviders internally on first use
// in dev/preview when SOL_CHECKOUT_ENABLED is true.
const SolanaCheckoutButton = dynamic(
  () => import("../../../components/SolanaCheckoutButton").then((m) => ({ default: m.SolanaCheckoutButton })),
  { ssr: false },
);
import type { SolanaCheckoutApi } from "../../../components/SolanaCheckoutButton";
import {
  SOL_CHECKOUT_ENABLED,
  pickSolPayWallet,
  payOfferWithSol,
  SolCheckoutError,
  type PayOfferStep,
} from "../../../lib/solanaCheckout";
import { useAuth } from "../../../lib/auth/AuthContext";
import { useStatusToast } from "../../../lib/useStatusToast";
import { trackEvent } from "../../../lib/analytics";
import { TEMPLATES, matchTemplate } from "../../../lib/templates";
import { AiSalesChat } from "../../../components/AiSalesChat";
import { GuestChat } from "../../../components/GuestChat";
import { ReviewsSection } from "../../../components/ReviewsSection";
import { ReportButton } from "../../../components/ReportButton";
import { ScheduledLiveBanner } from "../../../components/ScheduledLiveBanner";
import { LiveAlertSignup } from "../../../components/LiveAlertSignup";
import { ReplayCard } from "../../../components/ReplayCard";
import { isSimulatedToken } from "../../../lib/tokenMode";
import { SimulatedTokenBanner } from "../../../components/SimulatedTokenBanner";
import { LiveChat, broadcastLiveEvent } from "../../../components/LiveChat";
import { LiveChatIVS } from "../../../components/LiveChatIVS";
import { LiveRoom } from "../../../components/LiveRoom";
import { verbLabelForProject } from "../../../lib/discover/verbs";
import { JsonLd } from "../../../components/JsonLd";
import {
  buildLocalBusinessSchema,
  buildBroadcastEventSchema,
} from "../../../lib/schemaOrg";
import { captureInquiry, captureOfferClick, capturePurchase } from "../../../lib/automation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type Memory = {
  id: string;
  content_text?: string;
  content?: string;
};

type Project = {
  id: string;
  slug?: string | null;
  owner_id?: string | null;
  privy_id?: string | null;
  wallet_address?: string | null;
  name?: string;
  title?: string;
  description?: string;
  status?: string;
  review_status?: string;
  template_type?: string;
  prompt?: string;
  // Next scheduled go-live (ISO 8601, TIMESTAMPTZ in DB). Drives the
  // storefront "Going live..." banner. Migration 064.
  scheduled_live_at?: string | null;
  token_utility?: string;
  token_name?: string | null;
  token_symbol?: string | null;
  token_supply?: number | null;
  token_decimals?: number | null;
  token_status?: string | null;
  token_mint_address?: string | null;
  token_created_at?: string | null;
  ai_free_question_limit?: number | null;
  holder_ai_unlimited?: boolean | null;
  utility_value?: string | null;
  promo_copy?: string | null;
  store_items?: any[] | null;
  ai_output?:
    | {
        title?: string;
        description?: string;
        template_type?: string;
        token_utility?: string;
        [key: string]: any;
      }
    | string
    | null;
  is_live?: boolean;
  // Real broadcast start (migration 084), UTC ISO 8601. Powers the storefront
  // "Live for H:MM" banner timer. NULL/absent on pre-column streams -> no
  // timer, exactly as before.
  live_started_at?: string | null;
  stream_url?: string | null;
  pinned_offer_id?: string | null;
  active_auction_id?: string | null;
  live_provider?: string | null;
  ivs_stage_arn?: string | null;
  replay_url?: string | null;
  replay_recorded_at?: string | null;
  ivs_stage_id?: string | null;
  live_playback_id?: string | null;
  live_stream_key?: string | null;
  live_ingest_url?: string | null;
  // Embedded merchant brand fields, joined by GET /api/projects/{id}
  // via the projects.business_profile_id FK (mig 014). The seeded
  // logo/cover live on this linked row — the legacy by-owner lookup
  // can miss them when owner_privy_id on the biz_profile row doesn't
  // match the project's privy_id. The storefront effect prefers this
  // embed and falls back to /api/business/by-owner only when absent
  // (e.g. projects without a business_profile_id linkage).
  business_profile?: {
    logo_url?: string | null;
    cover_image_url?: string | null;
    verification_status?: string | null;
    business_name?: string | null;
  } | null;
};

type GatedChatResponse = {
  answer: string;
  project_id: string;
  memories_used: number;
  is_holder: boolean;
  free_limit: number;
  used_count: number;
  free_questions_left: number;
  holder_unlimited: boolean;
  token_required: boolean;
  token_mint_address?: string | null;
  contact_email?: string | null;
};

// Shape of the `detail` object returned by /api/chat/project-gated on
// a non-2xx (PR #363 backend contract). FastAPI's default
// HTTPException ships `detail` as a string; this endpoint ships it as
// an object on the 403 free-limit path so the frontend can lock the
// panel and render the mailto CTA. Every field optional — defensive
// against shape drift.
type GatedErrorDetail = {
  message?: string;
  is_holder?: boolean;
  free_limit?: number;
  used_count?: number;
  free_questions_left?: number;
  token_required?: boolean;
  token_mint_address?: string | null;
  contact_email?: string | null;
  business_name?: string | null;
};


type MarketState = {
  id?: number;
  project_id: string;
  price: number;
  market_cap: number;
  volume_24h: number;
  circulating_supply?: number | null;
  max_supply?: number | null;
  last_trade_at?: string | null;
  updated_at?: string | null;
};

type Trade = {
  id: number;
  project_id: string;
  token_symbol?: string;
  side: "buy" | "sell";
  amount: number;
  price: number;
  gross_value: number;
  net_value: number;
  project_fee: number;
  dum_fee: number;
  source?: string;
  created_at?: string;
};

type Redemption = {
  id: number;
  project_id: string;
  wallet: string;
  amount: number;
  code: string;
  status: string;
  created_at?: string;
};

type ProjectFeedback = {
  rating: number;
  comment: string;
  created_at: string;
};

type Candle = {
  id: number;
  project_id: string;
  bucket_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartRange = "1H" | "1D" | "1W" | "1M" | "ALL";

import { API_BASE } from "../../../lib/apiBase";
import { errorText } from "../../../lib/errorText";
import { resolveImageUrl, cleanLogoUrl, STOREFRONT_PLACEHOLDER } from "../../../lib/imageSrc";
import {
  createOffer,
  OffersError,
  sanitizeBearerToken,
  updateOffer,
} from "../../../lib/offers";
import { resolveCategoryLabel } from "../../../lib/categories";
import { AdminBar, ExitCustomerViewChip, useViewAsCustomer, writeViewAsCustomer } from "../../../components/project/AdminBar";
import { OfferActionsMenu } from "../../../components/project/OfferActionsMenu";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Inline storefront-description editor. Writes projects.description via
// the owner-gated PATCH /api/projects/{id}. This is the only path that
// fills the field the public About block and the Share Shop gate both
// read — the older "Add description" prompt linked to the booking
// settings page, which edits a different field and left the storefront
// description permanently empty.
function AboutDescriptionEditor({
  projectId,
  ownerId,
  onSaved,
}: {
  projectId: string;
  ownerId: string;
  onSaved: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Owner-Id": ownerId || "",
        },
        body: JSON.stringify({ description: trimmed }),
      });
      if (!res.ok) {
        setError("Could not save. Try again.");
        return;
      }
      onSaved(trimmed);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={600}
        placeholder="Tell customers what you sell and why they should buy from you."
        className="w-full resize-none rounded-xl border border-default bg-surface-page px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
      />
      {error && <div className="mt-1.5 text-xs text-state-live">{error}</div>}
      <button
        type="button"
        onClick={save}
        disabled={!text.trim() || saving}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-4 py-2 text-[11px] font-bold text-black transition hover:bg-brand-teal-hover disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save description"}
      </button>
    </div>
  );
}

function getProjectEmoji(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "💪";
  if (source.includes("math") || source.includes("tutor")) return "🧠";
  if (source.includes("movie") || source.includes("script")) return "🎬";
  if (source.includes("music") || source.includes("beat")) return "🎵";
  if (source.includes("crypto") || source.includes("signal")) return "📈";
  if (source.includes("clean")) return "🧹";
  if (source.includes("tasty") || source.includes("meal") || source.includes("food")) return "🍽️";

  return "🚀";
}
function getCategory(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "Health";
  if (source.includes("math") || source.includes("tutor")) return "Education";
  if (source.includes("movie") || source.includes("script")) return "Creative";
  if (source.includes("music") || source.includes("beat")) return "Music";
  if (source.includes("crypto") || source.includes("signal")) return "Finance";
  if (source.includes("clean")) return "Business";
  if (
    source.includes("tasty") ||
    source.includes("meal") ||
    source.includes("food") ||
    source.includes("cook")
  ) {
    return "Food";
  }

  return "Business";
}

function getAccent(project: Project | null) {
  const source = `${project?.title || project?.name || ""} ${project?.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "#00FFB2";
  if (source.includes("math") || source.includes("tutor")) return "#38BDF8";
  if (source.includes("movie") || source.includes("script")) return "#FBBF24";
  if (source.includes("music") || source.includes("beat")) return "#F472B6";
  if (source.includes("crypto") || source.includes("signal")) return "#38BDF8";
  if (source.includes("clean")) return "#A78BFA";
  if (
    source.includes("tasty") ||
    source.includes("meal") ||
    source.includes("food") ||
    source.includes("cook")
  ) {
    return "#00FFB2";
  }

  return "#00FFB2";
}

function makeDefaultTokenName(project: Project | null) {
  return (project?.title || project?.name || "DUM Project Token").slice(0, 32);
}

function makeDefaultTokenSymbol(project: Project | null) {
  const base = (project?.title || project?.name || "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.slice(0, 3).toUpperCase())
    .join("")
    .slice(0, 6);

  return base || "";
}

function getOrCreateSessionId(projectId: string) {
  const key = `dumclub_project_chat_session_${projectId}`;
  const existing = typeof window !== "undefined" ? localStorage.getItem(key) : null;

  if (existing) return existing;

  const newId = `session-${projectId}-${Date.now()}`;
  localStorage.setItem(key, newId);
  return newId;
}

function shortMint(value?: string | null) {
  if (!value) return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

/* ── Scroll helper. accounts for sticky navbar offset ── */
const NAV_OFFSET = 110; // navbar ~92px + 18px breathing room
function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
  window.scrollTo({ top, behavior: "smooth" });
}

/* ── Floating Section Navigator ── */
const NAV_SECTIONS = [
  { id: "section-top", label: "Top", mode: "both" as const },
  { id: "section-about", label: "About", mode: "both" as const },
  { id: "offers-section", label: "Offers", mode: "storefront" as const },
  { id: "section-orders", label: "Orders", mode: "storefront" as const },
  { id: "ai-workspace", label: "AI", mode: "storefront" as const },
];

function SectionNav({ refreshKey = "", mode = "storefront" }: { refreshKey?: string; mode?: string }) {
  const [active, setActive] = useState("");
  const [visible, setVisible] = useState<string[]>([]);

  useEffect(() => {
    // Filter by mode + check DOM presence
    const forMode = NAV_SECTIONS.filter((s) => s.mode === "both" || s.mode === mode);
    const present = forMode.filter((s) => document.getElementById(s.id)).map((s) => s.id);
    setVisible(present);
    if (!present.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
    );

    for (const id of present) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [refreshKey, mode]);

  if (visible.length < 2) return null;

  return (
    <nav className="fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 lg:flex">
      <div className="flex flex-col items-end gap-2.5 rounded-2xl border border-default bg-surface-card px-2.5 py-3 backdrop-blur-sm">
        {visible.map((id) => {
          const section = NAV_SECTIONS.find((s) => s.id === id);
          if (!section) return null;
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => scrollToSection(id)}
              className="flex items-center gap-2 transition-all duration-200"
            >
              <span
                className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-200 ${
                  isActive
                    ? "text-brand-teal"
                    : "text-muted hover:text-secondary"
                }`}
              >
                {section.label}
              </span>
              <span
                className={`block shrink-0 rounded-full transition-all duration-300 ${
                  isActive
                    ? "h-2.5 w-2.5 bg-brand-teal"
                    : "h-1.5 w-1.5 bg-zinc-700"
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Legacy DB values not in TOKEN_LIFECYCLE. treat as draft for UI/pipeline. */
function normalizeTokenLifecycleStatus(status?: string | null) {
  const s = (status || "").trim();
  if (s === "active" || s === "pending") return "draft";
  return s || "draft";
}

function formatTokenStatus(status?: string) {
  if (!status) return "-";

  switch (status) {
    case "draft":
      return "Draft";
    case "mint_created":
      return "Mint Created";
    case "tokens_minted":
      return "Tokens Minted";
    case "liquidity_added":
      return "Liquidity Added";
    case "live":
    case "trading_live":
      return "Trading Live";
    default:
      return status.replace(/_/g, " ");
  }
}

function getTokenStageIndex(status?: string) {
  switch (status) {
    case "draft":
      return 0;
    case "mint_created":
      return 1;
    case "tokens_minted":
      return 2; 
    case "liquidity_added":
      return 3;
    case "live":
    case "trading_live":
      return 4;
    default:
      return 0;
  }
}

function parseAiOutput(aiOutput: Project["ai_output"]) {
  if (!aiOutput) return null;

  if (typeof aiOutput === "object") return aiOutput;

  try {
    return JSON.parse(aiOutput);
  } catch {
    return null;
  }
}

function formatNumber(value?: number | string | null, digits = 2) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatPrice(value?: number | string | null) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0.000000";
  return num.toFixed(6);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatPercent(value?: number | null, digits = 2) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0.00%";
  return `${num >= 0 ? "+" : ""}${num.toFixed(digits)}%`;
}

function formatCurrencyCompact(value?: number | null, digits = 2) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "$0.00";
  if (num === 0) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(num);
}

function getRangeMs(range: ChartRange) {
  switch (range) {
    case "1H":
      return 60 * 60 * 1000;
    case "1D":
      return 24 * 60 * 60 * 1000;
    case "1W":
      return 7 * 24 * 60 * 60 * 1000;
    case "1M":
      return 30 * 24 * 60 * 60 * 1000;
    case "ALL":
    default:
      return Infinity;
  }
}

function getStatusExplanation(status?: string) {
  switch (status) {
    case "draft":
      return "Project is still being prepared before mint actions begin.";
    case "mint_created":
      return "Mint exists and token infrastructure is now initialized.";
    case "tokens_minted":
      return "Tokens have been minted and supply is available for distribution.";
    case "liquidity_added":
      return "Liquidity has been prepared for market activity and pricing.";
    case "trading_live":
      return "Trading is live and token activity is available on the market terminal.";
    default:
      return "This token is progressing through the DUM Club launch pipeline.";
  }
}

export default function ProjectPage() {
  const params = useParams();
  const id = params?.id as string;
  const { user: authUser, loading: authLoading, login, getToken } = useAuth();
  const { notify, toast: statusToast } = useStatusToast();
  // useSolanaWallets() / useWallet() were called here at the top of the
  // component before the lazy-Solana-subtree refactor (Option C). They
  // forced the @solana/wallet-adapter packages into every consumer page
  // chunk even though the SOL CTA is gated by SOL_CHECKOUT_ENABLED
  // (false in prod). The hooks now live inside the lazy
  // SolanaCheckoutButton, which passes the resolved `wallets` +
  // `adapterWallet` back through its render-prop to the SOL CTA's
  // onClick handler — `payOfferWithSolHandler` receives them as
  // arguments instead of reading them from this top-level closure.

  // Diagnostic: log effective API base on mount
  useEffect(() => {
  }, []);

  const [project, setProject] = useState<Project | null>(null);
  // "Live for H:MM" — elapsed since the broadcast started (migration 084),
  // computed from project.live_started_at and ticked client-side. Null when
  // not live or the column is absent (pre-084 stream) -> the banner omits it.
  const [liveFor, setLiveFor] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("DUM Club Business");
  // Pin-offer feedback state. pinningOfferId tracks which chip is
  // currently in flight (or "__unpin__" when clearing); pinError
  // surfaces backend failures inline next to the new offline pin UI
  // so the merchant doesn't have to crack open the console.
  const [pinningOfferId, setPinningOfferId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  // Seller-selectable pin timer. When the seller features an offer it shows
  // an on-screen urgency countdown to viewers for this many minutes. Display
  // only — nothing about price/availability changes at zero. Must stay in
  // sync with PIN_DURATION_CHOICES on the backend (the gate of record).
  const PIN_DURATION_CHOICES = [2, 5, 10, 30, 60] as const;
  const [pinDurationMinutes, setPinDurationMinutes] = useState<number>(5);
  // Embed installer / activation state (owner-only).
  //   copiedSnippet . flashes "Copied ✓" on whichever copy button
  //                    was just clicked. Shared across all tabs.
  //   embedModalOpen. controls the Activate-DUM-Live wizard modal.
  //   embedActivePath. which tab is currently selected.
  //   embedPlatform  . selected platform inside the Guided tab.
  const [copiedSnippet, setCopiedSnippet] = useState<
    "script" | "iframe" | "instructions" | "developer-msg" | null
  >(null);
  const [embedModalOpen, setEmbedModalOpen] = useState<boolean>(false);
  const [embedActivePath, setEmbedActivePath] = useState<
    "guided" | "self" | "advanced" | "developer"
  >("guided");
  const [embedPlatform, setEmbedPlatform] = useState<string | null>(null);

  // Phase 4 of the embed installer audit. manual "I pasted it"
  // confirmation toggle. localStorage-backed per slug so the
  // merchant doesn't lose the success state on reload. We
  // explicitly do NOT verify the install (no real embed
  // detection, no merchant-URL ping) per the merchant audit's
  // MVP scope. this is a trust-based toggle that flips the
  // modal to a celebration view and queues the next action.
  const [installConfirmed, setInstallConfirmed] = useState<boolean>(false);

  // Sync installConfirmed with localStorage on mount and whenever
  // the project's slug changes. Storage key is per-slug so a
  // merchant with multiple projects can confirm install on each
  // independently. Read is guarded on typeof window so it's
  // SSR-safe; the initial `false` value renders identically on
  // server and client until this effect runs post-hydration.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const slugKey = project?.slug;
    if (!slugKey) return;
    try {
      setInstallConfirmed(
        window.localStorage.getItem(`dum-live-installed-${slugKey}`) === "true",
      );
    } catch {
      // localStorage can throw in private browsing on some
      // browsers. non-fatal, the merchant can re-confirm.
    }
  }, [project?.slug]);

  function confirmInstall() {
    if (typeof window === "undefined" || !project?.slug) return;
    try {
      window.localStorage.setItem(`dum-live-installed-${project.slug}`, "true");
    } catch {
      // ignore. see useEffect above
    }
    setInstallConfirmed(true);
  }

  function resetInstall() {
    if (typeof window === "undefined" || !project?.slug) return;
    try {
      window.localStorage.removeItem(`dum-live-installed-${project.slug}`);
    } catch {
      // ignore. see useEffect above
    }
    setInstallConfirmed(false);
  }
  const [projectStatus, setProjectStatus] = useState("draft");
  // Publish Store toggle — flips projects.status draft <-> live via the
  // owner-gated /publish + /unpublish endpoints. Separate from the
  // livestream (is_live); see the Store Status card below.
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");

  const [memoryText, setMemoryText] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("");

  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenSupply, setTokenSupply] = useState("1000000");
  const [tokenMeta, setTokenMeta] = useState({
    name: "",
    symbol: "",
    supply: "",
    decimals: "",
    status: "",
    mint_address: "",
  });

  const [market, setMarket] = useState<MarketState | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [shareFlash, setShareFlash] = useState(false);
  const [chartRange, setChartRange] = useState<ChartRange>("1D");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemStatus, setRedeemStatus] = useState("");
  const [loadingRedeem, setLoadingRedeem] = useState(false);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [feedbackEntries, setFeedbackEntries] = useState<ProjectFeedback[]>([]);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [togglingFavorite, setTogglingFavorite] = useState(false);
  // Immersive live room: a non-owner viewing a live IVS shop gets the
  // full-bleed LiveRoom overlay. Dismissing (✕) reveals the normal
  // storefront underneath (which re-mounts the inline video/chat).
  const [immersiveDismissed, setImmersiveDismissed] = useState(false);
  // Owner's own view of their offline shop now DEFAULTS to the clean buyer
  // storefront (so the merchant sees the modern page, like visitors do).
  // "Manage shop" flips this on to reveal the management tree; the
  // storefront carries a "View storefront" control to flip back.
  const [ownerManage, setOwnerManage] = useState(false);
  const [backendReviews, setBackendReviews] = useState<{ id: number; rating: number; comment: string; created_at: string }[]>([]);
  const [backendAvgRating, setBackendAvgRating] = useState(0);
  const [backendReviewCount, setBackendReviewCount] = useState(0);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  const [loadingProject, setLoadingProject] = useState(true);
  const [ownerBizProfile, setOwnerBizProfile] = useState<{
    business_name?: string;
    verification_status?: string;
    // Image-forward fields. logo_url existed pre-mig-072 (mig 014);
    // cover_image_url ships with mig 072. Both nullable / optional —
    // the storefront falls back to emoji avatar / no cover banner
    // when null, preserving every existing merchant's render.
    logo_url?: string | null;
    cover_image_url?: string | null;
    // Location, surfaced as a "City, ST" chip in the storefront header
    // when present. Populated by the discover/storefront endpoints once
    // a merchant sets a location; absent fields render nothing (graceful
    // for every storefront that hasn't set one yet).
    city?: string | null;
    region?: string | null;
    location_city?: string | null;
    location_state?: string | null;
  } | null>(null);
  const [embedExpanded, setEmbedExpanded] = useState(false);
  const [dumDiscountApplied, setDumDiscountApplied] = useState<Record<string, boolean>>({});
  const [dumDiscountError, setDumDiscountError] = useState<string | null>(null);
  const [gameLocked, setGameLocked] = useState(false);
  const [gamePlaysLeft, setGamePlaysLeft] = useState(999);
  const [gameUnlocked, setGameUnlocked] = useState(true);
  const gameInteracted = useRef(false);

  // Initialize play count from localStorage on mount
  useEffect(() => {
    if (!id) return;
    const key = `dum_plays_${id}`;
    const plays = Number(localStorage.getItem(key) || "0");
    const unlocked = localStorage.getItem(`dum_game_unlocked_${id}`) === "true";
    if (unlocked) {
      setGameUnlocked(true);
      setGameLocked(false);
      setGamePlaysLeft(Infinity);
    } else if (plays >= 3) {
      setGameLocked(true);
      setGamePlaysLeft(0);
    } else {
      setGamePlaysLeft(3 - plays);
    }
  }, [id]);

  function handleGameInteraction() {
    if (gameUnlocked || gameInteracted.current || !id) return;
    gameInteracted.current = true;
    const key = `dum_plays_${id}`;
    const plays = Number(localStorage.getItem(key) || "0") + 1;
    localStorage.setItem(key, String(plays));
    if (plays >= 3) {
      setGameLocked(true);
      setGamePlaysLeft(0);
    } else {
      setGamePlaysLeft(3 - plays);
    }
  }

  async function unlockGameWithDum() {
    if (!id) return;
    const privyId = authUser?.privyId;
    if (privyId) {
      try {
        const dumToken = await getToken();
        const res = await fetch(`${API_BASE}/api/dum/spend`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(dumToken ? { Authorization: `Bearer ${dumToken}` } : {}) },
          body: JSON.stringify({ privy_id: privyId, amount: 10, reason: "game_unlock", project_id: id }),
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem("dum_points", String(data.balance));
          localStorage.setItem(`dum_game_unlocked_${id}`, "true");
          window.dispatchEvent(new Event("dum-points-update"));
          setGameUnlocked(true);
          setGameLocked(false);
          setGamePlaysLeft(Infinity);
          return;
        }
      } catch {}
    }
    // Fallback: localStorage
    const pts = Number(localStorage.getItem("dum_points") || "0");
    if (pts < 10) return;
    localStorage.setItem("dum_points", String(pts - 10));
    localStorage.setItem(`dum_game_unlocked_${id}`, "true");
    window.dispatchEvent(new Event("dum-points-update"));
    setGameUnlocked(true);
    setGameLocked(false);
    setGamePlaysLeft(Infinity);
  }
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionIsError, setActionIsError] = useState(false);

  const [serviceProfile, setServiceProfile] = useState<Record<string, unknown> | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  // "View as customer" preview toggle from the AdminBar. When
  // true, owner-only inline chrome (offer-card ellipsis menus,
  // edit forms, etc.) is hidden so the merchant can see the
  // page exactly the way a real visitor does. The toggle is
  // sessionStorage-scoped per project — a new tab clears it,
  // and a hard refresh restores the admin view.
  const viewAsCustomer = useViewAsCustomer(id || "");
  // Anywhere we previously gated on `isOwner`, the new gate is
  // `showOwnerInlineUi` — hides chrome under preview mode while
  // keeping the underlying owner flag for data-fetching paths
  // (orders, market etc) that the visitor never sees.
  const showOwnerInlineUi = isOwner && !viewAsCustomer;

  // AI Builder state
  const [builderAction, setBuilderAction] = useState<string | null>(null);
  const [builderLoading, setBuilderLoading] = useState(false);
  const [builderResult, setBuilderResult] = useState<{ current: string; suggested: string } | null>(null);
  const [builderField, setBuilderField] = useState<string | null>(null);
  const [builderToast, setBuilderToast] = useState<string | null>(null);
  const [promoCopy, setPromoCopy] = useState<string>("");
  const [pitchMode, setPitchMode] = useState(false);

  // Store / Offers state
  type StoreItemType = "physical" | "digital" | "service" | "subscription";
  interface StoreItem {
    id: string;
    name: string;
    description: string;
    price: string;
    type: StoreItemType;
    benefits?: string[];
    required_token_amount?: number | null;
    perk_description?: string | null;
    token_holder_price?: string | null;
  }
  interface Offer {
    id: string;
    project_id: string;
    title: string;
    description: string | null;
    price_usd: number;
    compare_at_price?: number | null;
    offer_type: string;
    delivery_info: string | null;
    token_discount_percent: number;
    primary_image_url: string | null;
    video_url: string | null;
    quantity_available: number | null;
    quantity_sold: number;
    unlimited_inventory: boolean;
    is_active: boolean;
    created_at: string;
  }
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerFormOpen, setOfferFormOpen] = useState(false);
  const [offerEditing, setOfferEditing] = useState<Partial<Offer> | null>(null);
  const [offerSaving, setOfferSaving] = useState(false);
  const [offerSaveError, setOfferSaveError] = useState<string | null>(null);
  const [offerSaveSuccess, setOfferSaveSuccess] = useState(false);
  const [offerImageFile, setOfferImageFile] = useState<File | null>(null);
  const [offerImagePreview, setOfferImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [offerAiField, setOfferAiField] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [buyingOfferId, setBuyingOfferId] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<"success" | "cancelled" | null>(null);
  // Homepage recommendation context (from ?offer=...&reason=...)
  const [recommendedOffer, setRecommendedOffer] = useState<string | null>(null);
  const [recommendedReason, setRecommendedReason] = useState<string | null>(null);
  const recommendedScrolled = useRef(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [demoClickedId, setDemoClickedId] = useState<string | null>(null);
  const [buyStep, setBuyStep] = useState<Record<string, string>>({});
  const [buyError, setBuyError] = useState<Record<string, string>>({});
  // Demo mode short-circuits buyOffer with a simulated purchase instead
  // of calling /api/checkout/create-payment-intent. It is opt-IN: prod
  // leaves NEXT_PUBLIC_DEMO_MODE unset → isDemo === false → real Stripe
  // checkout. The previous `!== "false"` default-on form silently killed
  // checkout in prod because the env was never set.
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const [simulatedPurchase, setSimulatedPurchase] = useState<string | null>(null);
  const [simulatedRevenue, setSimulatedRevenue] = useState(0);
  const [simPurchaseCount, setSimPurchaseCount] = useState(0);
  interface Order {
    id: string;
    offer_id: string;
    project_id: string;
    buyer_user_id: string;
    buyer_email: string | null;
    amount_paid_usd: number;
    platform_fee_usd: number;
    seller_receives_usd: number;
    status: string;
    created_at: string;
    updated_at: string;
    tracking_number?: string | null;
    shipping_address?: {
      name?: string | null; phone?: string | null;
      line1?: string | null; line2?: string | null;
      city?: string | null; state?: string | null;
      postal_code?: string | null; country?: string | null;
    } | null;
    offers?: { title: string; offer_type: string; price_usd: number } | null;
  }
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  const [storeEditing, setStoreEditing] = useState<StoreItem | null>(null);
  // ── Owner-view lifecycle gating (UX simplification sprint) ──
  // Mirrors the STATE definitions in lib/merchantState.ts using the data
  // this page already loads, so growth / advanced owner surfaces stay
  // hidden until the merchant has something to grow:
  //   ownerHasOffers — STATE_2+ (at least one offer exists)
  //   ownerHasSales  — STATE_3+ (at least one paid order)
  // A brand-new owner (pre-first-sale) sees a clean page focused on
  // creating and sharing their first offer.
  const ownerHasSales = sellerOrders.length > 0;
  const [storeFormOpen, setStoreFormOpen] = useState(false);
  const [storeTargetItem, setStoreTargetItem] = useState<StoreItem | null>(null);
  const [storePickerFor, setStorePickerFor] = useState<string | null>(null);

  // Project Score state
  interface ProjectScore {
    virality: { score: number; reason: string };
    trust: { score: number; reason: string };
    utility: { score: number; reason: string };
  }
  const [projectScore, setProjectScore] = useState<ProjectScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(false);

  // Live banner. shown only on launch arrivals via ?launched=1 from /build
  const [showLiveBanner, setShowLiveBanner] = useState(false);

  // Live Commerce state
  const [liveSalesCount, setLiveSalesCount] = useState(0);
  const [saleToasts, setSaleToasts] = useState<{ id: string; title: string; count: number }[]>([]);
  const [dumPointsEarned, setDumPointsEarned] = useState<number | null>(null);
  // Audit #4 Phase 1 (Q2). viewer count lifted from LiveChatIVS so
  // the public live banner can show "X watching" without opening a
  // second WebSocket connection. Stays 0 until the first
  // `viewer_count` event arrives over the existing chat socket.
  const [liveViewerCount, setLiveViewerCount] = useState(0);
  // Audit #4 Phase 1 (Q11). when the host ends a stream during
  // the same page session, hold a "Show ended" banner for ~30s so
  // the buyer who was watching gets acknowledgement instead of a
  // silent revert to storefront mode. We only flip this on a real
  // true → false transition; pages that load after the stream
  // ended (is_live already false) do nothing.
  const [streamJustEnded, setStreamJustEnded] = useState(false);
  const [streamEndedSummary, setStreamEndedSummary] = useState<{ sales: number } | null>(null);
  const [autoGoLive, setAutoGoLive] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);

  // Auction state
  type Auction = {
    id: string;
    project_id: string;
    offer_id: string;
    starting_price: number;
    current_bid: number | null;
    current_bidder: string | null;
    current_bidder_display: string | null;
    bid_count: number;
    status: "active" | "ended" | "awaiting_payment" | "paid" | "voided" | "closed";
    duration_seconds: number;
    ends_at: string;
    ended_at: string | null;
  };
  const [auction, setAuction] = useState<Auction | null>(null);
  const [auctionBidAmount, setAuctionBidAmount] = useState("");
  const [auctionBidding, setAuctionBidding] = useState(false);
  const [auctionBidError, setAuctionBidError] = useState<string | null>(null);
  const [auctionCountdown, setAuctionCountdown] = useState("");
  const [auctionStarting, setAuctionStarting] = useState(false);
  const [auctionStartPrice, setAuctionStartPrice] = useState("10");
  const [auctionDuration, setAuctionDuration] = useState(120);
  const [auctionOfferSelect, setAuctionOfferSelect] = useState<string | null>(null);
  const [bannerCopied, setBannerCopied] = useState(false);

  const [chatMeta, setChatMeta] = useState<{
    is_holder: boolean;
    free_limit: number;
    used_count: number;
    free_questions_left: number;
    holder_unlimited: boolean;
    token_required: boolean;
    token_mint_address?: string | null;
    locked: boolean;
    lock_message: string;
    contact_email: string | null;
  }>({
    is_holder: false,
    free_limit: 1,
    used_count: 0,
    free_questions_left: 1,
    holder_unlimited: true,
    token_required: false,
    token_mint_address: null,
    locked: false,
    lock_message: "",
    contact_email: null,
  });
  async function loadProject() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load project");

      const data = await res.json();
      const projectData = data?.project || data;

      setProject(projectData);

      const resolvedName = projectData?.title || projectData?.name || "DUM Club Business";
      setProjectName(resolvedName);
      setProjectStatus(projectData?.review_status || "draft");

      setTokenName(projectData?.token_name || makeDefaultTokenName(projectData));
      setTokenSymbol(projectData?.token_symbol || makeDefaultTokenSymbol(projectData));
      setTokenSupply(projectData?.token_supply ? String(projectData.token_supply) : "1000000");

      setChatMeta((prev) => ({
        ...prev,
        free_limit: Number(projectData?.ai_free_question_limit || 1),
        free_questions_left: Number(projectData?.ai_free_question_limit || 1),
        holder_unlimited: Boolean(
          projectData?.holder_ai_unlimited === undefined ? true : projectData?.holder_ai_unlimited
        ),
        token_required: Boolean(projectData?.token_mint_address),
        token_mint_address: projectData?.token_mint_address || null,
      }));

      // Hydrate promo copy and store items from persisted data
      if (projectData?.promo_copy) setPromoCopy(projectData.promo_copy);
      if (Array.isArray(projectData?.store_items)) setStoreItems(projectData.store_items);

      try {
        const profileRes = await fetch(`${API_BASE}/api/projects/${id}/service-profile`, {
          cache: "no-store",
        });
        if (profileRes.ok) {
          const p = await profileRes.json();
          setServiceProfile(p == null ? null : p);
        } else {
          setServiceProfile(null);
        }
      } catch {
        setServiceProfile(null);
      }
    } catch (err) {
      console.error(err);
      setProject(null);
      setProjectName("DUM Club Business");
      setProjectStatus("draft");
    } finally {
      setLoadingProject(false);
    }
  }

  async function loadTokenMetadata() {
    if (!id) return;

    // Best-effort enrichment: many projects (service merchants, drafts,
    // pre-token state) legitimately return non-2xx here. Silently fall
    // back to empty metadata rather than logging red errors on every
    // page load.
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/token-metadata`, {
        cache: "no-store",
      });

      if (!res.ok) {
        setTokenMeta({
          name: "",
          symbol: "",
          supply: "",
          decimals: "",
          status: "",
          mint_address: "",
        });
        return;
      }

      const data = await res.json();

      setTokenMeta({
        name: data.name || "",
        symbol: data.symbol || "",
        supply: data.supply != null ? String(data.supply) : "",
        decimals: data.decimals != null ? String(data.decimals) : "",
        status: data.status || "",
        mint_address: data.mint_address || "",
      });
    } catch {
      setTokenMeta({
        name: "",
        symbol: "",
        supply: "",
        decimals: "",
        status: "",
        mint_address: "",
      });
    }
  }

  async function loadMemories() {
    // Use the resolved project UUID, not the URL param. the URL param
    // may be a slug (e.g. "topgun-maintenance") which the memories
    // endpoint does not support.
    if (!project?.id) return;

    // Best-effort: memories are a non-critical AI-context enrichment.
    // Non-2xx means "no memories indexed yet". not an error.
    try {
      const res = await fetch(`${API_BASE}/api/memories/?project_id=${project.id}`);
      if (!res.ok) {
        setMemories([]);
        return;
      }

      const data = await res.json();
      setMemories(data.memories || data || []);
    } catch {
      setMemories([]);
    }
  }

  async function loadOffers() {
    // Use the resolved project UUID, not the URL param. the URL param
    // may be a slug (e.g. "topgun-maintenance") which the offers
    // endpoint does not support.
    if (!project?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/offers/${project.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load offers");
      const data = await res.json();
      setOffers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setOffers([]);
    }
  }

  // Lightweight viewer-side project refresh used by the live-stream polling
  // loop. Deliberately does NOT go through the full loadProject() path —
  // that one also resets chatMeta (including free_questions_left), promoCopy,
  // storeItems, tokenMeta, and serviceProfile, which would clobber in-progress
  // UI state on every tick. We merge only the fields that actually change
  // during a live stream (live state + pinned offer + auction + status).
  async function refreshLiveStateForViewer() {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const fresh = data?.project || data;
      if (!fresh) return;
      setProject((prev) => prev ? {
        ...prev,
        is_live: fresh.is_live,
        pinned_offer_id: fresh.pinned_offer_id ?? null,
        active_auction_id: fresh.active_auction_id ?? null,
        live_provider: fresh.live_provider ?? null,
        // ivs_stage_arn MUST be merged: the live IVS player only mounts
        // when `isIVSSession(project) && project.ivs_stage_arn`. Without
        // this, a viewer who opened the page before the host went live
        // would get live_provider="ivs_realtime" on the next poll but a
        // stale null ARN — so the IVSStageViewer never renders and they
        // can't watch the stream they came for.
        ivs_stage_arn: fresh.ivs_stage_arn ?? null,
        live_playback_id: fresh.live_playback_id ?? null,
        live_stream_id: fresh.live_stream_id ?? null,
        stream_url: fresh.stream_url ?? null,
        status: fresh.status ?? prev.status,
      } : fresh);
    } catch {
      // Silent. the next poll tick will retry.
    }
  }

  function openOfferForm(offer?: Offer) {
    setOfferEditing(offer ? { ...offer } : {
      title: "",
      description: "",
      price_usd: 0,
      offer_type: "digital_service",
      delivery_info: "",
      token_discount_percent: 0,
      primary_image_url: "",
      video_url: "",
      quantity_available: null,
      unlimited_inventory: true,
    });
    setOfferFormOpen(true);
    setOfferImageFile(null);
    setOfferImagePreview(null);
  }

  function convertStoreItemToOffer(item: StoreItem) {
    const typeMap: Record<string, string> = {
      digital: "digital_service",
      service: "digital_service",
      subscription: "digital_service",
      physical: "physical_product",
    };
    setOfferEditing({
      title: item.name || "",
      description: item.description || "",
      price_usd: parseFloat(item.price?.replace(/[^0-9.]/g, "") || "0") || 0,
      offer_type: typeMap[item.type] || "digital_service",
      delivery_info: "",
      token_discount_percent: 0,
      primary_image_url: "",
      video_url: "",
    });
    setOfferFormOpen(true);
    setOfferImageFile(null);
    setOfferImagePreview(null);
    // Scroll to the form
    scrollToSection("offers-section");
  }

  async function uploadOfferImage(file: File, token: string): Promise<string | null> {
    // Server-mediated upload (Path 2 hardening sprint PR 4). The browser
    // posts the file to FastAPI; the backend uses the Supabase service
    // key to write into the offers bucket under offer-images/<project>/
    // and gates the write on the Privy bearer + project ownership. Same
    // subpath shape as the prior anon-key browser-direct path so a git
    // revert keeps already-uploaded objects resolving.
    //
    // Failure returns null. The caller (saveOffer) preserves this site's
    // existing UX: surfaces a setOfferSaveError warning, then saves the
    // offer image-less rather than blocking.
    try {
      const fd = new FormData();
      fd.append("project_id", String(id));
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/offers/upload-image`, {
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
          `[image] Upload HTTP ${res.status}:`,
          detail || "(no detail)",
        );
        return null;
      }
      const body = (await res.json()) as { public_url?: string };
      return body.public_url ?? null;
    } catch (err) {
      console.error("[image] Upload failed:", err);
      return null;
    }
  }

  async function offerAiAssist(field: "title" | "description" | "price") {
    if (!offerEditing || !project) return;
    setOfferAiField(field);
    const ctx = `Project: "${project.title || project.name || "Untitled"}"\nDescription: "${project.description || "N/A"}"\nCategory: ${project.template_type || "General"}\nOffer type: ${offerEditing.offer_type || "digital_service"}\nCurrent title: "${offerEditing.title || ""}"\nCurrent description: "${offerEditing.description || ""}"`;
    let prompt = "";
    if (field === "title") {
      prompt = `You are a product listing expert. Generate a short, compelling title for this offer.\n\n${ctx}\n\nReturn ONLY the title text, nothing else. Keep it under 50 characters.`;
    } else if (field === "description") {
      prompt = `You are a product copywriter. Write a clear, persuasive description for this offer.\n\n${ctx}\n\nReturn ONLY the description text, nothing else. Keep it under 200 characters. Be specific and professional.`;
    } else {
      prompt = `You are a pricing strategist. Suggest a realistic USD price for this offer.\n\n${ctx}\nCurrent price: $${offerEditing.price_usd || "not set"}\n\nReturn ONLY a number (e.g. 29.99). Nothing else.`;
    }
    try {
      const res = await fetch(`${API_BASE}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, project_id: id, stream: false }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const result = (data.answer || "").trim();
      if (field === "title") setOfferEditing({ ...offerEditing, title: result });
      else if (field === "description") setOfferEditing({ ...offerEditing, description: result });
      else {
        const num = parseFloat(result.replace(/[^0-9.]/g, ""));
        if (!isNaN(num)) setOfferEditing({ ...offerEditing, price_usd: num });
      }
    } catch {
      // silently fail. user can type manually
    } finally {
      setOfferAiField(null);
    }
  }

  async function saveOffer() {
    if (!offerEditing) return;
    if (!offerEditing.title?.trim()) {
      setOfferSaveError("Title is required");
      return;
    }
    if (!id) {
      setOfferSaveError("Project ID missing. Try refreshing the page.");
      return;
    }
    const priceNum = Number(offerEditing.price_usd);
    if (!priceNum || priceNum <= 0) {
      setOfferSaveError("Price must be greater than $0");
      return;
    }
    setOfferSaving(true);
    setOfferSaveError(null);
    setOfferSaveSuccess(false);
    try {
      // Auth-readiness gate. If Privy hasn't issued a token yet
      // (signed-out OR session-not-ready), short-circuit BEFORE
      // we call fetch so the user gets a clean "please sign in"
      // toast instead of an opaque "TypeError: Failed to fetch".
      const token = await getToken();
      const cleanToken = sanitizeBearerToken(token);
      if (!cleanToken) {
        setOfferSaveError("Please sign in to create an offer.");
        setOfferSaving(false);
        return;
      }

      // Upload image if file selected
      let imageUrl = offerEditing.primary_image_url?.trim() || null;
      if (offerImageFile) {
        const uploaded = await uploadOfferImage(offerImageFile, cleanToken);
        if (uploaded) {
          imageUrl = uploaded;
        } else {
          setOfferSaveError("Could not save the image. Offer will be saved without it. Please try again.");
        }
      }

      const isEdit = Boolean(offerEditing.id);
      const body = {
        title: offerEditing.title?.trim() || "",
        description: offerEditing.description?.trim() || null,
        price_usd: priceNum,
        // Only send a positive compare-at above the price (a "was" price);
        // otherwise omit so the backend's not-None filter leaves it unset.
        compare_at_price:
          offerEditing.compare_at_price && offerEditing.compare_at_price > priceNum
            ? Number(offerEditing.compare_at_price)
            : null,
        offer_type: offerEditing.offer_type || "digital_service",
        delivery_info: offerEditing.delivery_info?.trim() || null,
        token_discount_percent: Number(offerEditing.token_discount_percent) || 0,
        primary_image_url: imageUrl,
        video_url: offerEditing.video_url?.trim() || null,
        quantity_available: offerEditing.unlimited_inventory ? null : (offerEditing.quantity_available || null),
        unlimited_inventory: offerEditing.unlimited_inventory ?? true,
      };

      const created = isEdit
        ? await updateOffer({
            token: cleanToken,
            offerId: String(offerEditing.id),
            body,
          })
        : await createOffer({
            token: cleanToken,
            body: { ...body, project_id: String(id) },
          });
      // Award DUM Points for creating an offer
      try {
        const privyId = authUser?.privyId;
        if (privyId) {
          const dumToken = await getToken();
          const dumRes = await fetch(`${API_BASE}/api/dum/award`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(dumToken ? { Authorization: `Bearer ${dumToken}` } : {}) },
            body: JSON.stringify({ privy_id: privyId, amount: 5, reason: "offer_created" }),
          });
          if (dumRes.ok) {
            const dumData = await dumRes.json();
            localStorage.setItem("dum_points", String(dumData.balance));
          }
        } else {
          // Fallback: localStorage only
          const pts = Number(localStorage.getItem("dum_points") || "0");
          localStorage.setItem("dum_points", String(pts + 5));
        }
        window.dispatchEvent(new Event("dum-points-update"));
      } catch {}
      await loadOffers();
      setOfferFormOpen(false);
      setOfferEditing(null);
      setOfferImageFile(null);
      setOfferImagePreview(null);
      setOfferSaveSuccess(true);
      setTimeout(() => setOfferSaveSuccess(false), 5000);
    } catch (err) {
      // OffersError surfaces the friendliest message + a code we
      // can use to branch on. Generic Errors get their own line.
      if (err instanceof OffersError) {
        console.error("[saveOffer] ERROR:", err.code, err.status ?? "", err.message);
        setOfferSaveError(err.message);
      } else {
        console.error("[saveOffer] ERROR:", err);
        setOfferSaveError(err instanceof Error ? err.message : "Failed to save offer");
      }
    } finally {
      setOfferSaving(false);
    }
  }

  async function toggleOfferActive(offer: Offer) {
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_BASE}/api/offers/${offer.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_active: !offer.is_active }),
      });
      await loadOffers();
    } catch (err) {
      console.error(err);
    }
  }

  async function buyOffer(offer: Offer, auctionId?: string, overridePrice?: number) {
    const oid = offer.id;
    // Automation: capture offer click
    captureOfferClick(id as string, offer.title, Number(offer.price_usd || 0), authUser?.privyId);
    setBuyStep((p) => ({ ...p, [oid]: "clicked" }));
    setBuyError((p) => ({ ...p, [oid]: "" }));

    // Guest checkout — the backend accepts unauthenticated
    // /create-payment-intent calls and mints a synthetic
    // guest:<token> buyer id; Stripe Checkout captures the real
    // email at the payment step. No Privy modal blocks the sale.
    if (isOwner) {
      setBuyStep((p) => ({ ...p, [oid]: "blocked_owner" }));
      return;
    }
    if (isDemo) {
      // Simulate a real purchase flow for demo/hackathon
      setBuyingOfferId(oid);
      setBuyStep((p) => ({ ...p, [oid]: "processing_demo" }));
      await new Promise((r) => setTimeout(r, 1200));
      const price = Number(offer.price_usd || 0);
      setSimulatedPurchase(offer.title);
      setSimulatedRevenue((prev) => prev + price);
      setSimPurchaseCount((prev) => prev + 1);
      setCheckoutResult("success");
      setBuyingOfferId(null);
      setBuyStep((p) => ({ ...p, [oid]: "demo_success" }));
      // Award DUM Points locally
      const pts = Number(localStorage.getItem("dum_points") || "0");
      localStorage.setItem("dum_points", String(pts + 10));
      window.dispatchEvent(new Event("dum-points-update"));
      // Broadcast live purchase event
      if (project?.is_live && id) {
        setLiveSalesCount((c) => c + 1);
        broadcastLiveEvent(id, {
          user: authUser?.email || "Viewer",
          text: `purchased ${offer.title}. +10 DUM`,
          type: "purchase",
        });
        broadcastLiveEvent(id, {
          user: "System",
          text: `${authUser?.email || "A viewer"} earned +10 DUM Points`,
          type: "reward",
        });
      }
      setTimeout(() => { setSimulatedPurchase(null); setBuyStep((p) => ({ ...p, [oid]: "" })); }, 6000);
      return;
    }

    setBuyingOfferId(oid);
    setBuyStep((p) => ({ ...p, [oid]: "getting_token" }));

    try {
      // Token is optional now — the backend accepts guest
      // checkouts and Stripe collects the email on the payment
      // page. If a signed-in buyer's token fetch fails, we
      // proceed without it rather than blocking the sale.
      let token: string | null = null;
      if (authUser) {
        try {
          token = await getToken();
        } catch {
          token = null;
        }
      }

      setBuyStep((p) => ({ ...p, [oid]: "calling_checkout" }));

      // Drive Your Market Analytics. checkout intent. Fires before
      // the Stripe call so funnel drop-off includes Stripe failures
      // / cancels.
      trackEvent("checkout_start", {
        project_id: project?.id ?? null,
        offer_id: oid,
      });

      // Strip existing query params to avoid malformed URLs on repeat purchases
      const cleanUrl = window.location.origin + window.location.pathname;

      const checkoutPayload = {
        offer_id: oid,
        success_url: cleanUrl,
        cancel_url: cleanUrl,
        use_dum_discount: !!dumDiscountApplied[oid],
        source: auctionId ? "live_auction" : project?.is_live ? "live" : "normal",
        ...(auctionId && { auction_id: auctionId }),
        ...(overridePrice != null && { override_price: overridePrice }),
      };

      // Creating the Stripe session is a single round-trip to the
      // backend. That host can cold-start, so the FIRST POST after the
      // page has sat idle sometimes fails at the network layer
      // (TypeError: Failed to fetch) before the request is ever
      // processed — the page's earlier GETs woke nothing that stays
      // warm by checkout time. A thrown fetch means no order and no
      // Stripe session were created, so retrying is safe (it can't
      // double-charge — the buyer only pays on the Stripe page). We
      // retry ONLY on a thrown network error; any real HTTP response,
      // even non-2xx, breaks the loop and is handled below without a
      // retry so a server-side error is never silently repeated.
      let res: Response | null = null;
      let networkErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(`${API_BASE}/api/checkout/create-payment-intent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(checkoutPayload),
          });
          break;
        } catch (netErr) {
          networkErr = netErr;
          res = null;
          if (attempt < 2) {
            setBuyStep((p) => ({ ...p, [oid]: "retrying_checkout" }));
            // Short backoff gives a cold backend time to wake before
            // the next attempt (700ms, then 1400ms).
            await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          }
        }
      }

      if (!res) {
        // Never got a response after retries — the backend was
        // unreachable, not an error it returned. Show an actionable
        // message instead of the raw "Failed to fetch".
        console.error("[buyOffer] checkout unreachable after retries:", networkErr);
        setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
        setBuyError((p) => ({
          ...p,
          [oid]: "Couldn't reach checkout. Check your connection and try again.",
        }));
        setBuyingOfferId(null);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("[buyOffer] Checkout error detail:", errData);
        const msg = errorText(errData.detail, `Checkout failed (HTTP ${res.status})`);
        setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
        setBuyError((p) => ({ ...p, [oid]: msg }));
        setBuyingOfferId(null);
        return;
      }

      const data = await res.json();
      if (data.checkout_url) {
        setBuyStep((p) => ({ ...p, [oid]: "redirecting" }));
        const buyPrice = overridePrice ?? Number(offer.price_usd || 0);
        sessionStorage.setItem("liveLastBuyPrice", String(buyPrice));
        // Automation: capture purchase event before redirect
        capturePurchase(id as string, offer.title, buyPrice, data.order_id, authUser?.privyId);
        window.location.href = data.checkout_url;
      } else {
        setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
        setBuyError((p) => ({ ...p, [oid]: "No checkout_url in response" }));
        setBuyingOfferId(null);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Unknown error";
      console.error("[buyOffer] ERROR:", raw);
      // A bare "Failed to fetch" is a network reach problem, not
      // something the buyer can act on as-is — surface the same
      // actionable copy the retry path uses.
      const msg = /failed to fetch/i.test(raw)
        ? "Couldn't reach checkout. Check your connection and try again."
        : raw;
      setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
      setBuyError((p) => ({ ...p, [oid]: msg }));
      setBuyingOfferId(null);
    }
  }

  // Comment-to-buy: a viewer typed a claim keyword in live chat. Claim the
  // active pinned offer (records the claim + broadcasts "X just claimed!"),
  // then hand off to the EXISTING buyOffer() Stripe checkout for the
  // returned offer. Degrades gracefully: a 409 (no pin / sold out) just
  // surfaces nothing here — the chat input was already cleared.
  async function handleCommentBuy(_text: string) {
    if (!pinnedOffer || !id) return;
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/checkout/claim-offer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          project_id: id,
          // Same self-reported display the chat already shows for this user.
          display_name: authUser?.email ? authUser.email.split("@")[0] : undefined,
          keyword: _text.slice(0, 32),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        console.warn("[comment-buy] claim not accepted:", j?.detail || res.status);
        return;
      }
      const data = await res.json().catch(() => null);
      const off = (data?.offer_id && offers.find((o) => o.id === data.offer_id)) || pinnedOffer;
      if (off) buyOffer(off);
    } catch (err) {
      console.error("[comment-buy] failed", err);
    }
  }

  // Solana wallet checkout. secondary CTA, additive to Stripe.
  // Same per-offer state (buyingOfferId, buyStep, buyError) so the
  // Stripe button is disabled while a SOL payment is in flight.
  async function payOfferWithSolHandler(
    offer: Offer,
    sol: SolanaCheckoutApi,
    auctionId?: string,
    overridePrice?: number,
  ) {
    // wallets + adapterWallet now arrive as the `sol` argument from the
    // lazy SolanaCheckoutButton's render-prop. The rest of the body is
    // unchanged from before the lazy-Solana-subtree refactor.
    const { wallets, adapterWallet } = sol;
    const oid = offer.id;
    setBuyError((p) => ({ ...p, [oid]: "" }));

    if (!authUser) {
      setBuyError((p) => ({ ...p, [oid]: "Sign in to pay with SOL." }));
      return;
    }
    if (isOwner) {
      setBuyError((p) => ({ ...p, [oid]: "You can't buy your own offer." }));
      return;
    }

    const wallet = pickSolPayWallet(wallets, adapterWallet);
    if (!wallet) {
      setBuyError((p) => ({
        ...p,
        [oid]:
          "No Solana wallet available. Connect Phantom or refresh to set up your wallet.",
      }));
      return;
    }

    setBuyingOfferId(oid);
    setBuyStep((p) => ({ ...p, [oid]: "sol_quoting" }));

    try {
      const token = await getToken();
      if (!token) {
        setBuyStep((p) => ({ ...p, [oid]: "no_privy_token" }));
        setBuyError((p) => ({
          ...p,
          [oid]: "Authentication failed. Please sign in again.",
        }));
        setBuyingOfferId(null);
        return;
      }

      const solSource = auctionId
        ? "live_auction_sol"
        : project?.is_live
          ? "live_sol"
          : "sol";

      const rpcUrl =
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        process.env.NEXT_PUBLIC_SOLANA_RPC ||
        "https://api.devnet.solana.com";

      const result = await payOfferWithSol({
        offerId: oid,
        source: solSource,
        auctionId,
        overridePrice,
        wallet,
        authToken: token,
        rpcUrl,
        onStep: (s: PayOfferStep) => {
          setBuyStep((p) => ({ ...p, [oid]: `sol_${s}` }));
        },
      });

      const buyPrice = result.usd_amount;
      capturePurchase(
        id as string,
        offer.title,
        buyPrice,
        result.order_id,
        authUser?.privyId,
      );

      // Same post-payment surface as the Stripe redirect, but
      // invoked inline because the SOL flow stays on the page —
      // there's no /api/checkout/success URL to redirect through.
      // Mirrors the effect at lines ~3080-3115 verbatim so the
      // confirmation banner, DUM-points toast, and delayed
      // refreshes all behave the same as a Stripe purchase.
      setCheckoutResult("success");
      if (buyPrice > 0) {
        // Same formula as backend/api/routes/checkout.py
        // process_order_paid: min(50, 10 + floor(amount/5)).
        const points = Math.min(50, 10 + Math.floor(buyPrice / 5));
        setDumPointsEarned(points);
        setTimeout(() => setDumPointsEarned(null), 10000);
      }
      const refreshAfterSolCheckout = () => {
        loadOffers();
        loadSellerOrders();
        window.dispatchEvent(new Event("dum-points-update"));
      };
      setTimeout(refreshAfterSolCheckout, 2000);
      setTimeout(refreshAfterSolCheckout, 5000);

      setBuyStep((p) => ({ ...p, [oid]: "sol_done" }));
    } catch (err) {
      const msg =
        err instanceof SolCheckoutError
          ? err.message
          : err instanceof Error
            ? err.message
            : "SOL payment failed";
      console.error("[sol-pay] ERROR:", msg);
      setBuyStep((p) => ({ ...p, [oid]: "sol_error" }));
      setBuyError((p) => ({ ...p, [oid]: msg }));
    } finally {
      setBuyingOfferId(null);
    }
  }

  async function loadSellerOrders() {
    // Use the canonical project UUID, never the route param `id` — that can
    // be a slug (e.g. /project/topgun-maintenance). The backend
    // /api/checkout/orders/seller/{project_id} looks the project up by its
    // UUID `id`, so passing a slug fails the lookup. That mismatch is the
    // root cause of the "[seller-orders] fetch failed" error on
    // slug-routed project pages; every other fetch here already uses
    // project.id (see handlePinOffer / /api/offers/${project.id}).
    const projectUuid = project?.id;
    if (!projectUuid || !isOwner) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/checkout/orders/seller/${projectUuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // Surface non-OK responses to the console so a future
        // "0 ORDERS" mystery is debuggable from devtools instead of a
        // silent return. The previous version swallowed 403s from the
        // narrow ownership check, which is exactly how this bug
        // (project page showed 0 orders despite 17 in the DB) hid for
        // so long.
        const detail = await res.text().catch(() => "");
        console.error(`[seller-orders] ${res.status} ${detail.slice(0, 200)}`);
        return;
      }
      const data = await res.json();
      setSellerOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("[seller-orders] fetch failed:", err);
      setSellerOrders([]);
    }
  }

  async function updateOrderStatus(orderId: string, status: string, trackingNumber?: string) {
    try {
      const token = await getToken();
      if (!token) return;
      const body: Record<string, string> = { status };
      if (trackingNumber) body.tracking_number = trackingNumber;
      await fetch(`${API_BASE}/api/checkout/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      await loadSellerOrders();
      await loadOffers(); // refresh inventory counts
    } catch (err) { console.error(err); }
  }

  async function refundOrder(orderId: string) {
    if (!window.confirm("Refund this order in full? This returns the buyer's money (including the 1.5% fee) and can't be undone.")) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/checkout/orders/${orderId}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        alert(typeof d?.detail === "string" ? d.detail : "Refund failed. Try again.");
        return;
      }
      await loadSellerOrders();
      await loadOffers();
    } catch (err) {
      console.error(err);
      alert("Refund failed. Try again.");
    }
  }

  // Token-only data fetchers below (market/trades/candles/redemptions).
  // Service-mode projects (Topgun, etc.) have token_status='inactive' and
  // these endpoints legitimately return non-2xx. Silently fall back to
  // empty defaults instead of logging red errors on every page load.

  async function loadMarket() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/market`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setMarket(null);
        return;
      }
      const data = await res.json();
      setMarket(data);
    } catch {
      setMarket(null);
    }
  }

  async function loadTrades() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/trades`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setTrades([]);
        return;
      }
      const data = await res.json();
      setTrades(Array.isArray(data) ? data : []);
    } catch {
      setTrades([]);
    }
  }

  async function loadCandles() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/candles`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setCandles([]);
        return;
      }
      const data = await res.json();
      setCandles(Array.isArray(data) ? data : []);
    } catch {
      setCandles([]);
    }
  }

  async function loadRedemptions() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/redemptions`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setRedemptions([]);
        return;
      }
      const data = await res.json();
      setRedemptions(Array.isArray(data) ? data : []);
    } catch {
      setRedemptions([]);
    }
  }
  
  async function refreshMarketData() {
    await Promise.all([loadMarket(), loadTrades(), loadCandles()]);
  }

  async function loadWalletBalance() {
    if (!id) return;

    const wallet = userWallet?.trim();
    if (!wallet || wallet.length < 8) {
      setWalletBalance(0);
      return;
    }

    // Token-only: only relevant when this project has an active token AND
    // the user has a wallet attached. Non-2xx means "no balance to show",
    // not an error. Silent fallback to 0.
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/balance/${wallet}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        setWalletBalance(0);
        return;
      }

      const data = await res.json();
      setWalletBalance(Number(data?.balance || 0));
    } catch {
      setWalletBalance(0);
    }
  }


  async function handleRedeem() {
    if (!id) return;
  
    const numericAmount = Number(redeemAmount);
  
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setRedeemStatus("Enter a valid amount to redeem.");
      return;
    }

    if (!userWallet?.trim()) {
      setRedeemStatus("Connect your wallet to redeem.");
      return;
    }
  
    if (numericAmount > walletBalance) {
      setRedeemStatus(
        `Insufficient balance. You only have ${formatNumber(walletBalance, 2)} ${
          project?.token_symbol || tokenMeta.symbol || "TOKENS"
        }.`
      );
      return;
    }

    try {
      setLoadingRedeem(true);
      setRedeemStatus("");
      setRedeemCode("");

      const wallet = userWallet.trim();

      const res = await fetch(`${API_BASE}/api/projects/${id}/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          wallet,
          amount: numericAmount,
        }),
      });
  
      const data = await res.json();
  
      if (!res.ok) {
        throw new Error(data?.detail || "Failed to redeem token");
      }
  
      setRedeemCode(data.code || "");
      setRedeemStatus(
        `Redeemed ${formatNumber(numericAmount, 2)} ${
          project?.token_symbol || tokenMeta.symbol || "TOKENS"
        } successfully.`
      );
      setRedeemAmount("");
  
      await loadRedemptions();
      await loadWalletBalance();
    } catch (err: any) {
      console.error(err);
      setRedeemStatus(err?.message || "Failed to redeem token");
    } finally {
      setLoadingRedeem(false);
    }
  }

  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;

    const rating = Math.min(5, Math.max(1, Number(feedbackRating) || 5));
    const comment = feedbackComment.trim();

    const entry: ProjectFeedback = { rating, comment, created_at: new Date().toISOString() };
    const next = [entry, ...feedbackEntries].slice(0, 20);
    setFeedbackEntries(next);
    setFeedbackComment("");
    setFeedbackRating(5);

    // Persist to backend
    setSubmittingReview(true);
    try {
      const token = await getToken();
      if (token) {
        const res = await fetch(`${API_BASE}/api/reviews/`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ project_id: id, rating, comment }),
        });
        if (res.ok) {
          // Refresh backend reviews
          const reviewsRes = await fetch(`${API_BASE}/api/reviews/project/${id}`);
          if (reviewsRes.ok) {
            const data = await reviewsRes.json();
            setBackendReviews(data.reviews || []);
            setBackendAvgRating(data.average_rating || 0);
            setBackendReviewCount(data.count || 0);
          }
        }
      }
    } catch {} finally { setSubmittingReview(false); }
  }

  async function saveMemory(e: React.FormEvent) {
    e.preventDefault();

    if (!memoryText.trim()) return;

    try {
      setLoadingMemory(true);

      const res = await fetch(`${API_BASE}/api/memories/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: id,
          content_text: memoryText.trim(),
          content_type: "text",
        }),
      });

      if (!res.ok) throw new Error("Failed to save memory");

      setMemoryText("");
      await loadMemories();
    } catch (err) {
      console.error(err);
      notify("Failed to save memory", "error");
    } finally {
      setLoadingMemory(false);
    }
  }

  async function askAI(e: React.FormEvent) {
    e.preventDefault();

    if (!question.trim() || !id) return;

    const currentQuestion = question.trim();
    const sessionId = getOrCreateSessionId(id);

    // Automation: capture inquiry event
    captureInquiry(id, currentQuestion, authUser?.privyId);

    try {
      setLoadingAsk(true);
      setResponse("Thinking...");

      const res = await fetch(`${API_BASE}/api/chat/project-gated`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          project_id: id,
          message: currentQuestion,
          session_id: sessionId,
        }),
      });

      if (!res.ok) {
        // Surface the backend's structured detail (PR #363 shape) instead
        // of swallowing every non-2xx into "Failed to get AI response."
        // For a 403 (free-limit hit), also lock the panel + surface
        // contact_email so the mailto CTA renders. For any other non-2xx,
        // render the backend's plain-English message inline. Wire-level
        // failures still fall to the outer catch below.
        const errorData = await res.json().catch(() => null);
        const detail = errorData?.detail;
        const detailObj: GatedErrorDetail | null =
          detail && typeof detail === "object" ? (detail as GatedErrorDetail) : null;
        const detailString = typeof detail === "string" ? detail : null;
        const backendMessage = detailObj?.message || detailString || null;

        if (res.status === 403 && detailObj) {
          // Free-limit hit. Lock the panel, persist limit metadata, surface
          // contact_email + business_name for the mailto CTA. Byte-identical
          // user-visible behavior to PR #363's 403 path.
          const lockCopy =
            backendMessage ||
            "You've used your free question. Send the business a message for more answers.";
          setChatMeta((prev) => ({
            ...prev,
            is_holder: Boolean(detailObj.is_holder),
            free_limit: Number(detailObj.free_limit || prev.free_limit || 1),
            used_count: Number(detailObj.used_count || prev.used_count || 0),
            free_questions_left: Number(detailObj.free_questions_left || 0),
            token_required: Boolean(detailObj.token_required),
            token_mint_address: detailObj.token_mint_address || prev.token_mint_address,
            locked: true,
            lock_message: lockCopy,
            contact_email: detailObj.contact_email || prev.contact_email,
          }));
          setResponse(lockCopy);
          return;
        }

        // Any other non-2xx: render the backend's message inline (preferred),
        // fall back to the generic only when truly nothing structured returned.
        setResponse(backendMessage || "Failed to get AI response.");
        return;
      }

      const data: GatedChatResponse = await res.json();

      setResponse(data.answer || "No response returned.");
      setQuestion("");

      setChatMeta((prev) => ({
        is_holder: Boolean(data.is_holder),
        free_limit: Number(data.free_limit || 1),
        used_count: Number(data.used_count || 0),
        free_questions_left: Number(data.free_questions_left || 0),
        holder_unlimited: Boolean(data.holder_unlimited),
        token_required: Boolean(data.token_required),
        token_mint_address: data.token_mint_address || null,
        locked: false,
        lock_message: "",
        contact_email: data.contact_email ?? prev.contact_email,
      }));
    } catch (err) {
      console.error(err);
      setResponse("Failed to get AI response.");
    } finally {
      setLoadingAsk(false);
    }
  }

  /* ── AI Builder actions ──────────────────────────── */
  type BuilderActionDef = {
    key: string;
    label: string;
    field: string | null;
    group: "project" | "store";
    needsItem?: boolean;
    prompt: (p: Project, items?: StoreItem[], target?: StoreItem | null) => string;
  };

  const storeCtx = (items: StoreItem[]) =>
    items.length
      ? `\n\nExisting store items:\n${items.map((i) => `- ${i.name} (${i.type}, ${i.price}): ${i.description}`).join("\n")}`
      : "\n\nNo store items yet.";

  const builderActions: BuilderActionDef[] = [
    // ── Project Copy ──
    {
      key: "headline",
      label: "Improve Headline",
      field: "title",
      group: "project",
      prompt: (p) =>
        `You are a business branding expert. Improve this business headline to be more compelling, memorable, and clear.\n\nCurrent headline: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nCategory: ${p.template_type || "General"}\n\nReturn ONLY the improved headline text, nothing else. Keep it under 60 characters.`,
    },
    {
      key: "description",
      label: "Improve Description",
      field: "description",
      group: "project",
      prompt: (p) =>
        `You are a business copywriter. Improve this business description to be more engaging, clear, and professional.\n\nCurrent description: "${p.description || "N/A"}"\nBusiness: "${p.title || p.name || "Untitled"}"\nCategory: ${p.template_type || "General"}\nRewards: "${p.token_utility || "N/A"}"\n\nReturn ONLY the improved description text, nothing else. Keep it under 300 characters.`,
    },
    {
      key: "token_utility",
      label: "Improve Rewards & Perks",
      field: "token_utility",
      group: "project",
      prompt: (p) =>
        `You are a business rewards expert. Improve this rewards description to be clearer, more compelling, and specific about customer benefits.\n\nCurrent rewards: "${p.token_utility || "N/A"}"\nBusiness: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\n\nReturn ONLY the improved rewards text, nothing else. Keep it under 250 characters. Focus on customer discounts, loyalty perks, and repeat purchase benefits.`,
    },
    {
      key: "promo",
      label: "Create Promo Copy",
      field: null,
      group: "project",
      prompt: (p) =>
        `You are a business marketing copywriter. Create short, punchy promotional copy for this business that could be used on social media or a landing page.\n\nBusiness: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nRewards: "${p.token_utility || "N/A"}"\nCategory: ${p.template_type || "General"}\n\nReturn 2-3 lines of promotional copy. Be bold and engaging. No hashtags.`,
    },
    {
      key: "roast",
      label: "Roast My Project 🔥",
      field: null,
      group: "project",
      prompt: (p) =>
        `You are a brutally honest business critic known for sharp, useful feedback. Review this business. be honest, pointed, and constructive. Highlight weak spots, vague claims, or missed opportunities. Be helpful but direct.\n\nBusiness: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nRewards: "${p.token_utility || "N/A"}"\nCategory: ${p.template_type || "General"}\n\nKeep it to 3-5 sentences.`,
    },
    // ── Store Intelligence ──
    {
      key: "store_ideas",
      label: "Generate Product Ideas",
      field: null,
      group: "store",
      prompt: (p, items) =>
        `You are a product strategist for local business projects. Generate 2-3 product or service ideas for this project that the owner could sell.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nCategory: ${p.template_type || "General"}${storeCtx(items || [])}\n\nReturn ONLY a valid JSON array of objects with these fields: name, description, price (string like "$29"), type (one of: physical, digital, service, subscription). For subscription type, also include a "benefits" array of 2-3 short strings.\n\nExample: [{"name":"...", "description":"...", "price":"$29", "type":"digital"}]\n\nReturn ONLY the JSON array, no markdown, no explanation.`,
    },
    {
      key: "store_improve_desc",
      label: "Improve Product Description",
      field: null,
      group: "store",
      needsItem: true,
      prompt: (p, _items, target) =>
        `You are a product copywriter. Improve this product description to be more compelling, clear, and conversion-focused.\n\nProject: "${p.title || p.name || "Untitled"}"\nProduct name: "${target?.name || "N/A"}"\nCurrent description: "${target?.description || "N/A"}"\nProduct type: ${target?.type || "N/A"}\nPrice: ${target?.price || "N/A"}\n\nReturn ONLY the improved description text, nothing else. Keep it under 200 characters.`,
    },
    {
      key: "store_pricing",
      label: "Suggest Pricing",
      field: null,
      group: "store",
      needsItem: true,
      prompt: (p, items, target) =>
        `You are a pricing strategist for local business products. Suggest an optimal price for this product.\n\nProject: "${p.title || p.name || "Untitled"}"\nProduct: "${target?.name || "N/A"}"\nDescription: "${target?.description || "N/A"}"\nType: ${target?.type || "N/A"}\nCurrent price: ${target?.price || "N/A"}${storeCtx(items || [])}\n\nReturn ONLY the suggested price as a short string (e.g. "$29" or "$29/month"). Nothing else.`,
    },
    {
      key: "store_subscription",
      label: "Create Subscription Offer",
      field: null,
      group: "store",
      prompt: (p, items) =>
        `You are a subscription product designer for local business projects. Create a subscription offer for this project.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"${storeCtx(items || [])}\n\nReturn ONLY a valid JSON object with these fields: name, description, price (string like "$29/month"), type (must be "subscription"), benefits (array of 3-4 short benefit strings).\n\nExample: {"name":"...", "description":"...", "price":"$29/month", "type":"subscription", "benefits":["...", "..."]}\n\nReturn ONLY the JSON object, no markdown, no explanation.`,
    },
  ];

  function initiateBuilderAction(action: BuilderActionDef) {
    if (action.needsItem && storeItems.length > 0) {
      setStorePickerFor(action.key);
      return;
    }
    if (action.needsItem && storeItems.length === 0) {
      showBuilderToast("Add a store item first");
      return;
    }
    runBuilderAction(action, null);
  }

  async function runBuilderAction(action: BuilderActionDef, targetItem: StoreItem | null) {
    if (!project) return;
    setStorePickerFor(null);
    setStoreTargetItem(targetItem);
    setBuilderAction(action.key);
    setBuilderField(action.field);
    setBuilderLoading(true);
    setBuilderResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: action.prompt(project, storeItems, targetItem),
          project_id: id,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error("AI request failed");
      const data = await res.json();
      const suggested = (data.answer || "").trim();
      const currentVal =
        action.field === "title"
          ? project.title || project.name || ""
          : action.field === "description"
          ? project.description || ""
          : action.field === "token_utility"
          ? project.token_utility || ""
          : targetItem && action.key === "store_improve_desc"
          ? targetItem.description || ""
          : targetItem && action.key === "store_pricing"
          ? targetItem.price || ""
          : "";
      setBuilderResult({ current: currentVal, suggested });
    } catch (err) {
      console.error(err);
      setBuilderResult({ current: "", suggested: "Failed to generate suggestion. Try again." });
    } finally {
      setBuilderLoading(false);
    }
  }

  function showBuilderToast(msg: string) {
    setBuilderToast(msg);
    setTimeout(() => setBuilderToast(null), 3000);
  }

  async function applyBuilderResult() {
    if (!builderResult || !project) return;

    // Promo copy. persist via PATCH
    if (builderAction === "promo") {
      setPromoCopy(builderResult.suggested);
      try {
        await fetch(`${API_BASE}/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ promo_copy: builderResult.suggested }),
        });
      } catch (err) {
        console.error("Failed to persist promo copy:", err);
      }
      showBuilderToast("Promo copy saved. Ready to share.");
      dismissBuilder();
      return;
    }

    // Store: Generate Product Ideas → parse JSON array, add items
    if (builderAction === "store_ideas") {
      try {
        const cleaned = builderResult.suggested.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const newItems: StoreItem[] = (Array.isArray(parsed) ? parsed : [parsed]).map((item: any) => ({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: item.name || "Untitled",
          description: item.description || "",
          price: item.price || "Free",
          type: (["physical", "digital", "service", "subscription"].includes(item.type) ? item.type : "digital") as StoreItemType,
          benefits: Array.isArray(item.benefits) ? item.benefits : [],
        }));
        const nextItems = [...storeItems, ...newItems];
        setStoreItems(nextItems);
        persistStoreItems(nextItems);
        showBuilderToast(`${newItems.length} offer${newItems.length > 1 ? "s" : ""} added to your store`);
      } catch {
        showBuilderToast("Could not parse product ideas. Try regenerating.");
        return;
      }
      dismissBuilder();
      return;
    }

    // Store: Create Subscription Offer → parse JSON object, add item
    if (builderAction === "store_subscription") {
      try {
        const cleaned = builderResult.suggested.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        const item = JSON.parse(cleaned);
        const newItem: StoreItem = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: item.name || "Subscription",
          description: item.description || "",
          price: item.price || "Free",
          type: "subscription",
          benefits: Array.isArray(item.benefits) ? item.benefits : [],
        };
        const nextItems = [...storeItems, newItem];
        setStoreItems(nextItems);
        persistStoreItems(nextItems);
        showBuilderToast("Subscription offer added");
      } catch {
        showBuilderToast("Could not parse subscription. Try regenerating.");
        return;
      }
      dismissBuilder();
      return;
    }

    // Store: Improve Product Description → update target item
    if (builderAction === "store_improve_desc" && storeTargetItem) {
      const nextItems = storeItems.map((i) =>
        i.id === storeTargetItem.id ? { ...i, description: builderResult.suggested } : i
      );
      setStoreItems(nextItems);
      persistStoreItems(nextItems);
      showBuilderToast("Product description updated");
      dismissBuilder();
      return;
    }

    // Store: Suggest Pricing → update target item price
    if (builderAction === "store_pricing" && storeTargetItem) {
      const nextItems = storeItems.map((i) =>
        i.id === storeTargetItem.id ? { ...i, price: builderResult.suggested } : i
      );
      setStoreItems(nextItems);
      persistStoreItems(nextItems);
      showBuilderToast("Pricing updated");
      dismissBuilder();
      return;
    }

    // Standard project field update
    if (!builderField) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [builderField]: builderResult.suggested }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProject(updated);
        setProjectName(updated.name || updated.title || "DUM Club Business");
        showBuilderToast("Updated. Your project just got stronger.");
      }
    } catch (err) {
      console.error("Failed to apply:", err);
    }
    dismissBuilder();
  }

  function dismissBuilder() {
    setBuilderAction(null);
    setBuilderResult(null);
    setBuilderField(null);
    setBuilderLoading(false);
    setStoreTargetItem(null);
    setStorePickerFor(null);
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      showBuilderToast(`Copied ${label} to clipboard`);
    } catch {
      showBuilderToast("Failed to copy");
    }
  }

  function togglePitchMode() {
    const next = !pitchMode;
    setPitchMode(next);
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set("view", "pitch");
    } else {
      url.searchParams.delete("view");
    }
    window.history.replaceState({}, "", url.toString());
  }

  /* ── Live Commerce ────────────────────────────────── */
  // The native_mux / camera-relay Go Live flow (startCameraPreview,
  // startLiveFromCamera, the MediaRecorder->WebSocket->ffmpeg relay,
  // and handleGoLive) was removed with the Mux isolation: IVS
  // Real-Time is the only live provider (13/13 prod sessions).
  // handleEndLive stays: it ends any non-IVS session (manual_embed)
  // and is the End Stream control in the legacy panel below.

  async function handleEndLive() {
    if (!id) return;

    try {
      await fetch(`${API_BASE}/api/projects/${id}/end-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
      });
      setProject((prev) => prev ? {
        ...prev, is_live: false, stream_url: null, pinned_offer_id: null,
        live_provider: null, live_playback_id: null,
      } : prev);
    } catch (err) {
      console.error("End live failed", err);
    }
  }

  async function handlePinOffer(offerId: string | null) {
    // Debounce concurrent clicks: a pin request is already in flight, so
    // ignore further clicks until it settles. Not all call sites disable
    // their button, so this is the canonical guard against racing PATCHes
    // (last-write-wins on the backend, which has no optimistic lock).
    if (pinningOfferId !== null) return;
    // Backend matches projects by UUID, not slug. The URL param `id`
    // can be either (e.g. /project/topgun-maintenance is a slug),
    // so we must call with project.id. same canonical-UUID
    // convention /api/offers/${project.id} uses (line ~944).
    const projectUuid = project?.id;
    if (!projectUuid) {
      setPinError("Project not loaded yet. Try again in a moment.");
      return;
    }
    setPinError(null);
    setPinningOfferId(offerId ?? "__unpin__");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectUuid}/pin-offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        // duration_minutes drives the viewer-facing urgency countdown.
        // Only sent when pinning (offerId set); unpin clears it backend-side.
        body: JSON.stringify({
          offer_id: offerId,
          duration_minutes: offerId ? pinDurationMinutes : null,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errorText(errBody.detail, `Pin failed (HTTP ${res.status})`);
        setPinError(msg);
        return;
      }
      // Trust the backend response: it echoes pinned_offer_id so we
      // can sync local state to canonical truth instead of guessing.
      const data = await res.json().catch(() => ({}));
      const persisted =
        typeof data?.pinned_offer_id !== "undefined"
          ? data.pinned_offer_id
          : offerId;
      setProject((prev) => prev ? { ...prev, pinned_offer_id: persisted } : prev);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pin offer failed";
      console.error("Pin offer failed", err);
      setPinError(msg);
    } finally {
      setPinningOfferId(null);
    }
  }

  const pinnedOffer = offers.find((o) => o.id === project?.pinned_offer_id) || null;
  // Show the immersive live room for non-owner visitors of a live IVS shop
  // (same gate as the inline IVS viewer), until they dismiss it.
  const immersiveLive =
    !!project?.is_live &&
    isIVSSession(project) &&
    !!project?.ivs_stage_arn &&
    !isOwner &&
    !immersiveDismissed;
  const auctionOffer = auction ? offers.find((o) => o.id === auction.offer_id) || null : null;
  const isAuctionActive = auction?.status === "active";
  const isAuctionWinner = auction?.status === "ended" && auction.current_bidder === authUser?.privyId;

  /* ── Auction Functions ────────────────────────────── */
  async function loadAuction() {
    if (!project?.active_auction_id) { setAuction(null); return; }
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${project.active_auction_id}`);
      if (res.ok) {
        const data = await res.json();
        setAuction(data);
      }
    } catch { setAuction(null); }
  }

  useEffect(() => { loadAuction(); }, [project?.active_auction_id]);

  // Fire the timer-expiry auto-close at most once per auction per tab.
  // The backend has no server-side expiry close, so the client countdown
  // is what closes a timed-out auction. Without this guard the 1s tick
  // re-POSTed /close every second (from every viewer's tab) between
  // expiry and the 3s poll flipping status to "ended" — a burst of
  // redundant requests for a single close.
  const autoCloseFiredRef = useRef<string | null>(null);

  // Countdown timer
  useEffect(() => {
    if (!auction || auction.status !== "active") { setAuctionCountdown(""); return; }
    function tick() {
      const now = Date.now();
      const end = new Date(auction!.ends_at).getTime();
      const diff = Math.max(0, end - now);
      if (diff <= 0) {
        setAuctionCountdown("0:00");
        // Auto-close when the timer hits zero — once per auction per tab.
        if (autoCloseFiredRef.current !== auction!.id) {
          autoCloseFiredRef.current = auction!.id;
          fetch(`${API_BASE}/api/auctions/${auction!.id}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
          }).then(() => loadAuction()).catch(() => {});
        }
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setAuctionCountdown(`${m}:${s.toString().padStart(2, "0")}`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [auction?.id, auction?.status, auction?.ends_at]);

  // "Live for H:MM" banner timer. Elapsed since project.live_started_at
  // (migration 084), recomputed every second. live_started_at can arrive
  // space-separated with a 2-digit offset from PostgREST, so normalize to
  // ISO 8601 before Date.parse (same care as the pin countdown) or strict
  // engines read it as NaN. No live_started_at (pre-084 stream) clears the
  // label so the banner renders exactly as before.
  useEffect(() => {
    if (!project?.is_live || !project?.live_started_at) { setLiveFor(null); return; }
    const iso = project.live_started_at
      .replace(" ", "T")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})$/, "$1:00");
    const startMs = Date.parse(iso);
    if (Number.isNaN(startMs)) { setLiveFor(null); return; }
    function tick() {
      const mins = Math.max(0, Math.floor((Date.now() - startMs) / 60000));
      setLiveFor(`${Math.floor(mins / 60)}:${(mins % 60).toString().padStart(2, "0")}`);
    }
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [project?.is_live, project?.live_started_at]);

  // Poll auction state every 3 seconds while active
  useEffect(() => {
    if (!auction || auction.status !== "active") return;
    const iv = setInterval(loadAuction, 3000);
    return () => clearInterval(iv);
  }, [auction?.id, auction?.status]);

  async function handleStartAuction() {
    if (!id || !auctionOfferSelect || !auctionStartPrice) return;
    setAuctionStarting(true);
    try {
      const res = await fetch(`${API_BASE}/api/auctions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        body: JSON.stringify({
          project_id: id,
          offer_id: auctionOfferSelect,
          starting_price: Number(auctionStartPrice),
          duration_seconds: auctionDuration,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuction(data.auction);
        setProject((prev) => prev ? { ...prev, active_auction_id: data.auction.id, pinned_offer_id: data.auction.offer_id } : prev);
        if (id) {
          broadcastLiveEvent(id, {
            user: "System",
            text: `Auction started: ${data.offer_title}. starting at $${Number(auctionStartPrice).toFixed(0)} (${Math.floor(auctionDuration / 60)}:${(auctionDuration % 60).toString().padStart(2, "0")})`,
            type: "system",
          });
        }
      }
    } catch (err) { console.error("Start auction failed", err); }
    finally { setAuctionStarting(false); }
  }

  async function handlePlaceBid() {
    if (!auction || !auctionBidAmount) return;
    setAuctionBidding(true);
    setAuctionBidError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${auction.id}/bid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        body: JSON.stringify({ amount: Number(auctionBidAmount) }),
      });
      if (res.ok) {
        const data = await res.json();
        const bidAmount = Number(auctionBidAmount);
        setAuction(data.auction);
        setAuctionBidAmount("");
        if (id) {
          broadcastLiveEvent(id, {
            user: data.your_display_name,
            text: `placed a bid: $${bidAmount.toFixed(0)}`,
            type: "purchase",
          });
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setAuctionBidError(errorText(err.detail, "Bid failed"));
      }
    } catch { setAuctionBidError("Network error"); }
    finally { setAuctionBidding(false); }
  }

  async function handleCloseAuction(force: boolean) {
    if (!auction) return;
    try {
      const res = await fetch(`${API_BASE}/api/auctions/${auction.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        body: JSON.stringify({ force }),
      });
      if (res.ok) {
        const data = await res.json();
        loadAuction();
        setProject((prev) => prev ? { ...prev, active_auction_id: null } : prev);
        if (id) {
          const msg = data.winner_display
            ? `Auction ended! ${data.winner_display} wins. $${Number(data.winning_bid).toFixed(0)}`
            : "Auction ended. No bids.";
          broadcastLiveEvent(id, { user: "System", text: msg, type: "system" });
        }
      }
    } catch (err) { console.error("Close auction failed", err); }
  }

  async function handleAuctionPayNow() {
    if (!auction || !auctionOffer) return;
    // Demo mode: simulate payment
    if (isDemo) {
      const price = Number(auction.current_bid || 0);
      setSimulatedPurchase(auctionOffer.title);
      setSimulatedRevenue((prev) => prev + price);
      setSimPurchaseCount((prev) => prev + 1);
      setCheckoutResult("success");
      setLiveSalesCount((c) => c + 1);
      const pts = Number(localStorage.getItem("dum_points") || "0");
      localStorage.setItem("dum_points", String(pts + 10));
      window.dispatchEvent(new Event("dum-points-update"));
      // Update auction status locally
      setAuction((prev) => prev ? { ...prev, status: "paid" } : prev);
      if (id) {
        broadcastLiveEvent(id, {
          user: auction.current_bidder_display || "Winner",
          text: `purchased ${auctionOffer.title} for $${price.toFixed(0)}. +10 DUM`,
          type: "purchase",
        });
        broadcastLiveEvent(id, {
          user: "System",
          text: `${auction.current_bidder_display || "Winner"} earned +10 DUM Points`,
          type: "reward",
        });
      }
      setTimeout(() => setSimulatedPurchase(null), 6000);
      return;
    }
    // Real Stripe path. pass auction_id and override_price
    buyOffer(auctionOffer, auction.id, Number(auction.current_bid));
  }

  /* ── Project Score ────────────────────────────────── */
  async function evaluateProjectScore() {
    if (!project) return;
    setScoreLoading(true);
    setProjectScore(null);
    const storeSummary = storeItems.length
      ? storeItems.map((i) => `${i.name} (${i.type}, ${i.price})`).join(", ")
      : "none";
    const prompt = `You are a startup scoring engine. Evaluate this project on 3 dimensions and return ONLY a valid JSON object.\n\nProject: "${project.title || project.name || "Untitled"}"\nDescription: "${project.description || "N/A"}"\nToken: ${project.token_symbol || "N/A"}\nToken utility: "${project.token_utility || "N/A"}"\nPromo copy: "${promoCopy || "N/A"}"\nStore items: ${storeSummary}\nCategory: ${project.template_type || "General"}\n\nScore each dimension 0-100:\n1. Virality. how shareable and attention-grabbing is this project?\n2. Trust. how credible and professional does it appear?\n3. Utility. how useful and valuable is the token/product offering?\n\nReturn ONLY this JSON:\n{"virality":{"score":N,"reason":"..."},"trust":{"score":N,"reason":"..."},"utility":{"score":N,"reason":"..."}}\n\nKeep each reason under 80 characters. Be honest and specific. No markdown.`;
    try {
      const res = await fetch(`${API_BASE}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, project_id: id, stream: false }),
      });
      if (!res.ok) throw new Error("Score request failed");
      const data = await res.json();
      const cleaned = (data.answer || "").replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      setProjectScore({
        virality: { score: Number(parsed.virality?.score || 0), reason: parsed.virality?.reason || "" },
        trust: { score: Number(parsed.trust?.score || 0), reason: parsed.trust?.reason || "" },
        utility: { score: Number(parsed.utility?.score || 0), reason: parsed.utility?.reason || "" },
      });
    } catch (err) {
      console.error("Score evaluation failed:", err);
      showBuilderToast("Failed to evaluate. Try again.");
    } finally {
      setScoreLoading(false);
    }
  }

  function scoreColor(score: number): string {
    if (score >= 75) return "text-brand-teal";
    if (score >= 50) return "text-amber-400";
    return "text-state-live";
  }

  function barColor(score: number): string {
    if (score >= 75) return "bg-brand-teal";
    if (score >= 50) return "bg-amber-400";
    return "bg-red-400";
  }

  /* ── Store / Offers helpers ─────────────────────── */
  // Publish / unpublish the storefront. Flips projects.status
  // draft <-> live through the owner-gated endpoints, which is what
  // lists the store on Discover and moves the Store Status card into
  // the published state. Deliberately independent of going live: a
  // store can be published with the stream off.
  async function togglePublish() {
    if (!project || !id || publishing) return;
    const publish = project.status !== "live";
    setPublishing(true);
    setPublishError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${id}/${publish ? "publish" : "unpublish"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            user_id: authUser?.privyId || "",
          },
        },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setPublishError(errorText(errData.detail, "Could not update your store. Try again."));
        return;
      }
      setProject((prev) => (prev ? { ...prev, status: publish ? "live" : "draft" } : prev));
    } catch {
      setPublishError("Could not reach the server. Try again.");
    } finally {
      setPublishing(false);
    }
  }

  function persistStoreItems(items: StoreItem[]) {
    // Fire-and-forget. Silent catch so a network blip during nav
    // doesn't pollute the buyer / merchant console with a noisy
    // "Failed to fetch". Real persistence failures still surface
    // via subsequent reads of the project payload.
    fetch(`${API_BASE}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_items: items }),
    }).catch(() => {});
  }

  function openStoreForm(item?: StoreItem) {
    setStoreEditing(
      item || { id: "", name: "", description: "", price: "", type: "digital", benefits: [] }
    );
    setStoreFormOpen(true);
  }

  function saveStoreItem() {
    if (!storeEditing || !storeEditing.name.trim()) return;
    let nextItems: StoreItem[];
    if (storeEditing.id) {
      nextItems = storeItems.map((i) => (i.id === storeEditing.id ? storeEditing : i));
    } else {
      nextItems = [...storeItems, { ...storeEditing, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }];
    }
    setStoreItems(nextItems);
    persistStoreItems(nextItems);
    setStoreFormOpen(false);
    setStoreEditing(null);
    showBuilderToast("Offer saved");
  }

  function removeStoreItem(itemId: string) {
    const nextItems = storeItems.filter((i) => i.id !== itemId);
    setStoreItems(nextItems);
    persistStoreItems(nextItems);
    showBuilderToast("Offer removed");
  }

  const storeTypeBadge: Record<StoreItemType, { label: string; color: string }> = {
    physical: { label: "Physical", color: "border-amber-400/30 text-amber-400" },
    digital: { label: "Digital", color: "border-sky-400/30 text-sky-400" },
    service: { label: "Service", color: "border-purple-400/30 text-purple-400" },
    subscription: { label: "Subscription", color: "border-default text-brand-teal" },
  };

  // The merchant-facing "Submit for Review" flow was removed — review
  // never published a store and only confused new merchants. Publishing
  // and going live happen through the offer + Go Live flows on this page.

  async function approveProject() {
    try {
      setLoadingAction(true);
  
      const res = await fetch(`${API_BASE}/api/projects/${id}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          starting_price: 0.01,
          market_cap: 1000,
        }),
      });
  
      const data = await res.json();
  
      if (!res.ok) {
        throw new Error(data.detail || "Failed to approve project");
      }
  
      await loadProject();
      await loadTokenMetadata();
      notify("Project approved.", "success");
    } catch (err: any) {
      console.error(err);
      notify(err.message || "Failed to approve project", "error");
    } finally {
      setLoadingAction(false);
    }
  }

  async function rejectProject() {
    try {
      setLoadingAction(true);

      const res = await fetch(`${API_BASE}/api/projects/${id}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: "Rejected from project detail page",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to reject project");
      }

      await loadProject();
      await loadTokenMetadata();
      notify("Project rejected.", "success");
    } catch (err: any) {
      console.error(err);
      notify(err.message || "Failed to reject project", "error");
    } finally {
      setLoadingAction(false);
    }
  }

  async function createToken() {
    setActionMessage(null);
    try {
      setLoadingAction(true);

      const res = await fetch(`${API_BASE}/api/projects/${id}/create-token`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to create token");
      }

      await loadProject();
      await loadTokenMetadata();
      setActionIsError(false);
      setActionMessage(`Token created. mint: ${data.mint}`);
    } catch (err: any) {
      console.error(err);
      setActionIsError(true);
      setActionMessage(err.message || "Failed to create token");
    } finally {
      setLoadingAction(false);
    }
  }

  async function advanceTokenStatus() {
    try {
      setLoadingAction(true);

      const res = await fetch(`${API_BASE}/api/projects/${id}/advance-token-status`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to advance token status");
      }

      await loadProject();
      await loadTokenMetadata();
      setActionIsError(false);
      setActionMessage(`Status advanced to: ${data.token_status}`);
    } catch (err: any) {
      console.error(err);
      setActionIsError(true);
      setActionMessage(err.message || "Failed to advance token status");
    } finally {
      setLoadingAction(false);
    }
  }

  useEffect(() => {
    loadProject();
    loadTokenMetadata();
    refreshMarketData();
    loadRedemptions();
  }, [id]);

  // Offers and memories are keyed by project UUID, not the URL param.
  // When the URL param is a slug (e.g. "topgun-maintenance") we can't
  // fetch these until loadProject() has resolved the real UUID. Fire
  // this effect on project?.id so they run as soon as the project
  // lands and re-run if the user navigates between projects.
  useEffect(() => {
    if (!project?.id) return;
    loadMemories();
    loadOffers();
    // Drive Your Market Analytics. fires once per project load.
    trackEvent("project_view", { project_id: project.id });
  }, [project?.id]);

  // ── Viewer fast-poll while watching a live stream ─────────────────────
  // When a project is_live and the current user is NOT the owner, poll
  // project state + offers every 3 seconds so that pinned-offer changes,
  // new offers, and inventory updates appear within a few seconds of the
  // host making them. The owner already sees local state updates instantly
  // on pin/unpin, and we deliberately don't run this on the owner side
  // because the full load path would wipe their in-progress UI.
  //
  // Skips when the tab is hidden (document.visibilityState === "hidden")
  // so we're not burning requests in background tabs.
  // Viewer-side polling loop. Runs in BOTH states (offline + live) so a
  // viewer who landed on the page before the host went live still sees
  // the LIVE transition without manually refreshing — the previous
  // `if (!project?.is_live) return;` gate meant any tab opened first
  // was permanently stale until reload. Adaptive cadence keeps the
  // offline-state load light:
  //   - is_live = true  -> 3s  (live state can change fast; keep tight)
  //   - is_live = false -> 15s (catches go-live within 15s for an
  //                              already-open tab; ~4 req/min/tab, fine
  //                              at scale and pauses on hidden tabs)
  // Skipped entirely for owners — they have their own state from
  // IVSStageHost callbacks and don't need to poll.
  useEffect(() => {
    if (!id) return;
    if (isOwner) return;

    let cancelled = false;
    const intervalMs = project?.is_live ? 3000 : 15000;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      await refreshLiveStateForViewer();
      if (cancelled) return;
      // Offers don't change while offline — only refetch when live.
      if (project?.is_live) loadOffers();
    };

    // Run once immediately so the viewer doesn't wait for the first interval.
    tick();
    const iv = setInterval(tick, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project?.is_live, isOwner]);

  // Audit #4 Phase 1 (Q11). detect a true → false transition on
  // is_live during this page session and surface a temporary
  // "Show ended" banner with the live-show recap (sale count
  // captured from liveSalesCount before it resets). Auto-dismisses
  // after 30s. Only fires on real transitions; first-load with
  // is_live=false does nothing.
  const lastIsLiveRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const next = project?.is_live;
    const prev = lastIsLiveRef.current;
    lastIsLiveRef.current = next;
    if (prev === true && next === false) {
      setStreamEndedSummary({ sales: liveSalesCount });
      setStreamJustEnded(true);
      const t = setTimeout(() => setStreamJustEnded(false), 30000);
      return () => clearTimeout(t);
    }
  }, [project?.is_live, liveSalesCount]);

  // Scroll to recommended offer when arriving from homepage
  useEffect(() => {
    if (!recommendedOffer || !offers.length || recommendedScrolled.current) return;
    const match = offers.find((o) => o.title === recommendedOffer);
    if (!match) return;
    recommendedScrolled.current = true;
    setTimeout(() => {
      const el = document.getElementById(`offer-${match.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [recommendedOffer, offers]);

  // Hydrate the merchant brand profile (logo / cover / verification).
  //
  // Primary path: the GET /api/projects/{id} response embeds
  // business_profile via the projects.business_profile_id FK (mig 014).
  // That row is the canonical link — the seeded merchant logo URL lives
  // on it. Reading from the embed avoids the legacy bug where the
  // by-owner lookup missed the linked row whenever its owner_privy_id
  // didn't match the project's privy_id (the case the storefront-visual
  // P3 follow-up was filed for: Topgun's seeded logo never displayed).
  //
  // Fallback path: the by-owner lookup still runs for projects WITHOUT
  // an embedded profile (business_profile_id NULL, or the linked row
  // has no usable fields). Preserves backwards-compat for legacy
  // projects whose merchant brand is only reachable via owner_privy_id.
  useEffect(() => {
    const embed = project?.business_profile;
    if (
      embed &&
      (embed.logo_url ||
        embed.cover_image_url ||
        embed.verification_status ||
        embed.business_name)
    ) {
      setOwnerBizProfile({
        logo_url: embed.logo_url ?? null,
        cover_image_url: embed.cover_image_url ?? null,
        verification_status: embed.verification_status ?? undefined,
        business_name: embed.business_name ?? undefined,
      });
      return;
    }
    const ownerPrivyId = project?.privy_id || project?.owner_id;
    if (!ownerPrivyId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/business/by-owner/${encodeURIComponent(ownerPrivyId)}`);
        if (res.ok) {
          const data = await res.json();
          setOwnerBizProfile(data.profile || null);
        }
      } catch {}
    })();
  }, [project?.business_profile, project?.privy_id, project?.owner_id]);

  // Hero-avatar logo source with broken-image recovery. Mirrors
  // ownerBizProfile.logo_url on load, resets back to null on <img>
  // onError below. Decoupling the rendered src from the profile field
  // means a 404 or decode failure flips us back to the emoji avatar
  // without losing the rest of the merchant brand. The reset effect
  // refires when the source URL changes so navigating between
  // projects can't pin a prior failure on the next storefront.
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  useEffect(() => {
    const next = cleanLogoUrl(ownerBizProfile?.logo_url);
    setLogoSrc(next);
  }, [ownerBizProfile?.logo_url]);

  useEffect(() => {
    if (!project) {
      setIsOwner(false);
      return;
    }
    const privyMatch = Boolean(authUser?.privyId && project.privy_id && authUser.privyId === project.privy_id);
    const walletMatch = Boolean(authUser?.walletAddress && project.wallet_address && authUser.walletAddress === project.wallet_address);
    setIsOwner(privyMatch || walletMatch);
  }, [project?.owner_id, project?.privy_id, project?.wallet_address, project?.id, authUser?.privyId, authUser?.walletAddress]);

  useEffect(() => {
    if (isOwner && id) loadSellerOrders();
  }, [isOwner, id]);

  // Gate banner to launch arrivals only (?launched=1 from /build redirect).
  // Also detect ?view=pitch for shareable presentation mode.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("launched") === "1") setShowLiveBanner(true);
    if (params.get("view") === "pitch") setPitchMode(true);
    if (params.get("offer")) {
      setRecommendedOffer(decodeURIComponent(params.get("offer")!));
      setRecommendedReason(params.get("reason") || "");
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("offer");
      cleanUrl.searchParams.delete("reason");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
    if (params.get("checkout") === "success") {
      setCheckoutResult("success");

      // Compute and show DUM Points earned in live flow
      const savedPrice = sessionStorage.getItem("liveLastBuyPrice");
      if (savedPrice) {
        const price = Number(savedPrice);
        sessionStorage.removeItem("liveLastBuyPrice");
        if (price > 0) {
          // NOTE: This formula mirrors backend webhook
          // logic in backend/api/routes/checkout.py
          // min(50, 10 + floor(amount/5))
          // If backend formula changes update this too
          const points = Math.min(50, 10 + Math.floor(price / 5));
          setDumPointsEarned(points);
          setTimeout(() => setDumPointsEarned(null), 10000);
        }
      }

      // Refresh offers after webhook processes (may take a few seconds)
      // Note: loadSellerOrders is also triggered by the isOwner effect, so always safe to call loadOffers here
      const refreshAfterCheckout = () => {
        loadOffers();
        loadSellerOrders();
        // Trigger DUM balance refresh across the app
        window.dispatchEvent(new Event("dum-points-update"));
      };
      setTimeout(refreshAfterCheckout, 2000);
      setTimeout(refreshAfterCheckout, 5000);
      setTimeout(refreshAfterCheckout, 10000);
      // Clean up checkout param from URL to prevent stale state on repeat visits/purchases
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("checkout");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
    if (params.get("checkout") === "cancelled") {
      setCheckoutResult("cancelled");
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("checkout");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
    // viewAsCustomer=1 — entry point for the dashboard "Preview as
    // customer" link. Writes the per-slug sessionStorage flag the
    // AdminBar already reads, then strips the param so a refresh
    // doesn't re-toggle. Owner can exit via ExitCustomerViewChip.
    if (params.get("viewAsCustomer") === "1" && id) {
      writeViewAsCustomer(id, true);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("viewAsCustomer");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
    // ?golive=1 is intentionally NOT handled here — see the dedicated
    // deep-link effect below, which also fires on a same-path
    // (query-only) navigation that this mount-only reader would miss.
  }, []);

  // Deep-link "Go Live": the navbar CTA points at
  // /project/{id}?golive=1. The mount-only param reader above can't
  // catch the common case where the owner is ALREADY on this project
  // page — that click is a same-path, query-only navigation that never
  // remounts the page, so the button looked dead. App Router still
  // re-renders the route on that navigation, so this dep-less effect
  // (guarded by a ref so it acts once per occurrence) handles both a
  // fresh load and a same-path nav: it arms the IVS host panel and
  // scrolls to it, exactly like the in-page Store Status "Go Live"
  // button, then strips the param.
  const goLiveDeepLinkHandled = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const wantsGoLive =
      new URLSearchParams(window.location.search).get("golive") === "1";
    if (!wantsGoLive) {
      // Reset so a later ?golive=1 navigation is handled again.
      goLiveDeepLinkHandled.current = false;
      return;
    }
    if (goLiveDeepLinkHandled.current) return;
    // Arm the host the moment the deep-link is seen (idempotent — a
    // repeat setAutoGoLive(true) is a no-op).
    if (IVS_REALTIME_ENABLED) setAutoGoLive(true);
    // Wait for the owner host panel to mount before scrolling and
    // stripping the param, so a fresh load (isOwner still resolving)
    // still lands on the panel instead of cleaning the URL too early.
    if (!document.getElementById("project-live-host")) return;
    goLiveDeepLinkHandled.current = true;
    scrollToSection("project-live-host");
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("golive");
    window.history.replaceState({}, "", cleanUrl.toString());
  });

  // Auto-dismiss 8s after isOwner resolves (only fires if banner was shown).
  useEffect(() => {
    if (!isOwner || !showLiveBanner) return;
    const t = window.setTimeout(() => setShowLiveBanner(false), 8000);
    return () => clearTimeout(t);
  }, [isOwner, showLiveBanner]);

  useEffect(() => {
    // authUser.walletAddress is the canonical source via AuthContext,
    // which itself computes `linkedWallets[0] || embeddedWallet` from
    // useSolanaWallets(). The previous `?? wallets[0]?.address` fallback
    // was a same-source duplicate that pinned a hard reference to
    // useSolanaWallets here, defeating the lazy-Solana-subtree split.
    const addr = authUser?.walletAddress ?? null;
    setUserWallet(addr);
  }, [authUser]);

  useEffect(() => {
    const ts = normalizeTokenLifecycleStatus(tokenMeta.status || project?.token_status);
    if (!id || ts !== "trading_live") return;

    const interval = setInterval(() => {
      refreshMarketData();
    }, 10000);

    return () => clearInterval(interval);
  }, [id, tokenMeta.status, project?.token_status]);

  useEffect(() => {
    if (!id || !userWallet) {
      setWalletBalance(0);
      return;
    }

    loadWalletBalance();
  }, [id, userWallet]);

  // Lightbox: close on ESC
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightboxUrl(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem(`project-feedback:${id}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setFeedbackEntries(parsed);
      }
    } catch {
      setFeedbackEntries([]);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    localStorage.setItem(`project-feedback:${id}`, JSON.stringify(feedbackEntries));
  }, [id, feedbackEntries]);

  // Close share menu on outside click
  useEffect(() => {
    if (!shareMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [shareMenuOpen]);

  // Load backend reviews
  useEffect(() => {
    if (!id) return;
    fetch(`${API_BASE}/api/reviews/project/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setBackendReviews(data.reviews || []);
          setBackendAvgRating(data.average_rating || 0);
          setBackendReviewCount(data.count || 0);
        }
      })
      .catch(() => {});
  }, [id]);

  // Load favorite status. Split into two effects on purpose: the PUBLIC
  // count is auth-independent, so it does NOT refetch when the auth object
  // hydrates (null -> user). The auth-only "did I favorite this" check is
  // keyed on the stable privyId rather than the authUser object reference.
  //
  // Both use the canonical project UUID (project.id), never the route param
  // `id` — that can be a slug (e.g. /project/topgun-maintenance), and the
  // favorites table is keyed by the UUID. Passing a slug made Postgres raise
  // 22P02; the routes swallowed it and returned count 0, so favorites
  // silently never worked on slug-routed storefronts. project.id is the same
  // convention every other fetch on this page already uses.
  useEffect(() => {
    if (!project?.id) return;
    fetch(`${API_BASE}/api/favorites/count/${project.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFavoriteCount(data.count || 0); })
      .catch(() => {});
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id || !authUser) return;
    // Outer .catch covers getToken() itself rejecting (Privy not
    // ready, token refresh failure). The inner fetch is already
    // guarded; without this, a getToken rejection during nav or in
    // the fresh-deploy window surfaced as an uncaught console error
    // attributed to project/[id]/page.js.
    getToken()
      .then((token) => {
        if (!token) return;
        fetch(`${API_BASE}/api/favorites/check/${project.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => { if (data) setIsFavorited(data.favorited); })
          .catch(() => {});
      })
      .catch(() => {});
  }, [project?.id, authUser?.privyId]);

  // Toggle favorite
  async function toggleFavorite() {
    if (!authUser) { login(); return; }
    // Favorites are keyed by the canonical project UUID, never the route
    // param `id` (which may be a slug). See the count/check effects above.
    const projectUuid = project?.id;
    if (!projectUuid) return;
    setTogglingFavorite(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/favorites/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectUuid }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsFavorited(data.favorited);
        setFavoriteCount((c) => data.favorited ? c + 1 : Math.max(0, c - 1));
        // Following a business should also opt the customer into a
        // go-live alert. Favorites are keyed by Privy id (no email), so
        // when we know the signed-in viewer's email, register a general
        // live-reminder subscription. Best-effort + fire-and-forget: a
        // failure (or no email on file) never blocks favoriting, and the
        // endpoint dedupes repeat taps.
        if (data.favorited && authUser?.email) {
          fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/live-reminders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: authUser.email }),
          }).catch(() => {});
        }
      }
    } catch {} finally { setTogglingFavorite(false); }
  }

  const reviewStatus = projectStatus || "draft";
  const tokenStatus = normalizeTokenLifecycleStatus(
    tokenMeta.status || project?.token_status
  );
  const isSubmitted = reviewStatus === "submitted";
  const isRejected = reviewStatus === "rejected";
  const isPending = reviewStatus === "pending";
  const isApprovedProject = reviewStatus === "approved";
  const isTradingLive = tokenStatus === "trading_live";
  // false used to gate the per-project trading UI; DUM Hub
  // replaced it months ago and the const has been a hard `false` ever
  // since. Step B of the ghost-architecture cleanup deletes the const
  // and inlines `false` at every reader site so the dead branches are
  // self-documenting at the call site. Step C deletes the dead JSX.

  const emoji = useMemo(() => getProjectEmoji(project), [project]);
  const category = useMemo(() => getCategory(project), [project]);
  // categoryLabel is the SOURCE-OF-TRUTH human label for the badge:
  // prefer the canonical seeded category_id (migration 035), fall back
  // to the legacy keyword-classifier (getCategory above) for storefronts
  // with NULL category_id. Resolves the "BUSINESS · BUSINESS" dead-end
  // for projects whose title/template_type don't match the old narrow
  // regex (e.g. Topgun, which the keyword path dead-ended on).
  const categoryLabel = useMemo(() => resolveCategoryLabel(project), [project]);
  const accent = useMemo(() => getAccent(project), [project]);
  const parsedAiOutput = useMemo(() => parseAiOutput(project?.ai_output), [project?.ai_output]);

  const tokenStage = getTokenStageIndex(tokenStatus);
  const tokenStages = ["Draft", "Mint Created", "Tokens Minted", "Liquidity Added", "Trading Live"];
  const latestCandle = candles.length ? candles[candles.length - 1] : null;

  const filteredCandles = useMemo(() => {
    if (!candles.length || chartRange === "ALL") return candles;

    const latestTime = new Date(candles[candles.length - 1].bucket_time).getTime();
    const cutoff = latestTime - getRangeMs(chartRange);

    return candles.filter((c) => new Date(c.bucket_time).getTime() >= cutoff);
  }, [candles, chartRange]);

  const chartData = useMemo(() => {
  const useCandles = filteredCandles.length ? filteredCandles : candles;

  return useCandles.map((c) => ({
    time:
      chartRange === "1H"
        ? new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(c.bucket_time))
        : new Intl.DateTimeFormat("en-US", {
            month: "numeric",
            day: "numeric",
          }).format(new Date(c.bucket_time)),

    fullTime: c.bucket_time,
    price: c.close,
    volume: c.volume,
  }));
}, [filteredCandles, candles, chartRange]);

  const selectedLatestCandle = filteredCandles.length
    ? filteredCandles[filteredCandles.length - 1]
    : latestCandle;

  const rangeChangePct = useMemo(() => {
    if (!filteredCandles.length) return 0;
    const first = filteredCandles[0]?.open ?? filteredCandles[0]?.close ?? 0;
    const last = filteredCandles[filteredCandles.length - 1]?.close ?? 0;
    if (!first) return 0;
    return ((last - first) / first) * 100;
  }, [filteredCandles]);

const heroUtility =
  parsedAiOutput?.token_utility ||
  project?.token_utility ||
  `Support this business to unlock exclusive perks, priority access, and rewards on DUM Club.`;
 
 const uniqueTradeSources = useMemo(() => {
   const keys = new Set<string>();
   for (const trade of trades) {
      if (trade.source) keys.add(trade.source);
      else keys.add(`trade-${trade.id}`);
    }
    return keys.size;
  }, [trades]);

  const buyCount = trades.filter((t) => t.side === "buy").length;
  const sellCount = trades.filter((t) => t.side === "sell").length;
  const statusBanner = isApprovedProject
    ? "🟢 Your shop is live and accepting orders."
    : isRejected
    ? "⚠️ Your shop needs a small update before it can go live."
    : isSubmitted
    ? "⏳ Your shop is being reviewed. We'll let you know when it's live."
    : isPending
    ? "✅ Created. Finish setup, then go live."
    : "Draft. Continue setting up your business.";
  const nextTokenActionLabel =
    tokenStatus === "draft"
      ? "Set Up Business"
      : tokenStatus === "mint_created"
      ? "Configure Rewards"
      : tokenStatus === "tokens_minted"
      ? "Finalize Setup"
      : tokenStatus === "liquidity_added"
      ? "Go Live"
      : "Live";

  const launchSectionHeading =
    tokenStatus === "draft"
      ? "Set Up Your Business"
      : tokenStatus === "mint_created"
      ? "Business Configured"
      : tokenStatus === "tokens_minted"
      ? "Rewards Active"
      : tokenStatus === "liquidity_added"
      ? "Almost Live"
      : "Live on DUM Club";

  const nextStepHint =
    tokenStatus === "draft"
      ? "Set up your business on the DUM Club platform."
      : tokenStatus === "mint_created"
      ? "Next: configure your rewards and offers."
      : tokenStatus === "tokens_minted"
      ? "Next: finalize your storefront setup."
      : tokenStatus === "liquidity_added"
      ? "Next: go live on DUM Club."
      : null;
  const localAvgRating = feedbackEntries.length
    ? feedbackEntries.reduce((acc, item) => acc + item.rating, 0) / feedbackEntries.length
    : 0;
  // Prefer backend reviews if available, fall back to local
  const averageRating = backendReviewCount > 0 ? backendAvgRating : localAvgRating;
  const totalReviewCount = backendReviewCount > 0 ? backendReviewCount : feedbackEntries.length;
  const isSimulated = isSimulatedToken(tokenMeta.mint_address || project?.token_mint_address);

  // ── Hero display values (read-only aliases; gates unchanged) ─────────────
  const heroTitle = projectName;
  const displaySymbol = (project?.token_symbol || tokenSymbol || tokenMeta.symbol || "TOKEN").toUpperCase();
  const displayStatusLabel = formatTokenStatus(tokenStatus);


  const utilityBullets: string[] = useMemo(() => {
    const raw = (project?.utility_value || "").trim();
    if (raw.includes("•") || raw.includes("\n")) {
      return raw
        .split(/[•\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 4)
        .slice(0, 3);
    }
    const first = raw || "Premium business features";
    return [
      first,
      "AI-powered assistant included",
      "DUM Points on every purchase",
    ].slice(0, 3);
  }, [project?.utility_value]);

  const scrollToBuyPanel = () => scrollToSection("buy-panel");
  const scrollToAiWorkspace = () => scrollToSection("ai-workspace");

  const supplyDisplay =
    project?.token_supply != null && project.token_supply > 0
      ? formatNumber(project.token_supply, 0)
      : tokenMeta.supply
      ? formatNumber(Number(tokenMeta.supply), 0)
      : "—";

  // ── Clean offline buyer storefront ──────────────────────────────
  // Focused, mock-matching render for the most common case: a visitor on
  // a shop that isn't broadcasting. It owns its own layout (header ->
  // offline lead -> offers grid) and short-circuits the big owner/live
  // storefront tree below, which stays untouched for the owner managing
  // their shop, live viewers, loading, pitch mode, and checkout-success.
  //
  // Owners get this same clean storefront BY DEFAULT (so their own shop
  // looks modern when they open it); "Manage shop" flips ownerManage on to
  // drop into the management tree. Buyers always get it when offline.
  const offlineBuyerView =
    !loadingProject &&
    !!project &&
    (!isOwner || !ownerManage) &&
    !project.is_live &&
    !pitchMode &&
    checkoutResult !== "success";

  if (offlineBuyerView && project) {
    const proj = project;
    const money = (n: number | null | undefined) => {
      const v = Number(n || 0);
      return v % 1 === 0 ? `$${v}` : `$${v.toFixed(2)}`;
    };
    const loc = [
      ownerBizProfile?.city || ownerBizProfile?.location_city,
      ownerBizProfile?.region || ownerBizProfile?.location_state,
    ]
      .filter(Boolean)
      .join(", ");
    const verb = verbLabelForProject(proj);
    const activeOffers = offers.filter((o) => o.is_active);
    const featured = pinnedOffer && pinnedOffer.is_active ? pinnedOffer : activeOffers[0] || null;
    const gridOffers = activeOffers.filter((o) => o.id !== featured?.id);
    const cover = cleanLogoUrl(ownerBizProfile?.cover_image_url);
    const monogram = (projectName.trim().charAt(0) || "•").toUpperCase();
    const verified = ownerBizProfile?.verification_status === "verified";
    const aboutRaw = (proj.description || "").trim();
    const about =
      aboutRaw && aboutRaw !== "Auto-created from dashboard." && !aboutRaw.startsWith("Project workspace for ")
        ? aboutRaw
        : "";
    const isSoldOut = (o: Offer) =>
      !o.unlimited_inventory &&
      (o.quantity_available || 0) > 0 &&
      (o.quantity_available || 0) - (o.quantity_sold || 0) <= 0;

    const buyBtn = (o: Offer, variant: "featured" | "grid") => {
      const soldOut = isSoldOut(o);
      const busy = buyingOfferId === o.id;
      if (soldOut) {
        return (
          <span className={`inline-flex items-center justify-center rounded-xl border border-default px-4 py-2 text-xs font-bold text-secondary ${variant === "featured" ? "w-full py-3 text-sm" : ""}`}>
            Sold out
          </span>
        );
      }
      return (
        <button
          type="button"
          onClick={() => buyOffer(o)}
          disabled={busy}
          className={
            variant === "featured"
              ? "w-full rounded-xl bg-mint-fill px-6 py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90 disabled:opacity-50"
              : "rounded-lg bg-brand-navy px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
          }
        >
          {busy ? "Opening checkout…" : variant === "featured" ? `Buy now · ${money(o.price_usd)}` : "Buy now"}
        </button>
      );
    };

    return (
      <div className="min-h-screen bg-surface-page text-primary">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          {/* Back link + canonical URL */}
          <div className="flex items-center justify-between text-[11px] text-muted">
            <Link href="/discover" className="font-semibold transition hover:text-primary">
              ← Back to Discover
            </Link>
            <span className="font-mono">dum.club/{proj.slug}</span>
          </div>

          {/* Owner hint — this IS the public storefront; tools are one tap away. */}
          {isOwner && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mint-card-border bg-mint-card px-4 py-2.5">
              <span className="text-xs font-semibold text-brand-navy">
                👁 This is your public storefront. Customers see exactly this.
              </span>
              <button
                type="button"
                onClick={() => setOwnerManage(true)}
                className="rounded-lg bg-brand-navy px-3 py-1.5 text-[11px] font-bold text-white transition hover:opacity-90"
              >
                ⚙ Manage shop
              </button>
            </div>
          )}

          {/* ── Header card: cover + avatar + identity + actions ──
               Cover has two states driven by shop live status (handoff
               Storefront spec). LIVE → coral "LIVE · N watching" pill +
               "Watch the live show" / "Join live →"; OFFLINE → same dark
               cover, muted OFFLINE chip, "Notify me" strip below. This
               clean view only mounts for an offline shop, so the LIVE
               branch is defensive — an actively-broadcasting shop renders
               the live tree (inline IVS viewer) below. */}
          <div className="mt-3 overflow-hidden rounded-3xl border border-default bg-surface-card shadow-dum-card">
            <div
              className="relative h-36 w-full overflow-hidden bg-dum-video sm:h-52"
              style={
                cover
                  ? { backgroundImage: `url(${cover})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : undefined
              }
            >
              {!cover && (
                <svg className="pointer-events-none absolute -right-8 -top-8 h-56 w-56 text-white/[0.06]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" aria-hidden="true">
                  <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
                </svg>
              )}
              {proj.is_live ? (
                <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white shadow-dum-coral">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  LIVE{liveViewerCount > 0 ? ` · ${liveViewerCount} watching` : ""}
                </span>
              ) : (
                <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-surface-card/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
                  Offline
                </span>
              )}
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setOwnerManage(true)}
                  className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy/90 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-sm transition hover:bg-brand-navy"
                >
                  ⚙ Manage shop
                </button>
              )}
              {proj.is_live && (
                <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
                    <span aria-hidden="true">▶</span>
                    Watch the live show
                  </span>
                  <button
                    type="button"
                    onClick={() => setOwnerManage(false)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-mint-fill px-4 py-2 text-sm font-bold text-mint-fill-ink shadow-dum-card transition hover:opacity-90"
                  >
                    Join live →
                  </button>
                </div>
              )}
            </div>

            <div className="px-5 pb-6 sm:px-7">
              <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-default bg-surface-card text-3xl font-extrabold text-mint-text shadow-md sm:h-24 sm:w-24">
                    {logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoSrc} alt={`${projectName} logo`} className="h-full w-full object-cover" onError={() => setLogoSrc(null)} />
                    ) : (
                      monogram
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event("dum:message-shop"))}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-strong"
                  >
                    💬 Message
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFavorite()}
                    disabled={togglingFavorite}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                      isFavorited
                        ? "border border-mint-card-border bg-mint-card text-mint-text"
                        : "bg-mint-fill text-mint-fill-ink hover:opacity-90"
                    }`}
                  >
                    {isFavorited ? "Following" : "+ Follow"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold leading-tight text-brand-navy sm:text-3xl">{projectName}</h1>
                {verified && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-mint-card-border bg-mint-card px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-mint-text">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" /></svg>
                    Verified
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-xs text-secondary">
                <span className="inline-flex items-center gap-1 uppercase tracking-[0.14em] text-mint-text">
                  🔧 {verb} · {categoryLabel}
                </span>
                <span><span className="font-bold text-primary">{favoriteCount}</span> followers</span>
                <span><span className="font-bold text-primary">{activeOffers.length}</span> offers</span>
                {loc && (
                  <span className="inline-flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mint-text/70"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                    {loc}
                  </span>
                )}
              </div>

              {about && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-secondary">{about}</p>}
            </div>
          </div>

          {/* ── Offline lead: one clean card with inline notify ── */}
          <div className="mt-4 space-y-3">
            {proj.scheduled_live_at && (
              <ScheduledLiveBanner scheduledIso={proj.scheduled_live_at} projectId={id as string} />
            )}
            <LiveAlertSignup
              projectId={id as string}
              businessName={projectName}
              defaultEmail={authUser?.email || undefined}
              headline={`${projectName} is offline right now`}
              subtext="Drop your email and we'll ping you the moment they go live, with first dibs on flash-deal pricing."
            />
          </div>

          {/* ── What's for sale ── */}
          {activeOffers.length > 0 ? (
            <div className="mt-8">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-mint-text">What&apos;s for sale</div>
                  <h2 className="mt-1 text-xl font-bold text-brand-navy sm:text-2xl">
                    {activeOffers.length} offer{activeOffers.length === 1 ? "" : "s"} · Stripe checkout · earn DUM Points
                  </h2>
                </div>
                <span className="hidden shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-secondary sm:inline-flex">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-mint-text"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Secure checkout
                </span>
              </div>

              {/* Featured offer */}
              {featured && (
                <div className="mt-4 overflow-hidden rounded-3xl border border-mint-text/30 bg-surface-card shadow-sm sm:grid sm:grid-cols-2">
                  <div className="relative aspect-[16/10] w-full bg-surface-muted sm:aspect-auto sm:h-full">
                    {featured.primary_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={resolveImageUrl(featured.primary_image_url)} alt={featured.title} className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }} />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: "linear-gradient(135deg,#0b1220,#14323b)" }}>
                        <svg className="h-10 w-10 text-white/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" strokeLinecap="round" /></svg>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">{featured.title}</span>
                      </div>
                    )}
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-dum-navy-card px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-dum-live-accent shadow-dum-card">★ Featured</span>
                  </div>
                  <div className="p-5 sm:p-7">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-mint-text">
                        Now showing{featured.compare_at_price ? " · Live deal" : ""}
                      </div>
                      {/* Owner-only: only offer Unpin when this is genuinely
                          pinned (not just the arbitrary first-active fallback),
                          so tapping it always does something meaningful. */}
                      {isOwner && project?.pinned_offer_id === featured.id && (
                        <button
                          type="button"
                          onClick={() => handlePinOffer(null)}
                          disabled={pinningOfferId !== null}
                          className="text-[10px] font-semibold text-secondary underline-offset-2 transition hover:text-primary hover:underline disabled:opacity-50"
                        >
                          {pinningOfferId === "__unpin__" ? "Unpinning…" : "Unpin"}
                        </button>
                      )}
                    </div>
                    <h3 className="mt-1.5 text-xl font-bold text-brand-navy">{featured.title}</h3>
                    {featured.description && <p className="mt-1.5 text-sm leading-relaxed text-secondary line-clamp-3">{featured.description}</p>}
                    <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">Starting at</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="font-mono text-3xl font-black text-brand-navy">{money(featured.price_usd)}</span>
                      {featured.compare_at_price && Number(featured.compare_at_price) > Number(featured.price_usd) && (
                        <>
                          <span className="font-mono text-base text-muted line-through">{money(featured.compare_at_price)}</span>
                          <span className="rounded-full bg-state-live/10 px-2 py-0.5 text-[10px] font-bold uppercase text-state-live">Deal</span>
                        </>
                      )}
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <div className="flex-1">{buyBtn(featured, "featured")}</div>
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-default text-lg" title="Earn DUM Points on this purchase">🛍️</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Offers grid */}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gridOffers.map((o) => (
                  <div key={o.id} id={`offer-${o.id}`} className="flex flex-col overflow-hidden rounded-2xl border border-default bg-surface-card shadow-sm transition hover:shadow-md">
                    <div className="relative aspect-[4/3] w-full bg-surface-muted">
                      {o.primary_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(o.primary_image_url)} alt={o.title} loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }} />
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center" style={{ background: "linear-gradient(135deg,#eef2f0,#e4ece8)" }}>
                          <svg className="h-6 w-6 text-brand-navy/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-brand-navy/40">{o.title}</span>
                        </div>
                      )}
                      {o.compare_at_price && Number(o.compare_at_price) > Number(o.price_usd) && (
                        <span className="absolute left-2 top-2 rounded-full bg-state-live px-2 py-0.5 text-[9px] font-bold uppercase text-white">Deal</span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <h3 className="text-sm font-bold text-brand-navy">{o.title}</h3>
                      {o.description && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-secondary">{o.description}</p>}
                      <div className="mt-auto flex items-center justify-between pt-3">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-lg font-black text-brand-navy">{money(o.price_usd)}</span>
                          {o.compare_at_price && Number(o.compare_at_price) > Number(o.price_usd) && (
                            <span className="font-mono text-xs text-muted line-through">{money(o.compare_at_price)}</span>
                          )}
                        </div>
                        {buyBtn(o, "grid")}
                      </div>
                      {/* Owner-only: pin this offer to the featured slot above.
                          Simple one-tap version of the same handlePinOffer used
                          in Manage shop, right where the owner is already
                          looking at their offers. */}
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => handlePinOffer(o.id)}
                          disabled={pinningOfferId !== null}
                          className="mt-2 w-full rounded-lg border border-dashed border-default py-1.5 text-[11px] font-semibold text-secondary transition hover:border-mint-text hover:text-mint-text disabled:opacity-50"
                        >
                          {pinningOfferId === o.id ? "Pinning…" : "★ Pin as featured"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {isOwner && pinError && (
                <p className="mt-3 text-center text-[12px] text-coral">{pinError}</p>
              )}

              {/* ── DUM Points band — full-width dark green, exact handoff
                   copy (uses a middot, never a dash — the dashed variant is
                   a banned phrase). ── */}
              <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl bg-dum-navy-card px-6 py-5 text-center text-white shadow-dum-dark sm:flex-row sm:justify-between sm:text-left">
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-mint-fill/40 text-xl text-dum-live-accent">◎</span>
                  <div>
                    <div className="text-sm font-bold text-white">Every purchase earns DUM Points</div>
                    <p className="mt-1 text-[13px] leading-relaxed text-dum-navy-body">
                      Redeem for 10% off here or any shop on the network.
                    </p>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-dum-live-accent">
                  Loyalty that follows you
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-8 rounded-2xl border border-dashed border-default bg-surface-card p-10 text-center text-sm text-muted">
              No offers listed yet. Follow to hear when this shop posts something.
            </div>
          )}
        </div>

        {/* Private DM to the host — opened by the Message button above.
            Not shown to the owner viewing their own storefront. */}
        {!isOwner && <GuestChat projectId={id} businessName={projectName} />}
      </div>
    );
  }

return (
  <div className="relative min-h-screen bg-surface-page px-4 py-8 text-primary sm:px-6 lg:px-8">
    {/* Back to the clean storefront from the management tree. Only when the
        owner opened "Manage shop" on an offline shop — live/loading paths
        never set ownerManage. */}
    {isOwner && ownerManage && !project?.is_live && (
      <button
        type="button"
        onClick={() => setOwnerManage(false)}
        className="fixed bottom-4 left-4 z-[70] inline-flex items-center gap-1.5 rounded-full bg-brand-navy px-4 py-2.5 text-xs font-bold text-white shadow-lg transition hover:opacity-90"
      >
        ← View storefront
      </button>
    )}
    {/* Immersive live room — full-bleed overlay for non-owner visitors of a
        live IVS shop. Reuses the storefront's IVS viewer, chat, follow state,
        and buyOffer() checkout. The inline video/chat/buy-bar below are
        suppressed while this is up (`!immersiveLive`) so nothing double-mounts.
        Rendered before the checkout-success pill so that pill stays on top. */}
    {immersiveLive && project && (
      <LiveRoom
        projectId={id as string}
        userId={authUser?.privyId || ""}
        userName={authUser?.email || "Viewer"}
        isOwner={isOwner}
        auction={auction}
        auctionItem={auctionOffer ? { title: auctionOffer.title, image: auctionOffer.primary_image_url } : null}
        upNext={offers
          .filter((o) => o.id !== auction?.offer_id)
          .slice(0, 6)
          .map((o) => ({ id: o.id, title: o.title, image: o.primary_image_url }))}
        onBidPlaced={(displayName, amount) => {
          if (id) {
            broadcastLiveEvent(id as string, {
              user: displayName,
              text: `placed a bid: $${amount.toFixed(0)}`,
              type: "purchase",
            });
          }
        }}
        shop={{
          name: project.title || project.name || "Shop",
          logoUrl: cleanLogoUrl(project.business_profile?.logo_url) || null,
          verbLabel: verbLabelForProject(project),
        }}
        isFollowing={isFavorited}
        followerCount={favoriteCount}
        onToggleFollow={toggleFavorite}
        pinnedOffer={pinnedOffer}
        buyingOfferId={buyingOfferId}
        onBuy={() => { if (pinnedOffer) buyOffer(pinnedOffer); }}
        resolveImageUrl={resolveImageUrl}
        viewerCount={liveViewerCount}
        salesCount={liveSalesCount}
        getToken={getToken}
        onRequestSignIn={login}
        onCommentBuy={handleCommentBuy}
        onViewerCountChange={setLiveViewerCount}
        onItemSold={() => { loadOffers(); setLiveSalesCount((c) => c + 1); }}
        onItemUpdate={(data) =>
          setOffers((prev) =>
            prev.map((o) => (o.id === data.offer_id ? { ...o, quantity_sold: data.quantity_sold } : o)),
          )
        }
        onClose={() => setImmersiveDismissed(true)}
      />
    )}
    {/* Instant checkout-success acknowledgment — fixed-position pill
        anchored to the top of the viewport so the customer sees
        confirmation the moment ?checkout=success lands, before the
        rest of the storefront finishes hydrating. The mid-page banner
        further down (search for `checkoutResult === "success"`) stays
        for the detailed copy + DUM Points earned card; this is just
        the instant "your payment went through" signal. */}
    {checkoutResult === "success" && (
      <div className="fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-3 pb-[env(safe-area-inset-top)]">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-full bg-brand-teal px-4 py-2 text-sm font-bold text-brand-navy shadow-lg"
        >
          <span aria-hidden="true">✓</span>
          <span>Payment received. You&apos;re all set.</span>
        </div>
      </div>
    )}
    {/* Mobile-only sticky pinned-offer strip during a live broadcast.
        Desktop already shows the pinned offer in the right-column
        product card (lg:hidden here keeps the two from competing).
        Renders only when the merchant is live, a pin exists, and
        the viewer is a customer (owners see the desktop card / host
        controls separately). The Buy Now button calls the same
        buyOffer handler the inline card uses, so checkout behavior
        is unchanged. */}
    {project?.is_live && pinnedOffer && !isOwner && !immersiveLive && (() => {
      const hasCap = !pinnedOffer.unlimited_inventory && (pinnedOffer.quantity_available || 0) > 0;
      const remaining = hasCap
        ? Math.max(0, (pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0))
        : null;
      const isSoldOut = hasCap && (remaining ?? 0) <= 0;
      return (
        <div
          className="fixed inset-x-0 bottom-0 z-[55] border-t border-default bg-surface-card/95 backdrop-blur-md px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:hidden"
          aria-label="Featured item. Buy while the live show is on."
        >
          <div className="mx-auto flex max-w-md items-center gap-3">
            {pinnedOffer.primary_image_url && (
              <img
                src={resolveImageUrl(pinnedOffer.primary_image_url)}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-primary">
                {pinnedOffer.title}
                {typeof remaining === "number" && remaining > 0 && (
                  <span className="ml-2 rounded-full border border-state-live/40 bg-state-live/10 px-1.5 py-0.5 align-middle text-[10px] font-bold text-state-live">
                    {remaining} left
                  </span>
                )}
              </div>
              <div className="font-mono text-sm font-bold text-brand-teal">
                ${Number(pinnedOffer.price_usd).toFixed(2)}
              </div>
              <div className="text-[10px] text-secondary">Type “buy” in chat to claim</div>
            </div>
            {isSoldOut ? (
              <span className="shrink-0 rounded-xl border border-default px-4 py-2.5 text-sm font-bold text-secondary">
                Sold Out
              </span>
            ) : (
              <button
                type="button"
                onClick={() => buyOffer(pinnedOffer)}
                disabled={!!buyingOfferId}
                className="shrink-0 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white disabled:opacity-40"
              >
                {buyingOfferId === pinnedOffer.id ? "Opening…" : "Buy Now"}
              </button>
            )}
          </div>
        </div>
      );
    })()}
    {/* Schema.org JSON-LD. invisible to humans, primary signal for
        Google rich results and AI crawlers (Claude, GPT, Perplexity,
        Gemini). Emits LocalBusiness with embedded Offers, plus a
        BroadcastEvent only while is_live=true (eligibility gate for
        Google's "Live" badge). Pure additive; no consumer-visible UI. */}
    {project && (
      <JsonLd
        data={[
          buildLocalBusinessSchema(project, offers),
          buildBroadcastEventSchema(project),
        ]}
      />
    )}
    {/* 2J: the right-rail section dot-nav is power-user chrome. Hide it
        for owners until their first sale (clean early-stage page);
        customers and STATE_3+ owners keep it. Also hidden on the owner
        Manage console, where it listed hidden sections as stray chrome. */}
    {(!showOwnerInlineUi || ownerHasSales) && !(isOwner && ownerManage) && (
      <SectionNav refreshKey={loadingProject ? "loading" : "loaded"} />
    )}
    {statusToast}
    {isOwner && (
      <>
        <AdminBar
          projectSlug={project?.slug || id || ""}
          orderCount={sellerOrders.length}
          isLive={!!project?.is_live}
        />
        {/* Exit-customer-view chip — rendered separately so it
            stays visible after the AdminBar hides itself when
            the merchant toggles into customer preview. One tap
            to come back to admin mode. */}
        <ExitCustomerViewChip
          projectSlug={project?.slug || id || ""}
          isOwner={isOwner}
        />
      </>
    )}
    {/* showOwnerInlineUi reserves vertical space under the AdminBar
        (h-12 mobile / h-11 desktop) so the first content row — "Back
        to Feed / Storefront" — clears the sticky owner toolbar
        instead of hiding behind it. No effect for visitors / for
        owners in view-as-customer mode (AdminBar is hidden in those
        cases, so we don't reserve space). */}
    <div className={`relative z-[1] mx-auto w-full max-w-6xl min-w-0 overflow-x-hidden px-4 sm:px-6 lg:px-8${showOwnerInlineUi ? " pt-12 sm:pt-11" : ""}`}>

      {/* ── Presentation / Pitch Mode ──────────────── */}
      {pitchMode && (
        <div className="relative">
          {/* Exit button (owner sees toggle, public sees back) */}
          <div className="mb-8 flex items-center justify-between">
            <Link
              href="/discover"
              className="inline-flex rounded-full border border-default bg-surface-card px-4 py-2 text-xs uppercase tracking-[0.25em] text-secondary transition hover:bg-surface-muted hover:text-primary"
            >
              ← Back to Feed
            </Link>
            {isOwner && (
              <button
                onClick={togglePitchMode}
                className="rounded-full border border-default px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] text-secondary transition hover:border-default hover:text-brand-teal"
              >
                Exit Pitch View
              </button>
            )}
          </div>

          {/* Pitch hero */}
          <div
            className="mb-10 rounded-3xl border border-default bg-surface-page p-8 sm:p-12 text-center"
            style={{
              borderTop: `3px solid ${accent}`,
              boxShadow: `0 0 80px rgba(0,255,178,0.06)`,
            }}
          >
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-default bg-surface-card px-4 py-1.5">
                <span className="text-2xl">{emoji}</span>
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-secondary">
                  {category} · DUM Club
                </span>
              </div>

              <h1 className="text-4xl font-bold leading-tight text-brand-navy sm:text-6xl">
                {projectName}
              </h1>

              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-secondary sm:text-lg">
                {parsedAiOutput?.description || project?.description || ""}
              </p>

              {/* DUM Points badge. Audit #4 Phase 2 (Q7).
                  Was "DUM Points accepted" which implied redemption
                  (held until Phase 2 doctrine unlock). Buyers earn
                  points on every purchase; the framing now matches
                  the actual product surface. */}
              <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-default bg-brand-teal-soft px-5 py-2">
                <span className="text-sm font-bold text-brand-teal">◆ Earn DUM Points on every purchase</span>
              </div>
            </div>
          </div>

          {/* Pitch content grid */}
          <div className="mb-10 grid gap-6 md:grid-cols-2">
            {/* Rewards & Perks */}
            <div className="rounded-2xl border border-default bg-surface-card p-6">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-teal/60">
                Rewards &amp; Perks
              </div>
              <p className="text-sm leading-relaxed text-primary">
                {heroUtility}
              </p>
              {utilityBullets.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {utilityBullets.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-secondary">
                      <span className="mt-0.5 text-brand-teal">✦</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Key Metrics */}
            <div className="rounded-2xl border border-default bg-surface-card p-6">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-teal/60">
                <span>Key Metrics</span>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary">Supply</span>
                  <span className="font-mono font-semibold text-primary">{supplyDisplay}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary">Status</span>
                  <span className="font-mono text-xs font-semibold uppercase text-brand-teal">
                    {displayStatusLabel}
                  </span>
                </div>
                {feedbackEntries.length > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">Rating</span>
                    <span className="font-mono font-semibold text-primary">
                      {averageRating.toFixed(1)} / 5
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Project Score in pitch view */}
          {projectScore && (
            <div className="mb-10 rounded-2xl border border-default bg-surface-card p-6">
              <div className="mb-4 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-teal/60">
                  Project Score
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {(["virality", "trust", "utility"] as const).map((dim) => {
                  const entry = projectScore[dim];
                  const label = dim.charAt(0).toUpperCase() + dim.slice(1);
                  return (
                    <div key={dim}>
                      <div className={`font-mono text-2xl font-bold ${scoreColor(entry.score)}`}>
                        {entry.score}
                      </div>
                      <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.15em] text-secondary">
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Promo copy section */}
          {promoCopy && (
            <div className="mb-10 rounded-2xl border border-default bg-surface-card p-6 text-center">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-teal/60">
                About This Project
              </div>
              <p className="mx-auto max-w-xl text-base leading-relaxed text-primary whitespace-pre-wrap">
                {promoCopy}
              </p>
            </div>
          )}

          {/* Offers in pitch view */}
          {storeItems.length > 0 && (
            <div className="mb-10">
              <div className="mb-5 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-brand-teal/60">
                  Offers
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {storeItems.map((item) => {
                  const badge = storeTypeBadge[item.type];
                  const hasPerk = Boolean(item.required_token_amount && item.required_token_amount > 0);
                  const tokenConfigured = Boolean(project?.token_mint_address && !isSimulatedToken(project.token_mint_address));
                  const showGating = hasPerk && tokenConfigured;
                  let perkState: "none" | "no_wallet" | "locked" | "unlocked" = "none";
                  if (showGating) {
                    if (!userWallet) perkState = "no_wallet";
                    else if (walletBalance >= (item.required_token_amount || 0)) perkState = "unlocked";
                    else perkState = "locked";
                  }
                  const pitchPrice = perkState === "unlocked" && item.token_holder_price != null ? item.token_holder_price : item.price || "Free";
                  const pitchFree = perkState === "unlocked" && (item.token_holder_price?.toLowerCase() === "free" || item.token_holder_price === "0");

                  return (
                    <div key={item.id} className="rounded-2xl border border-default bg-surface-card p-5 flex flex-col">
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${badge.color}`}>
                          {badge.label}
                        </span>
                        {showGating && perkState === "unlocked" && (
                          <span className="rounded-full border border-default bg-brand-teal-soft px-2 py-0.5 text-[9px] font-semibold uppercase text-brand-teal">
                            ✓ Unlocked
                          </span>
                        )}
                        {showGating && perkState === "locked" && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400">
                            Requires {item.required_token_amount} tokens
                          </span>
                        )}
                        {showGating && perkState === "no_wallet" && (
                          <span className="rounded-full border border-default px-2 py-0.5 text-[9px] font-semibold uppercase text-secondary">
                            🔒 Gated
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-primary">{item.name}</h3>
                      {item.description && (
                        <p className="mt-1 text-sm text-secondary leading-relaxed">{item.description}</p>
                      )}
                      {item.type === "subscription" && item.benefits && item.benefits.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {item.benefits.map((b, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-secondary">
                              <span className="mt-0.5 text-brand-teal">✦</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {showGating && item.perk_description && (
                        <div className="mt-3 rounded-lg border border-default bg-brand-teal-soft px-3 py-2">
                          <span className="text-xs text-brand-teal">{item.perk_description}</span>
                        </div>
                      )}
                      <div className="mt-auto pt-4 flex items-center justify-between">
                        <div>
                          {pitchFree ? (
                            <span className="text-lg font-bold text-brand-teal">Free for members</span>
                          ) : (
                            <span className="font-mono text-lg font-bold text-primary">{pitchPrice}</span>
                          )}
                          {perkState === "unlocked" && item.token_holder_price != null && item.price && !pitchFree && (
                            <span className="ml-2 text-xs text-muted line-through">{item.price}</span>
                          )}
                        </div>
                        <button className="rounded-xl border border-default px-4 py-2 text-xs font-medium text-secondary transition hover:border-default hover:text-brand-teal">
                          {item.type === "subscription" ? "Subscribe" : "Buy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="mb-10 text-center">
            <div className="inline-flex flex-wrap items-center justify-center gap-3">
              {ENABLE_AI_FEATURES && (
              <button
                onClick={() => { setPitchMode(false); setTimeout(scrollToAiWorkspace, 100); }}
                // Mobile: hidden — AI is the floating bubble only.
                // Desktop: keeps the in-pitch Ask AI affordance.
                className="hidden rounded-xl border border-default px-8 py-3 text-sm font-medium text-primary transition hover:border-default hover:text-brand-teal sm:inline-flex"
              >
                Ask AI
              </button>
              )}
              {isOwner && (
                <button
                  onClick={() => copyToClipboard(`${window.location.origin}/project/${id}?view=pitch`, "pitch link")}
                  className="rounded-xl border border-default px-6 py-3 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary"
                >
                  Copy Pitch Link
                </button>
              )}
            </div>
          </div>

          {/* Toast (shared with builder) */}
          {builderToast && (
            <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-slide-down rounded-xl border border-default bg-surface-card px-5 py-2.5 shadow-lg">
              <span className="text-sm font-medium text-brand-teal">{builderToast}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Normal project view ────────────────────── */}
      {!pitchMode && (<>
      {isOwner && showLiveBanner && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-default bg-brand-teal-soft px-5 py-4 animate-fade-slide-down">
          <div className="flex items-center gap-3">
            <span className="text-brand-teal">✦</span>
            <span className="text-sm font-semibold text-brand-teal">
              <span className="uppercase tracking-[0.15em]">{heroTitle}</span>
              {" is live. "}
              <span className="font-normal text-brand-teal">share it with your community</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setBannerCopied(true);
                  window.setTimeout(() => setBannerCopied(false), 1500);
                } catch {}
              }}
              className="rounded-lg border border-default px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-brand-teal transition hover:border-brand-teal hover:text-brand-teal"
            >
              {bannerCopied ? "Copied ✓" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => setShowLiveBanner(false)}
              aria-label="Dismiss"
              className="text-brand-teal transition hover:text-brand-teal"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── DUM Points earned banner (post-launch) ── */}
      {isOwner && showLiveBanner && (
        <div className="mb-4 flex items-center justify-center gap-2 rounded-xl border border-default bg-brand-teal-soft py-2.5 animate-fade-slide-down">
          <span className="text-brand-teal font-bold text-sm">◆ +25 DUM Points earned</span>
          <span className="text-[11px] text-brand-teal/50">for launching this project</span>
        </div>
      )}

      {/* ── AI Co-pilot Prompts (owner-only, storefront view, DESKTOP ONLY) ──
           On mobile, the floating AiSalesChat bubble at the page bottom
           is the single AI entry point — the embedded chip cluster + the
           PR #257 drawer were removed to avoid duplicate AI surfaces on
           phones. Desktop continues to render the chip grid inline as a
           merchant-facing nudge — there's no floating bubble equivalent
           visual real-estate cost on a 1280px+ screen. */}
      {ENABLE_AI_FEATURES && showOwnerInlineUi && ownerHasSales && !project?.is_live && (
        <div className="mb-6 hidden rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/[0.04] to-surface-card p-5 sm:block">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-brand-teal text-[9px] font-extrabold text-black">D</div>
            <span className="text-sm font-bold text-primary">Grow your business with AI</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              "Improve my offers",
              "Pricing strategy",
              "Marketing ideas",
              "Write better descriptions",
              "Generate ad copy",
              "Customer acquisition",
            ].map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setQuestion(label);
                  const el = typeof document !== "undefined"
                    ? document.getElementById("ai-workspace")
                    : null;
                  if (el) {
                    try {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                    } catch {
                      el.scrollIntoView();
                    }
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Top Navigation Bar ── */}
      {/* mb-4 on mobile (tighter), mb-8 on desktop (unchanged). The
          AdminBar pt above already lifts this row clear of the sticky
          owner toolbar; the previous mb-8 was producing too much air
          between the Back-to-Feed chip and the next mobile section. */}
      <div className="mb-4 flex items-center justify-between gap-3 sm:mb-8">
        <Link
          href="/discover"
          className="inline-flex rounded-full border border-default bg-surface-card px-4 py-2 text-xs uppercase tracking-[0.25em] text-secondary transition hover:bg-surface-muted hover:text-primary"
        >
          ← Back to Feed
        </Link>

        {isOwner && (
          /* DUM Hub view-toggle removed for the buyer-conversion pass —
              the project page now focuses on watch/browse/buy. Merchants
              still reach their analytics + memory views from /dashboard.
              Kept a single Storefront pill so the owner has a visible
              "you are viewing the public storefront" affordance. */
          <div className="flex items-center gap-1 rounded-full border border-default bg-surface-card p-1">
            <span className="rounded-full bg-brand-teal px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-black">
              Storefront
            </span>
          </div>
        )}
      </div>

      {/* Audit #4 Phase 1 (Q11). temporary "Show ended" banner.
           Renders for ~30s after a real is_live true→false
           transition during the same page session. Recap copy
           uses the cumulative sale count captured at end-of-show.
           The banner does not block the storefront-mode UI below
           it. the page just gets a brief acknowledgement chip
           between live mode and silent revert. */}
      {streamJustEnded && (
        <div className="mb-6 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-muted px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-teal-soft text-xs font-bold text-brand-teal">✓</span>
              <span className="text-sm font-bold text-primary">Show ended</span>
              {streamEndedSummary && streamEndedSummary.sales > 0 && (
                <span className="text-[12px] text-brand-teal">
                  · {streamEndedSummary.sales} sold this show
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStreamJustEnded(false)}
              className="text-[11px] text-secondary transition hover:text-primary"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── IVS Host wrapper relocated below into the
           live+offers side-by-side grid (search for
           project-live-host). The component uses module-level
           state, so its DOM position doesn't affect the
           broadcast lifecycle — only the visual placement
           changed. AdminBar's #project-live-host anchor still
           points at the new location. */}

      {/* ── REPLAY (fallback when offline + a replay was recorded) ──
           Renders only when the project is NOT currently broadcasting
           AND a replay URL exists. Sibling to the LIVE block so the two
           are mutually exclusive in practice (live wins when live).
           See backend/db/migrations/047_replay_url.sql + docs/replay-system.md
           — replay_url is populated externally (AWS IVS recording -> S3
           handler, or manually via /api/health/replay-url). Until then
           the column is NULL for every project and this block doesn't
           render. */}
      {/* "Going live <day> at <time>" banner + customer reminder
          signup. Renders when the merchant set a scheduled_live_at
          in the future and isn't currently broadcasting. Drives the
          weekly retention loop: returning customer sees the next
          live time AND can opt-in to a one-shot email when it
          starts. Hidden during a live broadcast (the LIVE banner
          above carries that signal). Hidden when the schedule is in
          the past (we don't auto-clear stale values; the banner
          just stops showing). */}
      {!project?.is_live && project?.scheduled_live_at && (
        <ScheduledLiveBanner
          scheduledIso={project.scheduled_live_at}
          projectId={id as string}
        />
      )}
      {!project?.is_live && project?.replay_url && (
        <ReplayCard
          replayUrl={project.replay_url}
          recordedAt={project.replay_recorded_at ?? null}
          businessName={projectName}
          storefrontPath={`/project/${project.slug || project.id}`}
        />
      )}

      {/* Always-on "notify me when live" — shown to customers when the
          merchant has no upcoming scheduled show (the scheduled case is
          covered by ScheduledLiveBanner above). Lets a visitor opt into
          the next go-live from any storefront, which is what makes the
          go-live email notifications reachable for every business. Owner
          (non-preview) view is excluded — a merchant doesn't subscribe to
          their own shop. */}
      {!project?.is_live && !project?.scheduled_live_at && !showOwnerInlineUi && (
        <LiveAlertSignup
          projectId={id as string}
          businessName={projectName}
          defaultEmail={authUser?.email || undefined}
        />
      )}

      {/* ── NOT-LIVE hero (customer view) ──────────────
           When the shop isn't broadcasting, never show an empty black
           video box. Show a plain "isn't live right now" line plus the
           featured product (pinned, else first active offer) with Buy
           Now, so a first-time visitor always has something to watch
           for AND something to buy. Owner (non-preview) is excluded —
           they get the host/control UI instead. */}
      {!project?.is_live && !showOwnerInlineUi && (() => {
        const featured = pinnedOffer || offers.find((o) => o.is_active) || null;
        const soldOut = !!featured
          && !featured.unlimited_inventory
          && (featured.quantity_available || 0) > 0
          && ((featured.quantity_available || 0) - (featured.quantity_sold || 0)) <= 0;
        return (
          <div className="mb-6 rounded-3xl border border-default bg-surface-card p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-muted" />
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-secondary">
                {projectName} isn&apos;t live right now
              </span>
            </div>
            <p className="mt-2 text-sm text-secondary">
              {featured
                ? "Catch the next show, or grab the featured product below."
                : "Catch the next show. Get notified when they go live."}
            </p>
            {featured && (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                {featured.primary_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolveImageUrl(featured.primary_image_url)}
                    alt={featured.title}
                    className="h-28 w-full rounded-xl object-cover sm:h-24 sm:w-40"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">Featured</div>
                  <h3 className="mt-0.5 line-clamp-1 text-lg font-bold text-primary">{featured.title}</h3>
                  <span className="font-mono text-xl font-extrabold text-brand-teal">
                    ${Number(featured.price_usd).toFixed(2)}
                  </span>
                </div>
                {soldOut ? (
                  <span className="rounded-xl border border-default px-5 py-3 text-center text-sm font-bold text-secondary">Sold Out</span>
                ) : (
                  <button
                    onClick={() => buyOffer(featured)}
                    disabled={!!buyingOfferId}
                    className="shrink-0 rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover hover:text-white disabled:opacity-40"
                  >
                    {buyingOfferId === featured.id ? "Opening secure checkout…" : "Buy Now"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── LIVE NOW Banner + Stream ────────────────── */}
      {project?.is_live && !immersiveLive && (project.stream_url || project.live_playback_id || project.ivs_stage_arn || isIVSSession(project)) && (
        <div className="mb-6">
          {/* ── LIVE banner. always full width above the grid ──
               Audit #4 Phase 1 surfaces three real-data signals that
               were previously hidden: the cumulative sales count
               (Q1, was buried inside the bouncing toast), the viewer
               count (Q2, was scoped to LiveChatIVS), and the rewards
               pill (Q8, was zinc-on-zinc and easy to miss). All real
               data; nothing fabricated. The Q3 "Live for H:MM" timer
               is now real too — computed from projects.live_started_at
               (migration 084), not a client-side approximation. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-[var(--state-live)]/30 bg-state-live/[0.06] px-4 py-2.5 sm:px-5 sm:py-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-state-live" />
              </span>
              <span className="font-mono text-xs sm:text-sm font-bold uppercase tracking-[0.14em] text-coral">Live</span>
              <span className="text-xs sm:text-sm text-secondary truncate">{projectName}</span>
              {/* Q3. "Live for H:MM" — real elapsed since live_started_at
                  (migration 084). Hidden until the field exists so a
                  pre-084 stream looks exactly as before. */}
              {liveFor && (
                <span className="rounded-full border border-default bg-surface-card px-2 py-0.5 text-[10px] font-mono text-secondary">
                  Live for {liveFor}
                </span>
              )}
              {/* Q2. viewer count (real, from existing WebSocket) */}
              {liveViewerCount > 0 && (
                <span className="rounded-full bg-coral-bg px-2 py-0.5 text-[10px] font-mono font-bold text-coral">
                  {liveViewerCount} watching
                </span>
              )}
              {/* Q1. persistent sold-this-show counter (real,
                  from `liveSalesCount` already incremented on
                  every `item_sold` WebSocket event). Hidden until
                  the first sale to avoid a sad "0 sold" pill. */}
              {liveSalesCount > 0 && (
                <span className="rounded-full border border-mint-card-border bg-mint-card px-2 py-0.5 text-[10px] font-mono font-bold text-mint-text">
                  {liveSalesCount} sold this show
                </span>
              )}
            </div>
            {/* Q8. promote the rewards pill from zinc-on-zinc to
                 emerald so the buyer's biggest reward signal isn't
                 whispered. Same visual weight as the founding-100
                 pill on /merchant. */}
            <span className="rounded-full border border-mint-card-border bg-mint-card px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-mint-text">
              Earn DUM Points
            </span>
          </div>

          {/* ── Single column: video, then chat directly below, then the
               product/offers. Mirrors the customer live window so the page
               reads top to bottom and stays easy to use. ── */}
          <div>

            {/* ── Video, chat, then product/controls, stacked ── */}
            <div className="space-y-4">
              {/* Video player with sale toast overlay */}
              <div className="relative">
                {isIVSSession(project) && project.ivs_stage_arn && !isOwner ? (
                  <IVSStageViewer
                    projectId={id as string}
                    userId={authUser?.privyId || ""}
                  />
                ) : (
                <div className="overflow-hidden rounded-2xl border border-default bg-black">
                  {project.stream_url === "camera://local" ? (
                    <div className="flex items-center justify-center bg-surface-muted" style={{ aspectRatio: "16/9" }}>
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                          <span className="relative flex h-3 w-3">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full bg-state-live" />
                          </span>
                          <span className="text-sm font-bold uppercase tracking-widest text-state-live">Live Now</span>
                        </div>
                        <p className="text-xs text-secondary">Browse products and chat below</p>
                      </div>
                    </div>
                  ) : project.stream_url ? (
                    <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                      <iframe
                        src={project.stream_url}
                        className="absolute inset-0 h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : null}
                </div>
                )}

                {/* ── Sale toast overlay. bottom-left of video ── */}
                {saleToasts.length > 0 && (
                  <div
                    aria-live="polite"
                    aria-atomic="true"
                    className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-2"
                  >
                    {saleToasts.map((toast) => (
                      <div
                        key={toast.id}
                        className="pointer-events-none flex items-center gap-2 rounded-xl border border-default bg-black/80 px-4 py-2.5 shadow-lg shadow-md backdrop-blur-sm animate-bounce"
                        style={{ animationDuration: "0.6s", animationIterationCount: "1" }}
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-teal text-xs font-bold text-black">$</span>
                        <div>
                          <div className="text-sm font-bold text-primary">{toast.title} just sold!</div>
                          <div className="text-[11px] text-brand-teal">{toast.count} sold this show</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── DUM Points earned toast. top-right of video ── */}
                {dumPointsEarned !== null && (
                  <div className="pointer-events-none absolute top-3 right-3 z-10">
                    <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-black/80 px-4 py-2.5 shadow-lg shadow-amber-500/10 backdrop-blur-sm animate-bounce" style={{ animationDuration: "0.6s", animationIterationCount: "1" }}>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-black">+</span>
                      <div>
                        <div className="text-sm font-bold text-primary">You earned {dumPointsEarned} DUM Points!</div>
                        <div className="text-[11px] text-amber-400/70">Rewards on every purchase</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Live chat. Sits directly below the video so the page
                   mirrors the customer live window (video, then chat, then
                   offers) and stays simple to use. Fixed-height box like the
                   customer view (no fillHeight). ──
                   Owners are excluded here: their real camera is the
                   IVSStageHost panel further down, so the host gets a chat
                   box mounted directly under THAT camera instead (see the
                   host column below). Gating on !isOwner keeps a single
                   LiveChatIVS mounted per role — no double WebSocket. */}
              {isIVSSession(project) && !isOwner && (
                <div className="pb-2">
                  <LiveChatIVS
                    projectId={id as string}
                    userId={authUser?.privyId || ""}
                    userName={authUser?.email || "Viewer"}
                    isHost={isOwner}
                    onRequestSignIn={login}
                    getToken={getToken}
                    onCommentBuy={handleCommentBuy}
                    onViewerCountChange={setLiveViewerCount}
                    onItemUpdate={(data) => {
                      setOffers((prev) => prev.map((o) =>
                        o.id === data.offer_id
                          ? { ...o, quantity_sold: data.quantity_sold }
                          : o
                      ));
                    }}
                    onItemSold={(data) => {
                      loadOffers();
                      setLiveSalesCount((c) => {
                        const next = c + 1;
                        const toastId = `${data.offer_id}-${Date.now()}`;
                        setSaleToasts((prev) => [
                          ...prev.slice(-2),
                          { id: toastId, title: data.title || "Item", count: next },
                        ]);
                        setTimeout(() => {
                          setSaleToasts((prev) => prev.filter((t) => t.id !== toastId));
                        }, 4000);
                        return next;
                      });
                    }}
                  />
                </div>
              )}

              {/* Reward visibility. hidden on mobile, visible on lg: (stays in DOM) */}
              <div className="hidden lg:flex items-center justify-center gap-2 rounded-xl border border-default bg-brand-teal-soft py-2.5">
                <span className="text-brand-teal text-sm font-semibold">Earn DUM when you buy</span>
                <span className="text-[11px] text-brand-teal/50">Rewards on every purchase</span>
              </div>

              {/* Pinned product / auction. full card on every viewport.
                  On mobile this sits above the chat (the chat is a separate
                  grid item that falls below the left column when collapsed).
                  The fixed sticky buy bar at the bottom of the screen is
                  still rendered on mobile as an always-visible quick action. */}
              <div>
                {auction && auctionOffer && (auction.status === "active" || auction.status === "ended" || auction.status === "awaiting_payment" || auction.status === "paid") ? (
                  <div
                    data-auction-card
                    className={`rounded-2xl border p-5 ${isAuctionActive ? "border-amber-400/30 bg-amber-400/[0.03]" : "border-default bg-surface-card"}`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-400">Live Auction</span>
                      {isAuctionActive && (
                        <span className="font-mono text-lg font-bold text-primary">{auctionCountdown}</span>
                      )}
                    </div>

                    <h3 className="text-lg font-bold text-primary">{auctionOffer.title}</h3>
                    {auctionOffer.description && (
                      <p className="mt-1 text-sm text-secondary line-clamp-1">{auctionOffer.description}</p>
                    )}

                    {/* Bid display */}
                    <div className="mt-3 rounded-xl border border-default bg-surface-page p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.2em] text-muted">
                            {auction.current_bid ? "Current Bid" : "Starting Price"}
                          </div>
                          <div className="font-mono text-2xl font-bold text-primary">
                            ${Number(auction.current_bid || auction.starting_price).toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          {auction.current_bidder_display && (
                            <div className="text-sm text-secondary">by {auction.current_bidder_display}</div>
                          )}
                          <div className="text-[10px] text-muted">{auction.bid_count} bid{auction.bid_count !== 1 ? "s" : ""}</div>
                        </div>
                      </div>
                    </div>

                    {/* Bidder state feedback */}
                    {isAuctionActive && !isOwner && authUser && (
                      <>
                        {auction.current_bidder === authUser.privyId ? (
                          <div className="mt-3 rounded-xl border border-default bg-brand-teal-soft px-4 py-2 text-center text-sm font-semibold text-brand-teal">
                            You are the highest bidder
                          </div>
                        ) : auction.current_bidder && (
                          <div className="mt-3 space-y-2">
                            {auctionBidError && (
                              <div className="rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-state-live">{auctionBidError}</div>
                            )}
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">$</span>
                                <input
                                  type="number"
                                  value={auctionBidAmount}
                                  onChange={(e) => setAuctionBidAmount(e.target.value)}
                                  placeholder={String(Number(auction.current_bid || auction.starting_price) + 1)}
                                  className="w-full rounded-xl border border-default bg-surface-muted py-2.5 pl-7 pr-3 text-sm text-primary outline-none transition focus:border-amber-400/40"
                                />
                              </div>
                              <button
                                onClick={handlePlaceBid}
                                disabled={auctionBidding || !auctionBidAmount}
                                className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-amber-400 disabled:opacity-40"
                              >
                                {auctionBidding ? "..." : "Bid"}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* First bid (no current bidder yet) */}
                        {!auction.current_bidder && (
                          <div className="mt-3 flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">$</span>
                              <input
                                type="number"
                                value={auctionBidAmount}
                                onChange={(e) => setAuctionBidAmount(e.target.value)}
                                placeholder={String(auction.starting_price)}
                                className="w-full rounded-xl border border-default bg-surface-muted py-2.5 pl-7 pr-3 text-sm text-primary outline-none transition focus:border-amber-400/40"
                              />
                            </div>
                            <button
                              onClick={handlePlaceBid}
                              disabled={auctionBidding || !auctionBidAmount}
                              className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-amber-400 disabled:opacity-40"
                            >
                              {auctionBidding ? "..." : "Place Bid"}
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {/* Winner Pay Now */}
                    {auction.status === "ended" && isAuctionWinner && (
                      <div className="mt-3 space-y-2">
                        <div className="rounded-xl border border-default bg-brand-teal-soft px-4 py-2 text-center text-sm font-bold text-brand-teal">
                          You Won!
                        </div>
                        <button
                          onClick={handleAuctionPayNow}
                          className="w-full rounded-xl bg-brand-teal py-3 text-sm font-bold text-black transition hover:bg-brand-teal"
                        >
                          Pay Now. ${Number(auction.current_bid).toFixed(2)}
                        </button>
                      </div>
                    )}

                    {/* Ended states for non-winners */}
                    {auction.status === "ended" && !isAuctionWinner && auction.current_bidder && (
                      <div className="mt-3 rounded-xl border border-default bg-surface-page px-4 py-2 text-center text-sm text-secondary">
                        Auction ended. sold for ${Number(auction.current_bid).toFixed(2)}
                      </div>
                    )}
                    {(auction.status === "awaiting_payment" || auction.status === "paid") && (
                      <div className="mt-3 rounded-xl border border-default bg-surface-page px-4 py-2 text-center text-sm text-secondary">
                        {auction.status === "paid" ? `Sold for $${Number(auction.current_bid).toFixed(2)}` : "Completing payment..."}
                      </div>
                    )}

                    {/* Not signed in */}
                    {isAuctionActive && !authUser && (
                      <div className="mt-3 rounded-xl border border-default bg-surface-page px-4 py-2 text-center text-sm text-secondary">
                        Sign in to place a bid
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── Standard Pinned Offer (Buy Now). desktop card ── */
                  <div className="rounded-2xl border border-default bg-surface-card p-5">
                    <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">
                      {pinnedOffer ? "Featured Product" : "No product pinned"}
                    </div>
                    {pinnedOffer ? (
                      <div>
                        {pinnedOffer.primary_image_url && (
                          <img
                            src={resolveImageUrl(pinnedOffer.primary_image_url)}
                            alt={pinnedOffer.title}
                            className="mb-3 h-32 w-full rounded-xl object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }}
                          />
                        )}
                        <h3 className="text-lg font-bold text-primary">{pinnedOffer.title}</h3>
                        {pinnedOffer.description && (
                          <p className="mt-1 text-sm text-secondary line-clamp-2">{pinnedOffer.description}</p>
                        )}
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <span className="font-mono text-xl font-bold text-brand-teal">
                              ${Number(pinnedOffer.price_usd).toFixed(2)}
                            </span>
                            {!pinnedOffer.unlimited_inventory && pinnedOffer.quantity_available && (() => {
                              // Audit #4 Phase 2 (Q4). promote inventory
                              // urgency below 5 left. Real data only;
                              // amber/red surfacing only fires when the
                              // numbers actually warrant it.
                              const remaining = Math.max(
                                0,
                                (pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0),
                              );
                              const lowStock = remaining > 0 && remaining <= 5;
                              return (
                                <span className={`ml-2 text-xs font-medium ${lowStock ? "text-amber-400" : "text-secondary"}`}>
                                  {lowStock && <span aria-hidden="true">🔥 </span>}
                                  {remaining} left{lowStock ? ". almost gone" : ""}
                                </span>
                              );
                            })()}
                          </div>
                          {!isOwner && (() => {
                            const isSoldOut = !pinnedOffer.unlimited_inventory
                              && (pinnedOffer.quantity_available || 0) > 0
                              && ((pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0)) <= 0;
                            return isSoldOut ? (
                              <span className="w-full rounded-xl border border-default px-5 py-2.5 text-center text-sm font-bold text-secondary sm:w-auto">Sold Out</span>
                            ) : (
                              <button
                                onClick={() => buyOffer(pinnedOffer)}
                                disabled={!!buyingOfferId}
                                className="w-full rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-black transition hover:bg-brand-teal disabled:opacity-40 sm:w-auto sm:py-2.5"
                              >
                                {buyingOfferId === pinnedOffer.id ? "Opening secure checkout…" : "Buy Now"}
                              </button>
                            );
                          })()}
                        </div>
                        {buyError[pinnedOffer.id] && (
                          <div className="mt-2 rounded-lg border border-[var(--state-live)]/30 bg-state-live/5 px-3 py-2 text-xs text-state-live">
                            {buyError[pinnedOffer.id]}
                          </div>
                        )}
                        {/* Audit #4 Phase 2 (Q5). Stripe trust copy at
                            the buyer's highest-friction moment. Mirrors
                            the merchant onboarding line ("your bank info
                            goes to Stripe, never to DUM Club") so the
                            buyer sees the same payment trust signal. */}
                        {!isOwner && (
                          <p className="mt-3 text-[11px] leading-relaxed text-secondary">
                            <span className="text-secondary">Stripe checkout</span> · Your card never touches DUM Club. <span className="text-muted">Prices in USD; Stripe converts at checkout. The seller handles refunds and questions.</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">
                        {isOwner ? "Pin a product from the control panel below." : "The seller hasn't pinned a product yet."}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Host controls. below product on desktop. showOwnerInlineUi
                  (not bare isOwner) so the pin buttons vanish when the owner
                  previews "view as customer" — admin chrome off the customer
                  view. (The IVSStageHost broadcast block below stays on bare
                  isOwner on purpose: gating it on showOwnerInlineUi would
                  unmount the publisher and end the live stream the instant
                  the owner toggled preview.) */}
              {showOwnerInlineUi && isIVSSession(project) && (
                <div className="space-y-3 rounded-2xl border border-default bg-surface-card p-4">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-secondary">Sell a Product</div>
                  <div className="flex flex-wrap gap-2">
                    {offers.filter((o) => o.is_active).map((offer) => (
                      <button
                        key={offer.id}
                        onClick={() => handlePinOffer(offer.id === project.pinned_offer_id ? null : offer.id)}
                        className={`rounded-xl border px-3 py-2 text-sm transition ${
                          offer.id === project.pinned_offer_id
                            ? "border-default bg-brand-teal-soft text-brand-teal"
                            : "border-default text-secondary hover:border-strong hover:text-white"
                        }`}
                      >
                        {offer.title} · ${Number(offer.price_usd).toFixed(0)}
                        {offer.id === project.pinned_offer_id && " (pinned)"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>


          {/* ── MOBILE STICKY BUY BAR. pinned product/auction as bottom bar on mobile ── */}
          {!isOwner && (
            <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-default bg-surface-card backdrop-blur-sm lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
              {auction && auctionOffer && isAuctionActive ? (
                /* Auction sticky bar */
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-amber-400">Live Auction</div>
                    <div className="truncate text-sm font-bold text-primary">{auctionOffer.title}</div>
                  </div>
                  <div className="flex items-center gap-3 pl-3">
                    <span className="font-mono text-lg font-bold text-primary">${Number(auction.current_bid || auction.starting_price).toFixed(2)}</span>
                    {authUser ? (
                      auction.current_bidder === authUser.privyId ? (
                        <span className="rounded-lg bg-brand-teal-soft px-3 py-2 text-xs font-bold text-brand-teal">Top Bid</span>
                      ) : (
                        <button
                          // Q9. if there's no bid amount entered yet,
                          // tapping the sticky-bar Bid button on mobile
                          // would submit an empty/NaN amount through
                          // handlePlaceBid. Scroll to the auction card's
                          // visible input instead so the buyer can type
                          // an amount in the existing UI.
                          onClick={() => {
                            if (!auctionBidAmount.trim()) {
                              if (typeof document !== "undefined") {
                                document
                                  .querySelector("[data-auction-card]")
                                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                              return;
                            }
                            handlePlaceBid();
                          }}
                          disabled={auctionBidding}
                          className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-amber-400 disabled:opacity-40"
                        >
                          {auctionBidding ? "..." : auctionBidAmount.trim() ? "Bid" : "Place Bid"}
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-secondary">Sign in</span>
                    )}
                  </div>
                </div>
              ) : pinnedOffer ? (
                /* Pinned offer sticky bar
                   Q5. Stripe trust caption added below the row so the
                   highest-conversion-density surface on mobile carries
                   the same payment trust signal as the desktop card. */
                <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-primary">{pinnedOffer.title}</div>
                    <span className="font-mono text-sm font-bold text-brand-teal">${Number(pinnedOffer.price_usd).toFixed(2)}</span>
                    {!pinnedOffer.unlimited_inventory && pinnedOffer.quantity_available && (() => {
                      // Q4. same low-stock urgency in the mobile sticky bar.
                      const remaining = Math.max(
                        0,
                        (pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0),
                      );
                      const lowStock = remaining > 0 && remaining <= 5;
                      return (
                        <span className={`ml-2 text-[10px] font-medium ${lowStock ? "text-amber-400" : "text-secondary"}`}>
                          {lowStock && <span aria-hidden="true">🔥 </span>}
                          {remaining} left
                        </span>
                      );
                    })()}
                  </div>
                  <div className="pl-3">
                    {(() => {
                      const isSoldOut = !pinnedOffer.unlimited_inventory
                        && (pinnedOffer.quantity_available || 0) > 0
                        && ((pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0)) <= 0;
                      return isSoldOut ? (
                        <span className="rounded-lg border border-default px-4 py-2 text-xs font-bold text-secondary">Sold Out</span>
                      ) : (
                        <button
                          onClick={() => buyOffer(pinnedOffer)}
                          disabled={!!buyingOfferId}
                          className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal disabled:opacity-40"
                        >
                          {buyingOfferId === pinnedOffer.id ? "..." : "Buy Now"}
                        </button>
                      );
                    })()}
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-secondary">
                  Stripe checkout · Your card never touches DUM Club. <span className="text-muted">Prices in USD; Stripe converts at checkout. The seller handles refunds and questions.</span>
                </p>
                </div>
              ) : null}
            </div>
          )}
        </div>

      )}

      {/* Cover banner — image-forward hero strip when the merchant has
          uploaded one (business_profiles.cover_image_url, mig 072).
          Renders nothing when absent → existing storefronts continue to
          look exactly as before this PR. */}
      {/* ── Owner console (Manage shop) ── light dashboard: header, KPIs,
           offers list, recent orders, and quick actions, all on real data.
           Reuses the existing offer form, embed wizard, go-live host, and
           publish toggle (still mounted below this block). Shown only when
           the owner opened Manage shop on an offline shop. */}
      {isOwner && ownerManage && !project?.is_live && (() => {
        const cMono = (projectName.trim().charAt(0) || "•").toUpperCase();
        const cLoc = [
          ownerBizProfile?.city || ownerBizProfile?.location_city,
          ownerBizProfile?.region || ownerBizProfile?.location_state,
        ].filter(Boolean).join(", ");
        const cActive = offers.filter((o) => o.is_active);
        const featuredId = project?.pinned_offer_id || null;
        const featuredOffer = cActive.find((o) => o.id === featuredId) || null;
        const nowMs = Date.now();
        const WEEK = 7 * 24 * 60 * 60 * 1000;
        const within = (iso: string) => nowMs - new Date(iso).getTime() < WEEK;
        const ordersWk = sellerOrders.filter((o) => within(o.created_at)).length;
        const revenue = sellerOrders.reduce((s, o) => s + Number(o.amount_paid_usd || 0), 0);
        const revenueWk = sellerOrders.filter((o) => within(o.created_at)).reduce((s, o) => s + Number(o.amount_paid_usd || 0), 0);
        const fmtK = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);
        const ago = (iso: string) => {
          const d = nowMs - new Date(iso).getTime();
          const m = Math.floor(d / 60000);
          if (m < 1) return "just now";
          if (m < 60) return `${m}m ago`;
          const h = Math.floor(m / 60);
          if (h < 24) return `${h}h ago`;
          return `${Math.floor(h / 24)}d ago`;
        };
        const ordersFor = (oid: string) => sellerOrders.filter((o) => o.offer_id === oid);
        const recent = [...sellerOrders]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 4);
        const published = project?.status === "live";
        const Kpi = ({ label, value, sub }: { label: string; value: string | number; sub?: string | null }) => (
          <div className="rounded-2xl border border-default bg-surface-card p-4 shadow-sm sm:p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">{label}</div>
            <div className="mt-1.5 text-2xl font-black text-brand-navy sm:text-3xl">{value}</div>
            {sub ? <div className="mt-1 text-[11px] font-semibold text-mint-text">{sub}</div> : <div className="mt-1 text-[11px] text-transparent">·</div>}
          </div>
        );
        return (
          <div className="mb-8 space-y-5">
            {/* Header */}
            <div className="rounded-3xl border border-default bg-surface-card p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-default bg-surface-muted text-2xl font-extrabold text-mint-text">
                    {logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoSrc} alt="" className="h-full w-full object-cover" onError={() => setLogoSrc(null)} />
                    ) : (
                      cMono
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">{projectName}</h1>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${published ? "bg-brand-teal-soft text-brand-teal" : "bg-surface-muted text-secondary"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${published ? "bg-mint-text" : "bg-muted"}`} />
                        {published ? "Live & accepting orders" : "Draft"}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-secondary">dum.club/{project.slug}{cLoc ? ` · ${cLoc}` : ""}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => scrollToSection("project-live-host")} className="inline-flex items-center gap-1.5 rounded-xl bg-state-live px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" /> Go Live
                  </button>
                  <button type="button" onClick={() => setOwnerManage(false)} className="rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-strong">
                    👁 View as customer
                  </button>
                </div>
              </div>
            </div>

            {/* KPIs (real data) */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Kpi label="Orders" value={sellerOrders.length} sub={ordersWk > 0 ? `▲ ${ordersWk} this week` : null} />
              <Kpi label="Revenue" value={fmtK(revenue)} sub={revenueWk > 0 ? `▲ ${fmtK(revenueWk)} this week` : null} />
              <Kpi label="Followers" value={favoriteCount} sub={null} />
              <Kpi label="Live offers" value={cActive.length} sub={featuredId ? "1 featured" : null} />
            </div>

            {/* Featured band — the pinned offer that shows first the moment
                the merchant goes live (ties to handlePinOffer + the Live Flow
                "Now featuring" card). */}
            <div className="rounded-3xl border border-default bg-dum-navy-card p-5 text-white shadow-sm sm:p-6">
              {featuredOffer ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                      {featuredOffer.primary_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(featuredOffer.primary_image_url)} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }} />
                      ) : (
                        <span className="text-lg text-dum-live-accent">★</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-dum-live-accent">★ Featured in your live shows</div>
                      <div className="mt-1 truncate text-base font-bold text-white">{featuredOffer.title}</div>
                      <div className="mt-0.5 text-[12px] text-white/60">${Number(featuredOffer.price_usd).toFixed(0)} · pinned · shows first when you go live</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" onClick={() => scrollToSection("manage-offers")} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15">Change</button>
                    <button type="button" disabled={pinningOfferId !== null} onClick={() => handlePinOffer(null)} className="rounded-xl border border-white/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50">{pinningOfferId === "__unpin__" ? "Unpinning…" : "Unpin"}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-dum-live-accent">★ Featured in your live shows</div>
                    <div className="mt-1 text-base font-bold text-white">Pin a featured item</div>
                    <div className="mt-0.5 text-[12px] text-white/60">Pick one offer to feature. It shows first the moment you go live.</div>
                  </div>
                  <button type="button" onClick={() => scrollToSection("manage-offers")} className="rounded-xl bg-mint-fill px-4 py-2.5 text-sm font-bold text-mint-fill-ink transition hover:opacity-90 sm:shrink-0">Choose an offer</button>
                </div>
              )}
              {pinError && <p className="mt-3 text-[12px] text-coral">{pinError}</p>}
            </div>

            {/* Offers + right column */}
            <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
              <div id="manage-offers" className="scroll-mt-28 rounded-3xl border border-default bg-surface-card p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <h2 className="text-lg font-bold text-brand-navy">Your offers</h2>
                    <span className="text-xs text-secondary">{cActive.length} live</span>
                  </div>
                  <button type="button" onClick={() => openOfferForm()} className="rounded-xl bg-mint-fill px-4 py-2 text-sm font-bold text-mint-fill-ink transition hover:opacity-90">
                    + Add offer
                  </button>
                </div>
                {cActive.length === 0 ? (
                  <p className="mt-6 text-center text-sm text-muted">No offers yet. Add your first one.</p>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {cActive.map((o) => {
                      const os = ordersFor(o.id);
                      const pinned = o.id === featuredId;
                      const inFlight = pinningOfferId === o.id;
                      const typeLabel = o.offer_type === "physical_product" ? "Product" : "Service";
                      return (
                        <div key={o.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-surface-card transition ${pinned ? "border-mint-fill" : "border-default"}`}>
                          {/* Image area — every card has one (gradient placeholder when no photo). */}
                          <div className="relative h-32 w-full bg-gradient-to-br from-surface-muted to-mint-card">
                            {o.primary_image_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={resolveImageUrl(o.primary_image_url)} alt="" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }} />
                            )}
                            {pinned && (
                              <span className="absolute left-2 top-2 rounded-full bg-dum-navy-card px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-dum-live-accent">★ Pinned</span>
                            )}
                            <span className="absolute right-2 top-2 rounded-full bg-surface-card/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-secondary">{typeLabel}</span>
                          </div>
                          {/* Body — flex-1 so cards in a row stay equal height. */}
                          <div className="flex flex-1 flex-col p-4">
                            <div className="flex items-start justify-between gap-2">
                              <span className="line-clamp-1 text-sm font-bold text-brand-navy">{o.title}</span>
                              <span className="shrink-0 font-mono text-sm font-bold text-brand-navy">${Number(o.price_usd).toFixed(0)}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-secondary">{os.length} order{os.length === 1 ? "" : "s"}</div>
                            {/* Actions — two equal buttons: Pin (Pinned ✓ when active) + Edit. */}
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                disabled={pinningOfferId !== null}
                                onClick={() => handlePinOffer(pinned ? null : o.id)}
                                aria-pressed={pinned}
                                className={`rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${pinned ? "bg-mint-card text-mint-text" : "bg-mint-fill text-mint-fill-ink hover:opacity-90"}`}
                              >
                                {inFlight ? "…" : pinned ? "Pinned ✓" : "Pin"}
                              </button>
                              <button type="button" onClick={() => openOfferForm(o)} className="rounded-lg border border-default px-3 py-2 text-xs font-semibold text-primary transition hover:border-strong">
                                Edit
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                {/* Recent orders */}
                <div className="rounded-3xl border border-default bg-surface-card p-5 shadow-sm sm:p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold text-brand-navy">Recent orders</h2>
                    <button type="button" onClick={() => scrollToSection("section-orders")} className="text-xs font-semibold text-mint-text hover:underline">View all</button>
                  </div>
                  {recent.length === 0 ? (
                    <p className="mt-4 text-sm text-muted">No orders yet.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {recent.map((o) => (
                        <div key={o.id} className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-secondary">
                            {(o.buyer_email || "?").trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-brand-navy">{o.offers?.title || "Offer"}</div>
                            <div className="truncate text-[11px] text-secondary">{(o.buyer_email || "Customer").split("@")[0]} · {ago(o.created_at)}</div>
                          </div>
                          <div className="shrink-0 font-mono text-sm font-bold text-brand-navy">${Number(o.amount_paid_usd).toFixed(0)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add DUM Live to your site */}
                <div className="rounded-3xl border border-default p-5 text-white shadow-sm sm:p-6" style={{ background: "linear-gradient(135deg,#0b3a29,#07271c)" }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-mint-fill/40 text-mint-fill">◎</span>
                    <h2 className="text-base font-bold text-white">Add DUM Live to your site</h2>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-white/70">Embed live video, flash offers, Stripe checkout, and loyalty on your own site. Setup under 5 minutes.</p>
                  <button type="button" onClick={() => { setEmbedActivePath("guided"); setEmbedModalOpen(true); }} className="mt-3 w-full rounded-xl bg-mint-fill px-4 py-2.5 text-sm font-bold text-mint-fill-ink transition hover:opacity-90">
                    Activate DUM Live
                  </button>
                </div>

                {/* Store link */}
                <div className="rounded-3xl border border-default bg-surface-card p-5 shadow-sm sm:p-6">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Store link</div>
                  <button type="button" onClick={() => { const u = window.location.href.split("?")[0]; navigator.clipboard?.writeText(u); }} className="mt-3 w-full rounded-xl border border-default bg-surface-muted px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-strong">
                    🔗 Copy store link
                  </button>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Link href="/dashboard" className="rounded-xl border border-default px-4 py-2.5 text-center text-sm font-semibold text-primary transition hover:border-strong">Edit project</Link>
                    <button type="button" onClick={() => togglePublish()} className="rounded-xl border border-default px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-strong">{published ? "Unpublish" : "Publish"}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {ownerBizProfile?.cover_image_url && (
        <div
          id="section-top-cover"
          className={`mb-6 h-32 w-full overflow-hidden rounded-3xl border border-default bg-surface-card sm:h-48 ${project?.is_live && isIVSSession(project) ? "hidden" : ""} ${isOwner && ownerManage ? "hidden" : ""}`}
          style={{
            backgroundImage: `url(${ownerBizProfile.cover_image_url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          role="img"
          aria-label={`${project?.title || project?.name || "Business"} cover image`}
        />
      )}

      <div
        id="section-top"
        className={`mb-8 rounded-3xl border border-default bg-surface-page p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8 ${project?.is_live && isIVSSession(project) ? "hidden" : ""} ${isOwner && ownerManage ? "hidden" : ""}`}
        style={{
          borderTop: `3px solid ${accent}`,
          boxShadow: `0 0 1px rgba(255,255,255,0.02), 0 0 40px rgba(0,255,178,0.06)`,
        }}
      >
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            {/* Avatar — merchant logo when supplied, emoji fallback for
                every existing merchant who hasn't set one. Backwards-compat:
                a null logo_url renders the same emoji avatar this card
                showed before P3. */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-default bg-surface-card text-3xl shadow-inner sm:h-20 sm:w-20 sm:text-4xl">
              {logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoSrc}
                  alt={`${project?.title || project?.name || "Business"} logo`}
                  loading="lazy"
                  // onError: if the logo URL 404s or fails to decode, drop
                  // back to the existing emoji avatar. Robust against bad
                  // seed data + missing CDN assets. The useEffect above
                  // resets logoSrc whenever ownerBizProfile.logo_url
                  // changes, so navigating between projects doesn't pin
                  // a prior project's failure on the next one.
                  onError={() => setLogoSrc(null)}
                  className="h-full w-full object-cover"
                />
              ) : (
                emoji
              )}
            </div>

            <div className="max-w-4xl">
              <div className="mb-3 text-xs uppercase tracking-[0.35em] text-muted">
                {category} · DUM Club
              </div>

              {loadingProject ? (
                <div className="h-10 w-72 animate-pulse rounded-lg bg-surface-muted sm:h-14" />
              ) : (
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold leading-tight text-brand-navy sm:text-5xl">
                    {projectName}
                  </h1>
                  {ownerBizProfile?.verification_status === "verified" && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-default bg-brand-teal-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-teal" title={`Verified business: ${ownerBizProfile.business_name}`}>
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 16 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" /></svg>
                      Verified
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-secondary">
                <span
                  className="rounded-full border px-3 py-1 text-xs uppercase tracking-[0.18em]"
                  style={{ borderColor: accent, color: accent }}
                >
                  {project ? `${verbLabelForProject(project)} · ${category}` : category}
                </span>
                {(() => {
                  // "City, ST" chip — shows only when the merchant has set a
                  // location. Absent fields render nothing, so storefronts
                  // without a location look exactly as before.
                  const loc = [
                    ownerBizProfile?.city || ownerBizProfile?.location_city,
                    ownerBizProfile?.region || ownerBizProfile?.location_state,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  return loc ? (
                    <span className="flex items-center gap-1 text-xs text-secondary">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-teal/70"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                      {loc}
                    </span>
                  ) : null;
                })()}
                {backendReviewCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-secondary">
                    <span className="text-amber-400">{"★".repeat(Math.round(backendAvgRating))}</span>
                    {backendAvgRating.toFixed(1)} ({backendReviewCount})
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); toggleFavorite(); }}
                  disabled={togglingFavorite}
                  className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                    isFavorited
                      ? "border-brand-teal/40 bg-brand-teal-soft text-brand-navy"
                      : "border-default text-secondary hover:border-strong hover:text-primary"
                  }`}
                >
                  {isFavorited ? "Following" : "Follow"}
                  {favoriteCount > 0 && <span className="opacity-70">· {favoriteCount}</span>}
                </button>
                {/* Message the shop — opens the existing GuestChat bubble via
                    a window event so a buyer can DM the host without
                    scrolling to the floating button. */}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); window.dispatchEvent(new Event("dum:message-shop")); }}
                  className="flex items-center gap-1.5 rounded-full border border-default px-3.5 py-1 text-xs font-semibold text-secondary transition hover:border-strong hover:text-primary"
                >
                  Message
                </button>
                {offers.length > 0 && (
                  <span className="text-xs text-secondary">
                    {offers.length} offer{offers.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

            </div>
          </div>

          <div className="w-full space-y-3 lg:w-80">

              <div className="rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-muted p-5">
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                  {/* Live-state dot. Animated ping only when the
                      project is actually broadcasting — keeping
                      the ping on offline projects was the visual
                      "still LIVE" bug after End Stream. */}
                  <span className="relative flex h-2 w-2">
                    {project?.is_live && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        project?.is_live ? "bg-brand-teal" : "bg-muted"
                      }`}
                    />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-widest text-brand-teal">
                    {isOwner
                      ? project?.is_live
                        ? "Your Business · Live"
                        : "Your Business"
                      : project?.is_live
                        ? "Live Business"
                        : "Business"}
                  </span>
                  <span className="rounded-full border border-default px-2.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-secondary">
                    {categoryLabel}
                  </span>
                  {ownerBizProfile?.verification_status === "verified" && (
                    <span className="rounded-full border border-default bg-brand-teal-soft px-2.5 py-0.5 text-[9px] font-semibold text-brand-teal">
                      ✓ Verified
                    </span>
                  )}
                </div>
                {/* Quick stats */}
                {offers.length > 0 && (
                  <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-secondary">
                    <span className="flex items-center gap-1.5">
                      <span className="text-brand-teal">◆</span>
                      {offers.length} offer{offers.length > 1 ? "s" : ""} available
                    </span>
                    {(() => {
                      const totalSold = offers.reduce((sum, o) => sum + (o.quantity_sold || 0), 0);
                      return totalSold > 0 ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-brand-teal">●</span>
                          {totalSold} purchased
                        </span>
                      ) : null;
                    })()}
                    <span className="flex items-center gap-1.5">
                      <span className="text-brand-teal">%</span>
                      DUM Points accepted
                    </span>
                  </div>
                )}

                {/* Price anchor removed (storefront fix): the "From $X"
                    placeholder undersold the shop and read as the whole
                    business's price. Pricing lives on each offer card in
                    the grid below. */}

                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => scrollToSection("offers-section")} className="flex items-center justify-center rounded-xl bg-brand-teal px-5 py-3.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover hover:">
                    {offers.length > 0 ? `Browse ${offers.length} Offer${offers.length > 1 ? "s" : ""} ↓` : "View Offers ↓"}
                  </button>
                  {/* Mobile: render only the share menu (full-width).
                      Desktop: 2-column grid with Ask AI + Share. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ENABLE_AI_FEATURES && (
                    <button type="button" onClick={() => scrollToSection("ai-workspace")} className="hidden items-center justify-center rounded-xl border border-default px-4 py-3 text-sm text-primary transition hover:border-strong hover:text-primary sm:flex">
                      Ask AI
                    </button>
                    )}
                    <div className="relative" ref={shareMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShareMenuOpen((o) => !o)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-default px-4 py-3 text-sm text-primary transition hover:border-default hover:text-brand-teal"
                      >
                        {shareCopied ? "✓ Copied!" : "Share"}
                      </button>
                      {shareMenuOpen && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-default bg-surface-card p-1.5 shadow-xl">
                          <button
                            type="button"
                            onClick={() => {
                              const url = window.location.href.split("?")[0];
                              navigator.clipboard.writeText(url).then(() => {
                                setShareCopied(true);
                                setShareMenuOpen(false);
                                setTimeout(() => setShareCopied(false), 2000);
                              });
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary transition hover:bg-surface-muted hover:text-white"
                          >
                            Copy link
                          </button>
                          <a
                            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out ${projectName} on DUM Club`)}&url=${encodeURIComponent(typeof window !== "undefined" ? window.location.href.split("?")[0] : "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setShareMenuOpen(false)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary transition hover:bg-surface-muted hover:text-white"
                          >
                            Share on X
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              const url = window.location.href.split("?")[0];
                              const text = `Check out ${projectName} on DUM Club\n${url}`;
                              if (navigator.share) {
                                navigator.share({ title: projectName, text, url }).catch(() => {});
                              } else {
                                navigator.clipboard.writeText(text).then(() => {
                                  setShareCopied(true);
                                  setTimeout(() => setShareCopied(false), 2000);
                                });
                              }
                              setShareMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary transition hover:bg-surface-muted hover:text-white"
                          >
                            More options
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>


              <>
                {/* Storefront view already renders its own "Ask AI" inside
                    the storefront card above, so we skip the duplicate
                    sidebar button on storefront pages. Other views
                    (analytics-disabled fallback, etc.) keep it. */}
                {Boolean(serviceProfile?.is_active) && (
                  <div className="rounded-xl border border-default bg-surface-muted px-4 py-3 text-center">
                    <div className="text-sm font-medium text-primary">
                      Interested? Send an inquiry.
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      The business will follow up. Use the chat at the bottom of the page.
                    </div>
                  </div>
                )}
                {isOwner && serviceProfile && (
                  <Link
                    href={`/project/${id}/manage`}
                    className="block w-full rounded-xl border border-default px-5 py-2 text-center text-xs text-muted transition hover:text-primary"
                  >
                    Manage existing bookings →
                  </Link>
                )}
              </>
          </div>
        </div>
      </div>

      {!(isOwner && ownerManage) && (() => {
        // While the project loads we can't tell whether a description
        // exists — keep the skeleton (and the #section-about anchor) so
        // the section doesn't flash hidden then reappear.
        if (loadingProject) {
          return (
            <div id="section-about" className="mb-8 rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm">
              <div className="mb-4 text-xs uppercase tracking-[0.3em] text-secondary">About</div>
              <div className="space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-surface-muted" />
              </div>
            </div>
          );
        }

        const aboutText = (project?.description || parsedAiOutput?.description || "").trim();
        // Auto-generated placeholders count as empty — they're not a
        // real description a customer should read.
        const aboutIsEmpty =
          !aboutText ||
          aboutText === "Auto-created from dashboard." ||
          aboutText.startsWith("Project workspace for ");

        if (aboutIsEmpty) {
          // Visitors (and owners previewing as a customer) see nothing —
          // an empty About block reads as an unfinished page. Owners get
          // an inline prompt to fill it in instead.
          if (!showOwnerInlineUi) return null;
          return (
            <div id="section-about" className="mb-8 rounded-3xl border border-dashed border-default bg-surface-card p-6 backdrop-blur-sm">
              <div className="mb-2 text-xs uppercase tracking-[0.3em] text-secondary">About</div>
              <p className="max-w-3xl text-sm leading-relaxed text-secondary">
                Add a short description so customers know what you offer. Only you can see this prompt.
              </p>
              <AboutDescriptionEditor
                projectId={project?.id || id}
                ownerId={authUser?.privyId || ""}
                onSaved={(text) =>
                  setProject((prev) => (prev ? { ...prev, description: text } : prev))
                }
              />
            </div>
          );
        }

        return (
          <div id="section-about" className="mb-8 rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm">
            <div className="mb-4 text-xs uppercase tracking-[0.3em] text-secondary">About</div>
            <p className="max-w-3xl text-base leading-relaxed text-primary">{aboutText}</p>
            {project?.prompt && (
              <p className="mt-4 text-sm text-secondary">
                Launched from the idea: &ldquo;{project.prompt}&rdquo;
              </p>
            )}
          </div>
        );
      })()}

      {/* ── FOUNDER CARD. Topgun Maintenance only (Phase 0B pilot) ──
           Hidden in Manage-shop mode (it's public storefront flavor). */}
      {project?.slug === "topgun-maintenance" && !(isOwner && ownerManage) && (
        <div className="mb-8 rounded-3xl border border-default border-l-2 border-l-brand-teal bg-surface-card p-6 backdrop-blur-sm">
          <div className="mb-4 text-xs uppercase tracking-[0.3em] text-secondary">Founding Merchant</div>
          <div className="flex items-start gap-5">
            <img
              src="/Julian.jpeg"
              alt="Julian Mero. founder, Topgun Maintenance LLC"
              className="h-20 w-20 shrink-0 rounded-full object-cover border-2 border-default"
            />
            <div className="flex-1 min-w-0">
              <div className="text-lg font-bold text-primary">Julian Mero</div>
              <div className="mt-0.5 text-sm text-primary">Founder · A&amp;P Certified Mechanic</div>
              <div className="mt-1 text-xs text-secondary">Morristown Municipal Airport (MMU) · NY NJ PA CT DE</div>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-default bg-brand-teal-soft px-4 py-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-teal">Verified Founding Merchant</span>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* ── Embedded Interactive Content ── */}
      {(() => {
        const templateId = parsedAiOutput?.template_id || matchTemplate(`${project?.title || ""} ${project?.description || ""}`);
        const tmpl = templateId ? TEMPLATES[templateId] : null;
        // Detect complex game ideas that have no template
        const textForDetect = `${project?.title || ""} ${project?.description || ""}`.toLowerCase();
        const isComplexGame = !tmpl && (
          textForDetect.includes("gta") || textForDetect.includes("open world") ||
          textForDetect.includes("first person") || textForDetect.includes("fps") ||
          textForDetect.includes("battle royale") || textForDetect.includes("mmorpg") ||
          textForDetect.includes("fortnite") || textForDetect.includes("minecraft") ||
          textForDetect.includes("call of duty") || textForDetect.includes("3d game") ||
          textForDetect.includes("multiplayer game") || textForDetect.includes("online game")
        );
        if (!tmpl && !isComplexGame) return null;
        if (isComplexGame) return (
          <div className="mb-8 rounded-3xl border border-default bg-gradient-to-r from-violet-500/[0.04] to-surface-card p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">🎮</span>
              <span className="text-sm font-bold text-primary">Entertainment Business</span>
            </div>
            <p className="text-sm leading-relaxed text-secondary">
              This is a premium experience business. Sell access passes, memberships, and exclusive content to your audience. Your storefront and offers are ready below.
            </p>
          </div>
        );
        return (
          <div className="mb-8 rounded-3xl border border-default bg-surface-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-default bg-surface-card px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{tmpl.emoji}</span>
                <span className="text-xs font-bold uppercase tracking-widest text-brand-teal">Interactive Experience + Storefront</span>
              </div>
              <div className="flex items-center gap-3">
                {!gameUnlocked && gamePlaysLeft > 0 && gamePlaysLeft < 4 && (
                  <span className="text-[10px] font-bold text-amber-400/70">
                    {gamePlaysLeft} free play{gamePlaysLeft === 1 ? "" : "s"} left
                  </span>
                )}
                {gameUnlocked && (
                  <span className="text-[10px] font-bold text-brand-teal">◆ Unlimited</span>
                )}
                <span className="hidden text-[9px] text-muted sm:inline">Arrow keys or touch</span>
                <button
                  type="button"
                  onClick={() => setEmbedExpanded((v) => !v)}
                  className="rounded-lg border border-default bg-surface-muted px-3 py-1 text-[10px] text-secondary transition hover:border-strong hover:text-primary"
                >
                  {embedExpanded ? "Collapse" : "Expand"}
                </button>
              </div>
            </div>

            {/* Game area with lock overlay */}
            <div
              className="relative"
              onClick={handleGameInteraction}
              onTouchStart={handleGameInteraction}
            >
              <iframe
                srcDoc={tmpl.html}
                sandbox="allow-scripts"
                className={`w-full border-0 transition-all duration-300 ${gameLocked ? "pointer-events-none blur-sm" : ""}`}
                style={{ height: embedExpanded ? "80vh" : 420, background: "#07071A" }}
                title={`${tmpl.label} interactive demo`}
              />

              {/* Lock overlay */}
              {gameLocked && !gameUnlocked && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-card backdrop-blur-sm">
                  <div className="mx-4 w-full max-w-sm rounded-2xl border border-default bg-surface-card p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
                    <div className="mb-3 text-3xl">🔒</div>
                    <h3 className="text-lg font-extrabold text-primary">Spend points to keep playing</h3>
                    <p className="mt-2 text-sm text-secondary">
                      You&apos;ve used your 3 free plays. Use DUM Points to unlock unlimited access.
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const pts = Number(localStorage.getItem("dum_points") || "0");
                        if (pts >= 10) {
                          unlockGameWithDum();
                        }
                      }}
                      className="mt-5 w-full rounded-xl bg-brand-teal px-6 py-3.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
                    >
                      ◆ Use 10 DUM Points
                    </button>
                    {Number(localStorage.getItem("dum_points") || "0") < 10 && (
                      <p className="mt-2 text-[11px] text-amber-400/70">
                        Not enough points. Earn more by launching projects and creating offers.
                      </p>
                    )}
                    <Link
                      href="/upgrade"
                      className="mt-3 block w-full rounded-xl border border-default px-6 py-3 text-sm text-primary transition hover:border-strong hover:text-primary"
                    >
                      Upgrade Membership
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-default px-5 py-2 text-center">
              <span className="text-[9px] text-muted">Powered by DUM Club</span>
            </div>
          </div>
        );
      })()}

      {/* ── DUM Hub Card ── */}
      <div className="mb-6 rounded-2xl border border-default bg-gradient-to-r from-brand-teal-soft to-surface-card p-5">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-secondary">
          <span className="flex items-center gap-1.5">💳 Stripe checkout</span>
          <span className="text-muted">·</span>
          <span className="flex items-center gap-1.5">◆ Earn DUM Points</span>
          <span className="text-muted">·</span>
          <span className="flex items-center gap-1.5">% 10% off with points</span>
          <span className="text-muted">·</span>
          <span className="text-muted">Works at every business</span>
        </div>
      </div>

      {/* ── Live + Offers side-by-side grid ──────────────────────
           Owner-only layout per the production owner-view audit:
           the live host preview + Go Live controls sit on the
           left, with the offers list and Add Offer on the right,
           so the merchant can pin / edit offers without losing
           sight of the live surface.

           On mobile (below lg) the grid collapses to a single
           column and the host stacks above offers, matching the
           directive's "Live video first, Offers second" rule.

           For non-owners (visitors) the IVS host condition
           ({isOwner && IVS_REALTIME_ENABLED && ...}) is falsy so
           the left column doesn't render and the layout
           gracefully reduces to a single offers column — same
           visual result as before the move.

           Hidden-during-IVS gate was previously on the offers
           section. We drop it for OWNERS so the merchant can
           still see + pin offers mid-broadcast. Visitors keep
           the hide-while-IVS behaviour because the live viewer
           card below already surfaces the pinned offer with
           a Buy button. */}
      <div className={
        isOwner
          ? "mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start"
          : ""
      }>
        {/* LEFT — IVS Host (must stay mounted across the live
            session. The component carries module-level state,
            so its DOM position here is purely visual; the
            broadcast lifecycle is unaffected by the move from
            its previous top-of-page slot.) */}
        {isOwner && IVS_REALTIME_ENABLED && (!project?.is_live || isIVSSession(project)) && (
          <div
            id="project-live-host"
            // L7: force a clean remount the instant a featured offer first
            // exists (pre-live). The dynamically-imported host was holding a
            // stale "no pinned offer" render and not reflecting the updated
            // pinnedOfferId prop, so the panel stayed stuck on the pin prompt
            // even though the storefront's FEATURED chip (same
            // project.pinned_offer_id) showed the offer. The key flips once
            // (empty -> ready) when a pin appears and then stays stable while
            // a pin exists OR the stream is live, so it never remounts
            // mid-broadcast.
            key={(project?.pinned_offer_id || project?.is_live) ? "host-ready" : "host-empty"}
            className={`scroll-mt-28 ${project?.is_live ? "" : "rounded-3xl border border-default bg-surface-card p-6"}`}
          >
            <IVSStageHost
              projectId={id as string}
              userId={authUser?.privyId || ""}
              autoStart={autoGoLive}
              // Advance to Start camera whenever a featured offer is set.
              // Prefer the resolved offer id, but fall back to the raw
              // project.pinned_offer_id — the SAME source the storefront's
              // FEATURED chip uses — so the gate can't read null while the
              // chip shows the offer (the resolved-only prop did exactly
              // that and left the panel stuck on the pin prompt).
              pinnedOfferId={pinnedOffer?.id ?? project?.pinned_offer_id ?? null}
              // Phase 2 grace-period rollout: lets the host check
              // /api/merchant/trial-status so it can replace the Go
              // Live button with a "Shop paused" notice when the plan
              // is suspended. The backend rejects with 402 either way.
              getToken={getToken}
              onLive={() => {
                setProject((prev) => prev ? { ...prev, is_live: true, live_provider: "ivs_realtime" } : prev);
                setLiveSalesCount(0);
              }}
              onEnd={() => {
                setProject((prev) => prev ? { ...prev, is_live: false, live_provider: null, ivs_stage_arn: null } : prev);
              }}
              onError={(msg) => setGoLiveError(msg)}
            />
            {/* Error surface for the onError callback above. The legacy
                Mux/camera panel used to be the only place goLiveError
                rendered; with that panel removed in the Mux isolation,
                this keeps host errors visible instead of set-and-lost. */}
            {goLiveError && (
              <div className="mt-3 rounded-xl border border-[var(--state-live)]/30 bg-state-live/5 px-4 py-3 text-sm text-state-live">{goLiveError}</div>
            )}

            {/* ── Host live chat. Mounted directly under the host's own
                 camera so the merchant can read and reply to viewers
                 without scrolling back up to the top of the page. Only
                 while actually live + on an IVS session; the non-owner
                 chat above is gated to !isOwner, so exactly one
                 LiveChatIVS is mounted for the host. */}
            {project?.is_live && isIVSSession(project) && (
              <div className="mt-4">
                <LiveChatIVS
                  projectId={id as string}
                  userId={authUser?.privyId || ""}
                  userName={authUser?.email || "Host"}
                  isHost={true}
                  onRequestSignIn={login}
                  getToken={getToken}
                  onCommentBuy={handleCommentBuy}
                  onViewerCountChange={setLiveViewerCount}
                  onItemUpdate={(data) => {
                    setOffers((prev) => prev.map((o) =>
                      o.id === data.offer_id
                        ? { ...o, quantity_sold: data.quantity_sold }
                        : o
                    ));
                  }}
                  onItemSold={(data) => {
                    loadOffers();
                    setLiveSalesCount((c) => {
                      const next = c + 1;
                      const toastId = `${data.offer_id}-${Date.now()}`;
                      setSaleToasts((prev) => [
                        ...prev.slice(-2),
                        { id: toastId, title: data.title || "Item", count: next },
                      ]);
                      setTimeout(() => {
                        setSaleToasts((prev) => prev.filter((t) => t.id !== toastId));
                      }, 4000);
                      return next;
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}

      {/* ── Offers (Public Storefront + Owner Tools) ──
           Side-by-side with the host block above for owners;
           single column otherwise. */}
      {/* Also hidden for the OWNER during an active IVS broadcast (not just
          other visitors) — a Whatnot-style live view keeps the camera, chat,
          and the "Sell a Product" picker front and center instead of the
          full catalog-management grid underneath it. */}
      <div id="offers-section" className={`scroll-mt-28 rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm sm:p-8 ${project?.is_live && isIVSSession(project) ? "hidden" : ""}`}>
        {!ownerManage && (<>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-mint-text">
              Your offers
            </span>
            {isDemo && (
              <span className="rounded-full border border-default bg-brand-teal-soft px-2 py-0.5 text-[9px] font-semibold uppercase text-brand-teal/60">
                Live Preview
              </span>
            )}
          </div>
          {showOwnerInlineUi && !offerFormOpen && (
            <button
              onClick={() => openOfferForm()}
              className="rounded-full border border-default bg-brand-teal-soft px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-brand-teal transition hover:border-default hover:text-brand-teal"
            >
              + Add Offer
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-brand-navy">What&apos;s for sale</h2>
            {(() => {
              const totalSold = offers.reduce((sum, o) => sum + (o.quantity_sold || 0), 0);
              return totalSold > 0 ? (
                <p className="mt-1 text-[12px] text-secondary">{totalSold} purchases · Stripe checkout · DUM Points accepted</p>
              ) : (
                <p className="mt-1 text-[12px] text-secondary">Stripe checkout · DUM Points accepted</p>
              );
            })()}
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-secondary">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-teal/60"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Secure
          </span>
        </div>
        <p className="mt-2 text-sm text-secondary">
          {isOwner ? "Products, services, and subscriptions for your customers" : "Browse what this business has to offer"}
        </p>
        </>)}

        {/* Owner-only: pin the offer that appears as "Now showing" in the
            embed and on the live storefront. Mirrors the existing in-stream
            pin chip control (line ~4210) but is visible while offline so
            the merchant can pin BEFORE going live. Visual is louder than
            the in-stream chips (filled emerald + ✓ PINNED label) because
            this surface is mobile-first and the in-stream version's
            10%-opacity emerald was too subtle to read on a phone screen
            in daylight. */}
        {isOwner && !ownerManage && offers.filter((o) => o.is_active).length > 0 && (
          <div className="mt-4 space-y-3 rounded-2xl border border-default bg-surface-card p-4">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-[0.2em] text-secondary">Featured offer</div>
              {project?.pinned_offer_id && (
                <button
                  onClick={() => handlePinOffer(null)}
                  disabled={pinningOfferId !== null}
                  className="text-[10px] uppercase tracking-wider text-secondary hover:text-primary disabled:opacity-40"
                >
                  Clear
                </button>
              )}
            </div>
            {/* Pin timer picker — how long the on-screen urgency countdown
                runs for viewers when this offer is featured. Hidden in the
                simplified offline Manage view (it only matters during a live
                stream, where the in-stream pin control offers the same
                picker); shown when live or in the non-manage view. */}
            <div className={`space-y-1.5 ${ownerManage && !project?.is_live ? "hidden" : ""}`}>
              <div className="text-[10px] uppercase tracking-wider text-muted">
                Countdown shown to viewers
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Pin timer duration">
                {PIN_DURATION_CHOICES.map((mins) => {
                  const active = pinDurationMinutes === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPinDurationMinutes(mins)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                        active
                          ? "border-brand-teal bg-brand-teal-soft text-brand-teal"
                          : "border-default text-secondary hover:border-strong hover:text-white"
                      }`}
                    >
                      {mins} min
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {offers.filter((o) => o.is_active).map((offer) => {
                const isPinned = offer.id === project?.pinned_offer_id;
                const isThisInFlight = pinningOfferId === offer.id;
                const anyInFlight = pinningOfferId !== null;
                return (
                  <button
                    key={offer.id}
                    onClick={() => handlePinOffer(isPinned ? null : offer.id)}
                    disabled={anyInFlight}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                      isPinned
                        ? "border-brand-teal bg-brand-teal-soft text-brand-teal ring-1 ring-brand-teal/30"
                        : "border-default text-secondary hover:border-strong hover:text-white"
                    }`}
                  >
                    {isPinned && <span className="mr-1">✓</span>}
                    {offer.title} · ${Number(offer.price_usd).toFixed(0)}
                    {isPinned && (
                      <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-brand-teal">
                        FEATURED
                      </span>
                    )}
                    {isThisInFlight && (
                      <span className="ml-2 text-[10px] text-secondary">…</span>
                    )}
                  </button>
                );
              })}
            </div>
            {pinError && (
              <div className="rounded-lg border border-[var(--state-live)]/30 bg-[var(--state-live)]/10 px-3 py-2 text-xs text-state-live">
                {pinError}
              </div>
            )}
            {project?.pinned_offer_id && !pinError && (
              <p className="text-[11px] text-secondary">
                Featured. Refresh the embed to see it as &quot;Now showing&quot;.
              </p>
            )}
          </div>
        )}

        {/* Owner-only: Add DUM Live to Your Website ─────────────────
            Merchant-first activation experience. The compact card is
            the only thing visible by default. clicking "Activate DUM
            Live" opens a wizard modal with four guided paths. All
            technical detail (script tag, iframe fallback, test.html)
            lives inside the Advanced tab. Default flow uses
            installation language, not developer language.

            Snippets are derived from window.location.origin at render
            time so the URL adapts to whatever domain serves this page
            (Vercel preview alias, production custom domain, localhost).
            No new dependencies. */}
        {showOwnerInlineUi && ownerHasSales && project?.slug && (() => {
          // Canonical host for production embed snippets. The apex
          // host (dum.club) is currently misconfigured at the
          // Vercel routing layer, so generated merchant snippets
          // must point at the www subdomain to guarantee the
          // embed-config and iframe loads route correctly. The
          // embed.js itself also hard-pins to www at runtime, so a
          // merchant who copied an older apex snippet still works
          // — but new copies should be on the canonical host so
          // the merchant's Network panel stays clean.
          //
          // Localhost dev is preserved: when the dashboard is
          // viewed at http://localhost:* the snippet uses the
          // local origin so the dev embed loop keeps working.
          const w = typeof window !== "undefined" ? window : null;
          const isLocal =
            !!w &&
            (w.location.hostname === "localhost" ||
              w.location.hostname === "127.0.0.1");
          const origin = isLocal ? w!.location.origin : "https://www.dum.club";
          const slug = project.slug as string;
          const scriptSnippet =
            `<script\n` +
            `  src="${origin}/embed.js"\n` +
            `  data-business-id="${slug}"\n` +
            `  async\n` +
            `></script>`;
          const iframeSnippet =
            `<iframe\n` +
            `  src="${origin}/embed/${slug}"\n` +
            `  width="100%"\n` +
            `  height="640"\n` +
            `  style="border:none;display:block;"\n` +
            `  allow="payment *; fullscreen *; clipboard-write *; popups *"\n` +
            `  sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"\n` +
            `></iframe>`;
          const previewUrl = `${origin}/embed/${slug}`;
          const testHtml =
            `<!doctype html>\n` +
            `<html>\n` +
            `<head><meta charset="utf-8"><title>Embed test</title></head>\n` +
            `<body style="font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 16px;">\n` +
            `  <h1>Test page</h1>\n` +
            `  <p>The DUM Live embed should appear below.</p>\n` +
            `  <script src="${origin}/embed.js" data-business-id="${slug}" async></script>\n` +
            `</body>\n` +
            `</html>`;

          // Plain-text install instructions for the Developer tab's
          // "Send to my developer" message. Email-friendly, no markup.
          const developerMessage =
            `Hi. I'd like to add a DUM Live storefront widget to our website.\n\n` +
            `It's a single line of code (a <script> tag) that I paste on a page. The widget shows our\n` +
            `live stream, products, and checkout. Customers stay on our domain; payments go through\n` +
            `our Stripe account directly.\n\n` +
            `Embed code:\n${scriptSnippet}\n\n` +
            `For React or Next.js sites, the iframe form below is easier to integrate:\n${iframeSnippet}\n\n` +
            `Preview URL (works as a regular page, no install needed):\n${previewUrl}\n\n` +
            `Steps:\n` +
            `  1. Open the website repo or page where DUM Live should appear.\n` +
            `  2. Paste the code above into the page.\n` +
            `  3. Commit / save / publish.\n` +
            `  4. Visit the page and confirm the widget loads.\n\n` +
            `Thanks!`;

          async function copyText(
            text: string,
            kind: "script" | "iframe" | "instructions" | "developer-msg"
          ) {
            try {
              await navigator.clipboard.writeText(text);
              setCopiedSnippet(kind);
              setTimeout(() => setCopiedSnippet(null), 1800);
            } catch {
              setCopiedSnippet(null);
            }
          }

          // Per-platform setup instructions for the Guided tab. Each
          // entry maps a merchant's website type to a one-line
          // instruction in their language. no iframe / script / JS
          // jargon in the default flow.
          // Q10. added a `mobileNote` per platform so a merchant
          // editing their site from a phone gets editor-specific
          // guidance. Mobile editors of these platforms diverge
          // meaningfully from desktop; without this hint the
          // desktop instruction sends a phone user looking for
          // controls that don't exist in the mobile app.
          const PLATFORMS: Array<{
            id: string;
            name: string;
            instruction: string;
            mobileNote?: string;
          }> = [
            {
              id: "wordpress",
              name: "WordPress",
              instruction:
                "On the page where you want it, add a Custom HTML block, then paste this in.",
              mobileNote:
                "On the WordPress mobile app: edit the page, tap +, choose Custom HTML.",
            },
            {
              id: "wix",
              name: "Wix",
              instruction:
                "Drag in an Embed Code element where you want it, then paste this in.",
              mobileNote:
                "On the Wix mobile app: tap Add → Embed Code → HTML iframe.",
            },
            {
              id: "shopify",
              name: "Shopify",
              instruction:
                "Open the page template in your theme editor and paste this into a Custom Liquid section.",
              mobileNote:
                "Shopify's theme editor is best on desktop. Open this on a laptop if you can.",
            },
            {
              id: "squarespace",
              name: "Squarespace",
              instruction:
                "Add a Code Block on the page and paste this in.",
              mobileNote:
                "On the Squarespace mobile app: edit the page, tap +, choose Code.",
            },
            {
              id: "webflow",
              name: "Webflow",
              instruction:
                "Drag an Embed element onto the page and paste this in.",
              mobileNote:
                "Webflow's editor is desktop-only. Open this on a laptop.",
            },
            {
              id: "developer",
              name: "GitHub / Vercel",
              instruction:
                "See the For Developers tab for the full repo and deploy instructions.",
            },
            {
              id: "custom",
              name: "Custom HTML",
              instruction:
                "Paste this just before </body>, or inside the section where you want it to appear.",
              mobileNote:
                "Same instructions work on most mobile editors. Paste into any HTML or Code block.",
            },
            {
              id: "unsure",
              name: "Not sure",
              instruction:
                "No worries. Use the Custom HTML method. It works on most websites.",
              mobileNote:
                "If you only have your phone, the Custom HTML method works in most mobile editors too.",
            },
          ];

          // Visual progress flow shown in Guided. Step state derives
          // implicitly from what the merchant has done: pick a
          // platform → copy code → paste → go live. Step 4 is always
          // a future step; no completion gate.
          const guidedStep =
            embedPlatform === null
              ? 1
              : copiedSnippet === "script"
              ? 3
              : 2;

          return (
            <>
              {/* Compact activation card. the only thing visible by
                  default. Replaces the previous developer-first panel
                  that exposed code immediately. Hidden in the owner console
                  (which has its own "Activate DUM Live"); the wizard modal
                  below stays mounted so the console button still opens it. */}
              <div className={`mt-4 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-5 sm:p-6 ${ownerManage ? "hidden" : ""}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-primary sm:text-xl">
                      Add DUM Live to Your Website
                    </h3>
                    <p className="mt-1 text-sm text-secondary">
                      Live video, pinned flash offers, Stripe checkout, and loyalty rewards, all on your own site.
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <button
                      type="button"
                      onClick={() => {
                        setEmbedActivePath("guided");
                        // Q9. on a phone, skip the 8-platform picker
                        // and pre-select Custom HTML. Mobile editors
                        // for WordPress / Wix / Shopify / Squarespace
                        // typically only expose a generic HTML / Code
                        // block anyway, so the platform-specific
                        // instructions buy little on a phone. they
                        // mostly add a step. The merchant can still
                        // tap "← Choose different website" to reveal
                        // the full picker.
                        const isMobile =
                          typeof window !== "undefined" &&
                          window.matchMedia("(max-width: 768px)").matches;
                        setEmbedPlatform(isMobile ? "custom" : null);
                        setEmbedModalOpen(true);
                      }}
                      className="w-full rounded-xl bg-mint-fill px-5 py-3 text-sm font-bold text-mint-fill-ink transition hover:opacity-90 sm:w-auto"
                    >
                      Activate DUM Live
                    </button>
                    <span className="text-[11px] text-secondary">
                      Usually takes less than 5 minutes
                    </span>
                  </div>
                </div>
              </div>

              {/* Activation wizard modal. Closes on backdrop click and
                  on the X button. Body scroll is not locked because the
                  surrounding page already has its own scroll context. */}
              {embedModalOpen && (
                <div
                  className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
                  onClick={() => setEmbedModalOpen(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Activate DUM Live"
                >
                  <div
                    className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-default bg-surface-card sm:rounded-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Header */}
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-default px-5 py-4">
                      <div>
                        <h2 className="text-base font-bold text-primary sm:text-lg">
                          Activate DUM Live
                        </h2>
                        <p className="text-xs text-secondary">
                          Add your live storefront to{" "}
                          <span className="text-primary">{project?.title || project?.name || slug}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEmbedModalOpen(false)}
                        aria-label="Close"
                        className="rounded-lg p-2 text-secondary transition hover:bg-surface-muted hover:text-primary"
                      >
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M5 5l10 10M15 5L5 15" />
                        </svg>
                      </button>
                    </div>

                    {/* Phase 4 of the installer audit. when the
                        merchant has confirmed the paste, the modal
                        flips to a celebration / next-action view
                        instead of re-rendering the install tabs.
                        The "Reinstall on a different page" link
                        clears the confirmation and reveals the
                        full wizard again. */}
                    {installConfirmed ? (
                      <div className="flex-1 overflow-y-auto px-5 py-8 sm:py-10">
                        <div className="mx-auto max-w-md text-center">
                          <div className="mb-4 inline-flex items-center justify-center rounded-full bg-brand-teal-soft px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                            ✨ Installed
                          </div>
                          <h3 className="text-2xl font-extrabold tracking-tight text-primary">
                            DUM Live is installed on your site.
                          </h3>
                          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-primary">
                            Customers can now see your live storefront whenever they visit the page where you pasted the code.
                          </p>

                          {/* Next-step nudges. Linking to surfaces
                              that already exist on this page so the
                              merchant doesn't have to navigate
                              elsewhere. clicking either button
                              closes the modal and lets the merchant
                              act inline. */}
                          <div className="mt-6 space-y-2">
                            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
                              What&apos;s next
                            </div>
                            <button
                              type="button"
                              onClick={() => setEmbedModalOpen(false)}
                              className="block w-full rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
                            >
                              Pin a flash deal →
                            </button>
                            <a
                              href={previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-full rounded-xl border border-default bg-surface-card px-5 py-3 text-sm font-medium text-primary transition hover:border-default hover:text-brand-teal"
                            >
                              Preview my live storefront
                            </a>
                          </div>

                          {/* Brand-stance closer. the activation
                              moment is the right place to lightly
                              echo "Drive your market. not platform
                              fees." Per direction this stays
                              supporting, not a headline. */}
                          <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal/70">
                            Drive your market, not platform fees.
                          </p>

                          <button
                            type="button"
                            onClick={resetInstall}
                            className="mt-6 text-[11px] text-secondary underline-offset-2 transition hover:text-primary hover:underline"
                          >
                            I want to reinstall on a different page
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>

                    {/* Tab nav. Wraps to 2x2 on narrow viewports. */}
                    <div className="flex shrink-0 flex-wrap gap-1 border-b border-default px-3 pt-2 sm:px-5">
                      {[
                        { id: "guided" as const, label: "Guided Setup" },
                        { id: "self" as const, label: "Install It Myself" },
                        { id: "advanced" as const, label: "Advanced" },
                        { id: "developer" as const, label: "For Developers" },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setEmbedActivePath(tab.id)}
                          className={`rounded-t-md px-3 py-2 text-[12px] font-medium transition sm:text-sm ${
                            embedActivePath === tab.id
                              ? "border-b-2 border-brand-teal text-brand-teal"
                              : "border-b-2 border-transparent text-secondary hover:text-primary"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab content (scrollable region) */}
                    <div className="flex-1 overflow-y-auto px-5 py-5 sm:py-6">

                      {/* ── GUIDED ─────────────────────────────────── */}
                      {embedActivePath === "guided" && (
                        <div className="space-y-5">
                          {/* Progress flow */}
                          <ol className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-secondary sm:gap-2 sm:text-xs">
                            {[
                              { n: 1, label: "Choose Website" },
                              { n: 2, label: "Copy Install" },
                              { n: 3, label: "Paste on Site" },
                              { n: 4, label: "Go Live" },
                            ].map((s, idx, arr) => {
                              const active = guidedStep === s.n;
                              const done = guidedStep > s.n;
                              return (
                                <li key={s.n} className="flex flex-1 items-center">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                        active
                                          ? "bg-brand-teal text-black"
                                          : done
                                          ? "bg-brand-teal-soft text-brand-teal"
                                          : "bg-surface-muted text-secondary"
                                      }`}
                                    >
                                      {done ? "✓" : s.n}
                                    </span>
                                    <span
                                      className={
                                        active
                                          ? "text-brand-teal"
                                          : done
                                          ? "text-secondary"
                                          : ""
                                      }
                                    >
                                      {s.label}
                                    </span>
                                  </div>
                                  {idx < arr.length - 1 && (
                                    <span className="mx-1 flex-1 border-t border-dashed border-default sm:mx-2" />
                                  )}
                                </li>
                              );
                            })}
                          </ol>

                          {/* Platform picker. shown until a platform is chosen */}
                          {embedPlatform === null && (
                            <div className="space-y-3">
                              <div>
                                <h4 className="text-sm font-bold text-primary">
                                  What kind of website do you have?
                                </h4>
                                <p className="text-xs text-secondary">
                                  We'll show you exactly where to paste.
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {PLATFORMS.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      if (p.id === "developer") {
                                        setEmbedActivePath("developer");
                                        return;
                                      }
                                      setEmbedPlatform(p.id);
                                    }}
                                    className="rounded-xl border border-default bg-surface-muted px-3 py-3 text-left text-sm text-primary transition hover:border-brand-teal hover:bg-brand-teal-soft"
                                  >
                                    {p.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Platform-specific install card */}
                          {embedPlatform !== null && (() => {
                            const p =
                              PLATFORMS.find((x) => x.id === embedPlatform) ||
                              PLATFORMS.find((x) => x.id === "custom")!;
                            return (
                              <div className="space-y-3">
                                <button
                                  type="button"
                                  onClick={() => setEmbedPlatform(null)}
                                  className="text-[11px] text-secondary transition hover:text-primary"
                                >
                                  ← Choose different website
                                </button>
                                <div className="rounded-xl border border-default bg-surface-muted p-4">
                                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-brand-teal">
                                    {p.name} install
                                  </div>
                                  <p className="text-sm text-primary">{p.instruction}</p>
                                  {p.mobileNote && (
                                    <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-secondary">
                                      <span aria-hidden="true">📱</span>
                                      <span>{p.mobileNote}</span>
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <button
                                    type="button"
                                    onClick={() => copyText(scriptSnippet, "script")}
                                    className="w-full rounded-xl bg-brand-teal px-5 py-4 text-sm font-bold text-black transition hover:bg-brand-teal"
                                  >
                                    {copiedSnippet === "script"
                                      ? "Copied. Now paste it on your site."
                                      : "Copy Install Code"}
                                  </button>
                                  <p className="mt-1.5 text-center text-[11px] text-secondary">
                                    Usually takes less than 5 minutes
                                  </p>
                                </div>

                                {/* Q3: 3-step "what happens next" reminder
                                    so the merchant knows to publish before
                                    visiting their site. The "publish before
                                    you test" trap (paste → check → blank
                                    → panic) is one of the most common
                                    install snags on WordPress / Squarespace. */}
                                <ol className="space-y-1.5 rounded-xl border border-default bg-black/40 p-3 text-[12px] text-primary">
                                  <li className="flex items-start gap-2">
                                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-teal-soft text-[10px] font-bold text-brand-teal">1</span>
                                    <span>Paste it on your page</span>
                                  </li>
                                  <li className="flex items-start gap-2">
                                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-teal-soft text-[10px] font-bold text-brand-teal">2</span>
                                    <span>Save / Publish</span>
                                  </li>
                                  <li className="flex items-start gap-2">
                                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-teal-soft text-[10px] font-bold text-brand-teal">3</span>
                                    <span>Visit your page to see it live</span>
                                  </li>
                                </ol>

                                {/* Q6: trust copy at the activation moment.
                                    Carries the merchant onboarding trust
                                    line into the install surface so the
                                    nervous merchant pasting payment-related
                                    code on their own site has the same
                                    reassurance they had when connecting
                                    Stripe. */}
                                <p className="text-center text-[11px] leading-relaxed text-secondary">
                                  1.5% sales fee per order · Your bank info goes to Stripe, never to DUM Club.
                                </p>

                                <a
                                  href={previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[12px] text-secondary transition hover:text-brand-teal"
                                >
                                  Preview what your storefront will look like →
                                </a>

                                {/* Q8. manual "I pasted it" affordance.
                                    Trust-based confirmation: clicking
                                    flips the modal to the celebration
                                    view via confirmInstall(). No
                                    automatic verification. the merchant
                                    audit's MVP scope explicitly held the
                                    real embed-detection backend work. */}
                                <div className="mt-2 rounded-xl border border-default bg-brand-teal-soft p-4">
                                  <p className="text-[12px] leading-relaxed text-primary">
                                    <span className="font-bold text-primary">Done pasting?</span>{" "}
                                    Click below to confirm. we&apos;ll mark your live storefront as installed.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={confirmInstall}
                                    className="mt-3 w-full rounded-xl border border-brand-teal bg-brand-teal-soft px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-brand-teal transition hover:border-brand-teal hover:bg-brand-teal-soft"
                                  >
                                    I pasted it on my site →
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* ── INSTALL IT MYSELF ──────────────────────── */}
                      {embedActivePath === "self" && (
                        <div className="space-y-5">
                          <div>
                            <h4 className="text-sm font-bold text-primary">
                              Four steps. No coding required.
                            </h4>
                          </div>

                          <ol className="space-y-3 text-sm text-primary">
                            <li className="rounded-xl border border-default bg-surface-muted p-4">
                              <div className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-teal text-xs font-bold text-black">1</span>
                                <div className="flex-1">
                                  <div className="font-semibold text-primary">Copy the install code</div>
                                  <button
                                    type="button"
                                    onClick={() => copyText(scriptSnippet, "script")}
                                    className="mt-2 w-full rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal sm:w-auto"
                                  >
                                    {copiedSnippet === "script" ? "Copied ✓" : "Copy Install Code"}
                                  </button>
                                </div>
                              </div>
                            </li>
                            <li className="rounded-xl border border-default bg-surface-muted p-4">
                              <div className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-primary">2</span>
                                <div className="flex-1">
                                  <div className="font-semibold text-primary">Paste it on your website</div>
                                  <p className="mt-0.5 text-xs text-secondary">
                                    Open your site editor and paste it on the page where you want the live storefront to appear.
                                  </p>
                                </div>
                              </div>
                            </li>
                            <li className="rounded-xl border border-default bg-surface-muted p-4">
                              <div className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-primary">3</span>
                                <div className="flex-1">
                                  <div className="font-semibold text-primary">Publish your changes</div>
                                  <p className="mt-0.5 text-xs text-secondary">
                                    Save and publish so your visitors can see it.
                                  </p>
                                </div>
                              </div>
                            </li>
                            <li className="rounded-xl border border-default bg-surface-muted p-4">
                              <div className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-bold text-primary">4</span>
                                <div className="flex-1">
                                  <div className="font-semibold text-primary">Preview my storefront</div>
                                  <p className="mt-0.5 text-xs text-secondary">
                                    Open your live storefront in a new tab to see exactly what your customers will see.
                                  </p>
                                  <a
                                    href={previewUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-2 inline-block rounded-xl border border-default px-4 py-2 text-sm text-primary transition hover:border-brand-teal hover:text-brand-teal"
                                  >
                                    Preview Storefront →
                                  </a>
                                </div>
                              </div>
                            </li>
                          </ol>
                        </div>
                      )}

                      {/* ── ADVANCED ───────────────────────────────── */}
                      {embedActivePath === "advanced" && (
                        <div className="space-y-5">
                          <div>
                            <h4 className="text-sm font-bold text-primary">Advanced setup</h4>
                            <p className="text-xs text-secondary">
                              Raw embed code, iframe fallback, and a local test page.
                              For technical users or when the platform restricts custom scripts.
                            </p>
                          </div>

                          {/* Script tag */}
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-teal">
                                Script tag <span className="text-muted">· recommended</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyText(scriptSnippet, "script")}
                                className="rounded-lg border border-default bg-brand-teal-soft px-3 py-1 text-[11px] font-bold text-brand-teal transition hover:border-brand-teal/70 hover:bg-brand-teal-soft"
                              >
                                {copiedSnippet === "script" ? "Copied ✓" : "Copy code"}
                              </button>
                            </div>
                            <pre className="overflow-x-auto rounded-xl border border-default bg-black p-3 text-[11px] leading-relaxed text-primary">
                              <code>{scriptSnippet}</code>
                            </pre>
                          </div>

                          {/* iframe fallback */}
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
                                iframe <span className="text-muted">· fallback for platforms that block scripts</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => copyText(iframeSnippet, "iframe")}
                                className="rounded-lg border border-default bg-transparent px-3 py-1 text-[11px] font-medium text-primary transition hover:border-strong hover:text-primary"
                              >
                                {copiedSnippet === "iframe" ? "Copied ✓" : "Copy iframe"}
                              </button>
                            </div>
                            <pre className="overflow-x-auto rounded-xl border border-default bg-black p-3 text-[11px] leading-relaxed text-primary">
                              <code>{iframeSnippet}</code>
                            </pre>
                          </div>

                          {/* Sizing & responsive notes */}
                          <div className="rounded-xl border border-default bg-surface-muted p-3 text-xs text-secondary">
                            <div className="mb-1 font-bold text-primary">Sizing &amp; responsive notes</div>
                            <ul className="space-y-0.5 text-[12px] leading-relaxed">
                              <li><span className="text-secondary">·</span> The script-tag widget auto-sizes to its parent container.</li>
                              <li><span className="text-secondary">·</span> The iframe fallback uses width:100% and a 640px min-height. Adjust as needed.</li>
                              <li><span className="text-secondary">·</span> Sandbox attributes are required. Stripe Checkout opens in a new tab via popups-to-escape-sandbox.</li>
                            </ul>
                          </div>

                          {/* test.html */}
                          <div className="space-y-2 rounded-xl border border-default bg-surface-muted p-3">
                            <div className="font-bold text-primary text-xs">
                              Local test page
                            </div>
                            <p className="text-[12px] text-secondary">
                              Save as <code className="rounded bg-surface-muted px-1 text-brand-teal">test.html</code> and open in any browser to verify the install before touching your real site.
                            </p>
                            <pre className="overflow-x-auto rounded-lg border border-default bg-black p-2 text-[11px] leading-relaxed text-primary">
                              <code>{testHtml}</code>
                            </pre>
                          </div>
                        </div>
                      )}

                      {/* ── FOR DEVELOPERS ─────────────────────────── */}
                      {embedActivePath === "developer" && (
                        <div className="space-y-5">
                          <div>
                            <h4 className="text-sm font-bold text-primary">For developers</h4>
                            <p className="text-xs text-secondary">
                              GitHub Pages, Vercel, Netlify, React, Next.js, or any custom developer-managed site.
                            </p>
                          </div>

                          <ol className="space-y-2 text-sm text-primary">
                            {[
                              "Open your website's repo in your editor.",
                              "Find the page or component where the live storefront should appear.",
                              "Paste the embed snippet (script tag for plain HTML pages, iframe for React / JSX).",
                              "Commit your changes.",
                              "Deploy.",
                              "Visit the page and verify the widget loads. Try Pay with Card to confirm Stripe routing.",
                            ].map((step, i) => (
                              <li key={i} className="flex items-start gap-3 rounded-lg border border-default bg-surface-muted p-3">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-bold text-secondary">{i + 1}</span>
                                <span className="text-[13px] leading-relaxed">{step}</span>
                              </li>
                            ))}
                          </ol>

                          <div className="rounded-xl border border-default bg-brand-teal-soft p-3 text-xs text-emerald-100/80">
                            <div className="mb-1 font-bold text-brand-teal">React / Next.js tip</div>
                            JSX doesn't accept a raw <code className="rounded bg-surface-muted px-1 text-brand-teal">&lt;script&gt;</code> tag inside components. Use the iframe form below. it drops in cleanly anywhere a JSX element is allowed.
                          </div>

                          {/* Snippet copies for devs */}
                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-teal">
                                Embed snippet (script)
                              </div>
                              <button
                                type="button"
                                onClick={() => copyText(scriptSnippet, "script")}
                                className="rounded-lg border border-default bg-brand-teal-soft px-3 py-1 text-[11px] font-bold text-brand-teal transition hover:border-brand-teal/70"
                              >
                                {copiedSnippet === "script" ? "Copied ✓" : "Copy code"}
                              </button>
                            </div>
                            <pre className="overflow-x-auto rounded-xl border border-default bg-black p-3 text-[11px] leading-relaxed text-primary">
                              <code>{scriptSnippet}</code>
                            </pre>
                          </div>

                          <div>
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
                                Embed snippet (iframe. JSX-safe)
                              </div>
                              <button
                                type="button"
                                onClick={() => copyText(iframeSnippet, "iframe")}
                                className="rounded-lg border border-default bg-transparent px-3 py-1 text-[11px] font-medium text-primary transition hover:border-strong hover:text-primary"
                              >
                                {copiedSnippet === "iframe" ? "Copied ✓" : "Copy iframe"}
                              </button>
                            </div>
                            <pre className="overflow-x-auto rounded-xl border border-default bg-black p-3 text-[11px] leading-relaxed text-primary">
                              <code>{iframeSnippet}</code>
                            </pre>
                          </div>

                          {/* Send to my developer */}
                          <div className="space-y-2 rounded-xl border border-default bg-surface-muted p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-bold text-primary">Send to my developer</div>
                              <button
                                type="button"
                                onClick={() => copyText(developerMessage, "developer-msg")}
                                className="rounded-lg border border-default bg-transparent px-3 py-1 text-[11px] font-medium text-primary transition hover:border-strong hover:text-primary"
                              >
                                {copiedSnippet === "developer-msg" ? "Copied ✓" : "Copy message"}
                              </button>
                            </div>
                            <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-default bg-black p-3 text-[11px] leading-relaxed text-primary">
                              <code>{developerMessage}</code>
                            </pre>
                            <p className="text-[11px] text-secondary">
                              Email-ready. Paste into a message to your dev or agency.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                      </>
                    )}

                    {/* Q7: minimum-viable escalation path. A merchant who
                        hits a snag during install (CMS strips scripts,
                        wrong page, CSP blocks iframe, etc.) should never
                        feel stuck without an exit. Single mailto link in
                        the footer covers that until a real support
                        infrastructure ships. */}
                    <div className="flex shrink-0 items-center justify-center border-t border-default px-5 py-3 text-[11px] text-secondary">
                      Stuck?{" "}
                      <a
                        href="mailto:julian@dum.club?subject=DUM%20Live%20install%20help"
                        className="ml-1 text-brand-teal underline-offset-2 transition hover:text-brand-teal hover:underline"
                      >
                        Email julian@dum.club →
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Demo mode indicator (section-level) */}

        {/* Checkout result banner */}
        {checkoutResult === "success" && (
          <div className="mt-4 rounded-xl border border-default bg-brand-teal-soft px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-brand-teal">
                  {isOwner && simulatedPurchase
                    ? `✓ Sale: "${simulatedPurchase}". $${simulatedRevenue.toFixed(2)} revenue`
                    : "Purchase successful! ✓"}
                </p>
                {!isOwner && (
                  <p className="mt-1 text-lg font-bold text-brand-teal">You earned DUM 🎉</p>
                )}
              </div>
              <button onClick={() => setCheckoutResult(null)} className="text-xs text-brand-teal/60 hover:text-brand-teal">×</button>
            </div>
            {!isOwner && (
              <p className="mt-2 text-xs text-brand-teal/60">
                Every purchase earns DUM Points. They are redeemable for discounts at any business on the DUM Club network.
              </p>
            )}
          </div>
        )}
        {checkoutResult === "cancelled" && (
          <div className="mt-4 rounded-xl border border-default bg-surface-muted px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-secondary">Checkout was cancelled</span>
            <button onClick={() => setCheckoutResult(null)} className="text-xs text-muted hover:text-primary">Dismiss</button>
          </div>
        )}

        {/* Owner: create/edit offer form (backend offers) */}
        {isOwner && offerFormOpen && offerEditing && (
          <div className="mt-5 rounded-2xl border border-default bg-surface-muted p-4 sm:p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-brand-teal">
              {offerEditing.id ? "Edit Offer" : "New Offer"}
            </div>
            {!offerEditing.id && (
              <ol className="rounded-xl border border-default bg-surface-card p-3 text-sm text-secondary space-y-1">
                <li><span className="font-bold text-primary">1.</span> Name what you sell.</li>
                <li><span className="font-bold text-primary">2.</span> Set a price.</li>
                <li><span className="font-bold text-primary">3.</span> Save. It goes live on your page.</li>
              </ol>
            )}
            <div>
              <input
                type="text"
                placeholder="Offer title"
                value={offerEditing.title || ""}
                onChange={(e) => setOfferEditing({ ...offerEditing, title: e.target.value })}
                className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
              />
              <button
                type="button"
                onClick={() => offerAiAssist("title")}
                disabled={offerAiField === "title"}
                className="mt-2 rounded-lg border border-default bg-brand-teal-soft px-3 py-1.5 text-[10px] font-medium text-brand-teal transition hover:border-default hover:text-brand-teal disabled:opacity-40"
              >
                {offerAiField === "title" ? "Generating..." : "✨ AI Title"}
              </button>
            </div>
            <div>
              <textarea
                placeholder="Description"
                value={offerEditing.description || ""}
                onChange={(e) => setOfferEditing({ ...offerEditing, description: e.target.value })}
                rows={3}
                className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40 resize-none"
              />
              <button
                type="button"
                onClick={() => offerAiAssist("description")}
                disabled={offerAiField === "description"}
                className="mt-2 rounded-lg border border-default bg-brand-teal-soft px-3 py-1.5 text-[10px] font-medium text-brand-teal transition hover:border-default hover:text-brand-teal disabled:opacity-40"
              >
                {offerAiField === "description" ? "Generating..." : "✨ AI Copy"}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.50"
                    placeholder="Price (USD)"
                    value={offerEditing.price_usd || ""}
                    onChange={(e) => setOfferEditing({ ...offerEditing, price_usd: Number(e.target.value) })}
                    className="flex-1 min-w-0 rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                  />
                  <button
                    type="button"
                    onClick={() => offerAiAssist("price")}
                    disabled={offerAiField === "price"}
                    className="shrink-0 rounded-xl border border-default bg-brand-teal-soft px-3 py-3 text-[10px] font-medium text-brand-teal transition hover:border-default hover:text-brand-teal disabled:opacity-40"
                  >
                    {offerAiField === "price" ? "..." : "$?"}
                  </button>
                </div>
                {/* Optional compare-at ("was") price — drives the strikethrough
                    on the live room offer card. Only applied when above the
                    actual price. */}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Compare-at price (optional)"
                  value={offerEditing.compare_at_price ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setOfferEditing({ ...offerEditing, compare_at_price: v === "" ? null : Number(v) });
                  }}
                  className="mt-2 w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
                <p className="mt-1 text-[10px] text-muted">Shown struck-through when higher than the price.</p>
              </div>
              <select
                value={offerEditing.offer_type || "digital_service"}
                onChange={(e) => setOfferEditing({ ...offerEditing, offer_type: e.target.value })}
                className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-sm text-primary outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
              >
                <option value="digital_service">Digital Service</option>
                <option value="physical_product">Physical Product</option>
              </select>
            </div>
            <input
              type="text"
              placeholder="Delivery info (e.g. Delivered via email within 24h)"
              value={offerEditing.delivery_info || ""}
              onChange={(e) => setOfferEditing({ ...offerEditing, delivery_info: e.target.value })}
              className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
            />
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Supporter discount % (0-100)"
              value={offerEditing.token_discount_percent || ""}
              onChange={(e) => setOfferEditing({ ...offerEditing, token_discount_percent: Number(e.target.value) })}
              className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
            />
            <div className="rounded-xl border border-default bg-surface-muted p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-secondary">Inventory</div>
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={offerEditing.unlimited_inventory ?? true}
                  onChange={(e) => setOfferEditing({ ...offerEditing, unlimited_inventory: e.target.checked })}
                  className="rounded border-default"
                />
                Unlimited inventory
              </label>
              {!offerEditing.unlimited_inventory && (
                <input
                  type="number"
                  min="1"
                  placeholder="Quantity available"
                  value={offerEditing.quantity_available || ""}
                  onChange={(e) => setOfferEditing({ ...offerEditing, quantity_available: Number(e.target.value) || null })}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
              )}
            </div>
            <div className="rounded-xl border border-default bg-surface-muted p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-secondary">Media (optional)</div>

              {/* Image upload */}
              <div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setOfferImageFile(file);
                      setOfferImagePreview(URL.createObjectURL(file));
                      setOfferEditing({ ...offerEditing, primary_image_url: "" });
                    }
                    // Reset so same file can be re-selected
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-default bg-surface-page px-4 py-4 text-sm text-secondary transition hover:border-default hover:text-primary active:scale-[0.98]"
                >
                  <span className="text-lg">📷</span>
                  <span className="text-left">
                    {offerImageFile ? offerImageFile.name : "Tap to upload image or take photo"}
                  </span>
                </button>
              </div>

              {/* Image preview (upload or existing URL) */}
              {(offerImagePreview || offerEditing.primary_image_url?.trim()) && (
                <div className="relative rounded-lg overflow-hidden border border-default">
                  <img
                    src={offerImagePreview || offerEditing.primary_image_url || ""}
                    alt="Preview"
                    className="w-full max-h-48 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setOfferImageFile(null);
                      setOfferImagePreview(null);
                      setOfferEditing({ ...offerEditing, primary_image_url: "" });
                    }}
                    className="absolute top-2 right-2 rounded-full bg-surface-page/70 px-2 py-0.5 text-xs text-secondary hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Fallback: paste URL */}
              {!offerImageFile && (
                <input
                  type="url"
                  placeholder="Or paste image URL"
                  value={offerEditing.primary_image_url || ""}
                  onChange={(e) => setOfferEditing({ ...offerEditing, primary_image_url: e.target.value })}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
              )}

              {/* Video URL */}
              <input
                type="url"
                placeholder="Video URL (YouTube, Loom, etc.)"
                value={offerEditing.video_url || ""}
                onChange={(e) => setOfferEditing({ ...offerEditing, video_url: e.target.value })}
                className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
              />
            </div>
            {offerSaveError && (
              <div className="rounded-xl border border-[var(--state-live)]/30 bg-state-live/5 px-4 py-3 text-sm text-state-live">
                {offerSaveError}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {(() => {
                // Auth-readiness gate. Disable the submit until
                // Privy has fully booted AND we have a signed-in
                // user. Prevents the "TypeError: Failed to fetch"
                // class of bug where saveOffer fires before
                // getToken() can return a real string.
                const authReady = !authLoading && !!authUser?.privyId;
                const disabled =
                  offerSaving ||
                  !offerEditing.title?.trim() ||
                  !offerEditing.price_usd ||
                  !authReady;
                const tooltip = !authReady
                  ? authLoading
                    ? "Signing you in. Try again in a moment."
                    : "Sign in to create an offer."
                  : undefined;
                return (
                  <button
                    type="button"
                    onClick={() => { setOfferSaveError(null); saveOffer(); }}
                    disabled={disabled}
                    title={tooltip}
                    aria-disabled={disabled}
                    className="w-full sm:w-auto rounded-xl bg-brand-teal px-5 py-3 text-sm font-semibold text-black transition hover:bg-brand-teal disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {offerSaving
                      ? "Saving..."
                      : offerEditing.id
                      ? "Save Changes"
                      : "Create Offer"}
                  </button>
                );
              })()}
              <button
                onClick={() => { setOfferFormOpen(false); setOfferEditing(null); setOfferImageFile(null); setOfferImagePreview(null); setOfferSaveError(null); }}
                className="w-full sm:w-auto rounded-xl border border-default px-5 py-3 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Offer save success toast */}
        {offerSaveSuccess && (
          <div className="mt-4 rounded-xl border border-default bg-brand-teal-soft px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-brand-teal">Offer created successfully!</span>
            <button onClick={() => setOfferSaveSuccess(false)} className="text-xs text-brand-teal/60 hover:text-brand-teal">Dismiss</button>
          </div>
        )}

        {/* Owner: add/edit form */}
        {isOwner && storeFormOpen && storeEditing && (
          <div className="mt-5 rounded-2xl border border-default bg-surface-muted p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-brand-teal">
              {storeEditing.id ? "Edit Offer" : "New Offer"}
            </div>
            <input
              type="text"
              placeholder="Name"
              value={storeEditing.name}
              onChange={(e) => setStoreEditing({ ...storeEditing, name: e.target.value })}
              className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
            />
            <textarea
              placeholder="Description"
              value={storeEditing.description}
              onChange={(e) => setStoreEditing({ ...storeEditing, description: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40 resize-none"
            />
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Price (e.g. $29)"
                value={storeEditing.price}
                onChange={(e) => setStoreEditing({ ...storeEditing, price: e.target.value })}
                className="flex-1 rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
              />
              <select
                value={storeEditing.type}
                onChange={(e) => setStoreEditing({ ...storeEditing, type: e.target.value as StoreItemType })}
                className="rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
              >
                <option value="digital">Digital</option>
                <option value="physical">Physical</option>
                <option value="service">Service</option>
                <option value="subscription">Subscription</option>
              </select>
            </div>
            {storeEditing.type === "subscription" && (
              <textarea
                placeholder="Benefits (one per line)"
                value={(storeEditing.benefits || []).join("\n")}
                onChange={(e) =>
                  setStoreEditing({
                    ...storeEditing,
                    benefits: e.target.value.split("\n").filter((l) => l.trim()),
                  })
                }
                rows={3}
                className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40 resize-none"
              />
            )}
            {/* Token perk fields */}
            {project?.token_mint_address && !isSimulatedToken(project.token_mint_address) && (
              <div className="rounded-xl border border-default bg-surface-muted p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-brand-teal/60">Token Perk (optional)</div>
                <input
                  type="number"
                  placeholder="Required token amount (e.g. 100)"
                  value={storeEditing.required_token_amount ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, required_token_amount: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
                <input
                  type="text"
                  placeholder="Perk description (e.g. 50% off for supporters)"
                  value={storeEditing.perk_description ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, perk_description: e.target.value || null })}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
                <input
                  type="text"
                  placeholder="Member price (e.g. Free or $9.99)"
                  value={storeEditing.token_holder_price ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, token_holder_price: e.target.value || null })}
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveStoreItem}
                className="rounded-xl bg-brand-teal px-4 py-2 text-sm font-semibold text-black transition hover:bg-brand-teal"
              >
                {storeEditing.id ? "Save Changes" : "Add Offer"}
              </button>
              <button
                onClick={() => { setStoreFormOpen(false); setStoreEditing(null); }}
                className="rounded-xl border border-default px-4 py-2 text-sm font-medium text-secondary transition hover:border-strong hover:text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Offers from offers table */}
        {offers.length > 0 && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {(() => {
              const bestSellerId = offers.reduce((best, o) => (o.quantity_sold || 0) > (best.quantity_sold || 0) ? o : best, offers[0]).id;
              // Best value = mid-tier by price (only when 3+ offers)
              const sorted = [...offers].sort((a, b) => Number(a.price_usd) - Number(b.price_usd));
              const bestValueId = sorted.length >= 3 ? sorted[Math.floor(sorted.length / 2)].id : "";
              const recommendedReasonLabel: Record<string, string> = {
                best_seller: "Recommended. Most purchased.",
                mid_tier: "Recommended. Best value.",
                cheapest: "Recommended. Most affordable.",
                premium: "Recommended. Covers the most",
                popular: "Recommended. Most popular.",
                pick: "Recommended for you",
                next: "Recommended",
                only: "Recommended",
              };
              return offers.map((offer) => {
              const isPopular = offer.id === bestSellerId && (offer.quantity_sold || 0) > 0;
              const isBestValue = !isPopular && offer.id === bestValueId;
              const isRecommended = recommendedOffer === offer.title;
              const typeBadge = offer.offer_type === "physical_product"
                ? { label: "Physical Product", color: "border-amber-400/30 text-amber-400 bg-amber-400/5" }
                : { label: "Digital Service", color: "border-sky-400/30 text-sky-400 bg-sky-400/5" };
              return (
                <div id={`offer-${offer.id}`} key={offer.id} className={`group rounded-2xl border bg-surface-card p-5 backdrop-blur-sm sm:p-6 flex flex-col transition hover: ${isRecommended ? "border-2 border-brand-teal" : isPopular ? "border-default hover:border-brand-teal" : isBestValue ? "border-sky-400/25 hover:border-sky-400/40" : "border-default hover:border-default"}`}>
                  {/* Header: badge + owner controls */}
                  <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isRecommended && (
                        <span className="rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-teal">
                          {recommendedReasonLabel[recommendedReason || ""] || "Recommended"}
                        </span>
                      )}
                      {isPopular && !isRecommended && (
                        <span className="rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-teal">
                          Most Popular
                        </span>
                      )}
                      {isBestValue && !isRecommended && (
                        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-400">
                          Best Value
                        </span>
                      )}
                      {isOwner && (
                        <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${typeBadge.color}`}>
                          {typeBadge.label}
                        </span>
                      )}
                      {offer.token_discount_percent > 0 && (
                        <span className="rounded-full border border-default bg-brand-teal-soft px-2.5 py-1 text-[10px] font-semibold text-brand-teal">
                          {offer.token_discount_percent}% off for supporters
                        </span>
                      )}
                    </div>
                    {showOwnerInlineUi && (
                      <OfferActionsMenu
                        isActive={offer.is_active}
                        onEdit={() => openOfferForm(offer)}
                        onToggleActive={() => toggleOfferActive(offer)}
                      />
                    )}
                  </div>

                  {/* Media */}
                  {offer.video_url ? (
                    <div className="mb-4 rounded-xl overflow-hidden border border-default bg-surface-muted aspect-video">
                      <iframe
                        src={offer.video_url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                        allowFullScreen
                        title={offer.title}
                      />
                    </div>
                  ) : offer.primary_image_url ? (
                    <div
                      className="mb-4 cursor-pointer rounded-xl overflow-hidden border border-default group/img"
                      onClick={() => setLightboxUrl(offer.primary_image_url!)}
                    >
                      <img
                        src={resolveImageUrl(offer.primary_image_url)}
                        alt={offer.title}
                        className="w-full aspect-[4/3] object-cover transition-transform duration-300 group-hover/img:scale-105"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = STOREFRONT_PLACEHOLDER; }}
                      />
                    </div>
                  ) : null}

                  {/* Content. title + price together */}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold text-primary leading-snug">{offer.title}</h3>
                    <div className="shrink-0 font-mono text-lg font-bold text-brand-teal">${Number(offer.price_usd).toFixed(0)}</div>
                  </div>
                  {offer.description && (
                    <p className="mt-2 text-sm text-secondary leading-relaxed">{offer.description}</p>
                  )}
                  {offer.delivery_info && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                      <span>↳</span><span>{offer.delivery_info}</span>
                    </div>
                  )}

                  {/* Inventory + social proof */}
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                    {(offer.quantity_sold || 0) > 0 && (
                      <span className="flex items-center gap-1 text-brand-teal">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-teal-soft" />
                        {offer.quantity_sold} purchased
                      </span>
                    )}
                    {!offer.unlimited_inventory && offer.quantity_available != null && (() => {
                        const remaining = offer.quantity_available - (offer.quantity_sold || 0);
                        if (remaining <= 0) return <span className="text-state-live">Sold out</span>;
                        if (remaining <= 5) return <span className="text-amber-400">{remaining} left</span>;
                        return <span>{remaining} available</span>;
                      })()}
                  </div>

                  {/* DUM Points discount — compacted from a full-width
                       green banner into a small inline note under the
                       price. Per CLAUDE.md doctrine, DUM Points are
                       hidden from public surfaces until Phase 2; the
                       hard-CTA button shouted about a feature that is
                       not yet promoted. The note still tells customers
                       the discount exists; the actual discount stays
                       wired through into checkout via the existing
                       dumDiscountApplied state for owners + earlier
                       paths that already set it. */}
                  {dumDiscountApplied[offer.id] ? (
                    <div className="mt-2 text-[11px] font-medium text-brand-teal">
                      ◆ 10% DUM discount applied
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] font-medium text-muted">
                      10% off with points
                    </div>
                  )}
                  {dumDiscountError && (
                    <div className="mt-2 text-[11px] text-amber-400/80">{dumDiscountError}</div>
                  )}

                  {/* Action */}
                  {(() => {
                    const soldOut = !offer.unlimited_inventory && offer.quantity_available != null && (offer.quantity_available - (offer.quantity_sold || 0)) <= 0;
                    const basePrice = Number(offer.price_usd);
                    const finalPrice = dumDiscountApplied[offer.id] ? basePrice * 0.9 : basePrice;
                    return (
                      <div className="mt-auto pt-4 border-t border-default mt-4">
                        {dumDiscountApplied[offer.id] && (
                          <div className="mb-3 flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-brand-teal">${finalPrice.toFixed(2)}</span>
                            <span className="font-mono text-xs text-muted line-through">${basePrice.toFixed(2)}</span>
                            <span className="text-[9px] text-brand-teal/60">DUM discount</span>
                          </div>
                        )}
                        {soldOut ? (
                          <div className="w-full rounded-xl bg-[var(--state-live)]/10 border border-[var(--state-live)]/30 px-5 py-3 text-center text-xs font-semibold text-state-live select-none">
                            Sold Out
                          </div>
                        ) : showOwnerInlineUi ? (
                          <button
                            onClick={() => openOfferForm(offer)}
                            className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-center text-[11px] font-semibold text-secondary transition hover:border-strong hover:text-primary"
                          >
                            Edit
                          </button>
                        ) : (
                          <>
                            <button
                              disabled={buyingOfferId === offer.id}
                              onClick={() => buyOffer(offer)}
                              className="w-full rounded-xl bg-brand-teal px-6 py-4 text-base font-bold uppercase tracking-[0.05em] text-black transition hover:bg-brand-teal-hover hover: active:scale-[0.98] disabled:opacity-60"
                            >
                              {buyingOfferId === offer.id && !(buyStep[offer.id] || "").startsWith("sol_")
                                ? "Opening secure checkout…"
                                : buyStep[offer.id] === "demo_success"
                                ? "✓ Purchased!"
                                : (() => {
                                    // Context-aware primary CTA. Schema only
                                    // distinguishes physical_product vs
                                    // digital_service today; service-typed
                                    // offers (most of Topgun's catalog) read
                                    // more naturally as "Book" than "Buy".
                                    const priceLabel = `$${dumDiscountApplied[offer.id] ? finalPrice.toFixed(0) : basePrice.toFixed(0)}`;
                                    if (offer.offer_type === "physical_product") {
                                      return `Buy ${priceLabel}`;
                                    }
                                    return `Book ${priceLabel}`;
                                  })()}
                            </button>
                            {/* Secondary CTA: pay with SOL. Feature-flagged
                                off by default. Stripe stays the primary
                                button above; this is intentionally smaller
                                and lower-contrast. Wrapped in the lazy
                                SolanaCheckoutButton render-prop so the
                                @solana/wallet-adapter chunk only loads
                                when SOL_CHECKOUT_ENABLED is true (dev /
                                preview only — gated short-circuit means
                                the chunk is never fetched in prod). */}
                            {SOL_CHECKOUT_ENABLED && (
                              <SolanaCheckoutButton>
                                {(sol) => (
                                  <button
                                    type="button"
                                    disabled={buyingOfferId === offer.id}
                                    onClick={() => payOfferWithSolHandler(offer, sol)}
                                    className="mt-2 w-full rounded-lg border border-default bg-transparent px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-secondary transition hover:border-default hover:text-brand-teal disabled:opacity-50"
                                    aria-label="Pay with Solana wallet"
                                  >
                                    {(() => {
                                      const step = buyStep[offer.id] || "";
                                      if (buyingOfferId === offer.id && step.startsWith("sol_")) {
                                        if (step === "sol_quoting") return "Quoting…";
                                        if (step === "sol_building") return "Building tx…";
                                        if (step === "sol_signing") return "Confirm in your wallet…";
                                        if (step === "sol_confirming") return "Waiting for network…";
                                        if (step === "sol_verifying") return "Verifying…";
                                        if (step === "sol_done") return "✓ Paid with SOL";
                                        return "Processing…";
                                      }
                                      return "or pay with SOL";
                                    })()}
                                  </button>
                                )}
                              </SolanaCheckoutButton>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {/* Demo purchase success feedback */}
                  {buyStep[offer.id] === "demo_success" && (
                    <div className="mt-3 rounded-lg border border-default bg-brand-teal-soft px-3 py-2 text-xs text-brand-teal">
                      ✓ Purchase simulated. ${Number(offer.price_usd).toFixed(2)} · +10 DUM Points earned
                    </div>
                  )}

                  {/* Error feedback */}
                  {buyError[offer.id] && (
                    <div className="mt-2 rounded-lg border border-[var(--state-live)]/30 bg-state-live/5 px-3 py-2 text-xs text-state-live">
                      {buyError[offer.id]}
                    </div>
                  )}
                </div>
              );
            });
            })()}
          </div>
        )}

        {/* Legacy store items (owner-only. not checkout-enabled) */}
        {isOwner && storeItems.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted">Legacy Items</span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold text-amber-400/60">Not purchasable</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {storeItems.map((item) => {
                const badge = storeTypeBadge[item.type];
                return (
                  <div key={item.id} className="rounded-2xl border border-dashed border-default bg-surface-card p-5 flex flex-col">
                    <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.color} opacity-60`}>
                        {badge.label}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => removeStoreItem(item.id)} className="rounded-lg px-2.5 py-1.5 text-[11px] text-muted transition hover:bg-surface-muted hover:text-state-live">Remove</button>
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-primary">{item.name}</h3>
                    {item.description && <p className="mt-1 text-sm text-secondary leading-relaxed line-clamp-2">{item.description}</p>}
                    <div className="mt-auto pt-4 flex items-center justify-between gap-3 border-t border-default mt-4">
                      <span className="font-mono text-base text-secondary">{item.price || "Free"}</span>
                      <button
                        onClick={() => convertStoreItemToOffer(item)}
                        className="rounded-lg border border-default bg-brand-teal-soft px-3 py-1.5 text-[11px] font-medium text-brand-teal transition hover:border-default hover:text-brand-teal"
                      >
                        Convert to Offer →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state. For visitors, a clean "Coming soon" with a way
            to reach the merchant — never blank gray bars. For the owner,
            a prompt to create their first offer. */}
        {offers.length === 0 && storeItems.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-default p-10 text-center">
            {isOwner ? (
              <>
                <div className="text-2xl mb-3 opacity-30">🛍</div>
                <p className="text-sm font-medium text-secondary">
                  You haven&apos;t listed any offers yet
                </p>
                {showOwnerInlineUi && !offerFormOpen && (
                  <button
                    onClick={() => openOfferForm()}
                    className="mt-4 rounded-xl border border-default bg-brand-teal-soft px-5 py-2.5 text-sm font-medium text-brand-teal transition hover:border-default hover:bg-brand-teal-soft"
                  >
                    + Post an item
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="text-lg font-bold text-primary">Coming soon</div>
                <p className="mt-2 text-sm text-secondary">
                  {projectName} is still setting up. Message them and they&apos;ll get back to you.
                </p>
                <a
                  href="#ai-workspace"
                  className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
                >
                  Contact this merchant →
                </a>
              </>
            )}
          </div>
        )}
      </div>
      </div>{/* /Live + Offers side-by-side grid */}

      {/* AI workspace — embedded textarea + response panel. Desktop only.
          On mobile the floating AiSalesChat bubble (rendered at the
          bottom of the page) is the single AI entry point. Hiding the
          workspace here also makes the scattered "Ask AI" anchor
          buttons on mobile dead links; those have been individually
          gated with `hidden sm:inline-flex` / `hidden sm:flex` to
          stop them rendering on mobile. */}
      {/* Desktop AI workspace. Collapsed-by-default so the storefront
          flow (offers → buy → live) leads the visual hierarchy on a
          fresh project visit. The floating AiSalesChat bubble that
          sits in the bottom-right of every page is still the always-on
          entry point for asking questions, so closing this card by
          default removes a large mid-page chrome block without losing
          the feature. Mobile already hid the workspace entirely (the
          floating bubble is the only AI surface on small screens).
          The "Ask AI" anchor buttons elsewhere on the page still
          target #ai-workspace; modern browsers open the matching
          <details> when scrollIntoView lands on a child node, so
          those affordances continue to work without changes. */}
      {/* 2E: "Ask AI about this business" is a buyer feature. Hide it
          for the owner until their first sale so a new merchant's page
          stays focused. Customers always see it; STATE_3+ owners keep
          it because the growth-AI chips above target #ai-workspace. */}
      {ENABLE_AI_FEATURES && (!showOwnerInlineUi || ownerHasSales) && !project?.is_live && (
      <details
        id="ai-workspace"
        className="group mb-8 hidden rounded-3xl border border-default bg-surface-card p-6 sm:block"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-base font-bold text-primary hover:text-brand-teal">
          <span>Ask AI about this business</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted group-open:hidden">Open</span>
          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted group-open:inline">Close</span>
        </summary>
        <div className="mt-6">
        {showOwnerInlineUi && (
          <>
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-muted">AI Assistant</div>

            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-xs uppercase tracking-[0.18em] text-brand-teal">
                {chatMeta.is_holder && chatMeta.holder_unlimited
                  ? "Unlimited AI"
                  : chatMeta.free_questions_left > 0
                  ? `${chatMeta.free_questions_left} free question${
                      chatMeta.free_questions_left === 1 ? "" : "s"
                    } remaining`
                  : "Upgrade for more"}
              </span>
            </div>

            <div className="mb-5 rounded-2xl border border-default bg-brand-teal-soft p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-brand-teal">Built-in AI</div>
              <div className="text-sm text-primary">
                {chatMeta.is_holder && chatMeta.holder_unlimited
                  ? `You have unlimited AI access for this business.`
                  : `Ask one free question about ${projectName}. Message the business directly for more.`}
              </div>
            </div>
          </>
        )}

        <h2 className="text-2xl font-bold text-primary">Ask AI</h2>

        <p className="mt-3 text-secondary">
          Ask anything about this business: services, pricing, availability. {chatMeta.free_limit} free question{chatMeta.free_limit === 1 ? "" : "s"} included.
        </p>

        {chatMeta.locked && (
          <div className="mt-5 rounded-2xl border border-default bg-surface-card p-5">
            <p className="text-sm text-secondary">{chatMeta.lock_message}</p>
            {chatMeta.contact_email && (
              <a
                href={`mailto:${chatMeta.contact_email}`}
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-brand-teal bg-brand-teal-soft px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-brand-teal transition hover:bg-brand-teal hover:text-brand-navy"
              >
                Email the business
              </a>
            )}
          </div>
        )}

        <form onSubmit={askAI} className="mt-6 space-y-4">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`Ask something about ${projectName}...`}
            rows={5}
            disabled={loadingAsk || chatMeta.locked}
            className="w-full rounded-2xl border border-default bg-surface-card px-4 py-3 text-primary outline-none transition focus:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/40 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loadingAsk || chatMeta.locked || !question.trim()}
            className="w-full rounded-2xl border border-default bg-surface-muted px-5 py-3 text-sm uppercase tracking-[0.18em] text-primary transition hover:bg-surface-muted disabled:opacity-50"
          >
            {loadingAsk ? "Asking..." : chatMeta.locked ? "Message the business" : "Ask AI"}
          </button>
        </form>

        <div className="mt-10">
          <h3 className="text-xl font-bold text-primary">AI Response</h3>

          <div className="mt-4 min-h-[220px] whitespace-pre-wrap rounded-2xl border border-default bg-surface-page p-4 text-primary">
            {response || (
              <span className="text-muted">
                Ask a question above. The AI knows this project deeply.
              </span>
            )}
          </div>
        </div>
        </div>
      </details>
      )}


      {/* ── OWNER TOOLS ──────────────────────────── */}
      {/* Hidden while actively live — the LIVE banner + camera already say
          everything "Shop status" would; a simplified broadcast view
          shouldn't repeat it underneath the offers grid. */}
      {showOwnerInlineUi && !project?.is_live && (
        <div className="mb-6 mt-2 flex items-center gap-4">
          <div className="h-px flex-1 bg-surface-muted" />
          <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted">Owner Tools</span>
          <div className="h-px flex-1 bg-surface-muted" />
        </div>
      )}

      {showOwnerInlineUi && !project?.is_live && (
        <div className="mb-8 rounded-2xl border border-default bg-surface-card p-4 text-sm text-primary">
          <span className="uppercase tracking-[0.18em] text-secondary">
            Shop status
          </span>
          <div className="mt-2 text-base text-primary">{statusBanner}</div>
        </div>
      )}


      {/* ── Legacy Live Control Panel (non-IVS only) ── */}
      {/* Carries id="project-live-host" so the AdminBar "Go Live" anchor
          and the ?golive=1 deep-link land on a REAL go-live control when
          IVS is disabled. The IVS host section above owns the same id
          when IVS is enabled; the two are mutually exclusive on
          IVS_REALTIME_ENABLED, so the id is never duplicated at runtime. */}
      {isOwner && !IVS_REALTIME_ENABLED && (
        <div id="project-live-host" className="scroll-mt-32 mb-8 rounded-3xl border border-default bg-surface-card p-6">

          {/* Selling controls. shown for non-IVS live providers only (IVS controls are in the banner) */}
          {project?.is_live && !isIVSSession(project) && (
            <div className="space-y-4">
              {/* Only show legacy live header when NOT using IVS (IVS has its own) */}
              {!isIVSSession(project) && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-state-live" />
                    </span>
                    <h2 className="text-xl font-bold text-primary">You're Live</h2>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-secondary">
                    <span>{liveSalesCount} sale{liveSalesCount !== 1 ? "s" : ""}</span>
                    <button
                      onClick={handleEndLive}
                      className="rounded-lg border border-[var(--state-live)]/30 bg-[var(--state-live)]/10 px-3 py-1.5 text-xs font-semibold text-state-live transition hover:bg-[var(--state-live)]/15"
                    >
                      End Stream
                    </button>
                  </div>
                </div>
              )}

              {/* Product selector. immediate access */}
              <div className="rounded-2xl border border-default bg-surface-muted p-4">
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-secondary">Sell a Product</div>
                <div className="flex flex-wrap gap-2">
                  {offers.filter((o) => o.is_active).map((offer) => (
                    <button
                      key={offer.id}
                      onClick={() => handlePinOffer(offer.id === project.pinned_offer_id ? null : offer.id)}
                      className={`rounded-xl border px-3 py-2 text-sm transition ${
                        offer.id === project.pinned_offer_id
                          ? "border-default bg-brand-teal-soft text-brand-teal"
                          : "border-default text-secondary hover:border-strong hover:text-white"
                      }`}
                    >
                      {offer.title} · ${Number(offer.price_usd).toFixed(0)}
                      {offer.id === project.pinned_offer_id && " (pinned)"}
                    </button>
                  ))}
                  {offers.filter((o) => o.is_active).length === 0 && (
                    <p className="text-sm text-muted">No offers yet. Create one from your dashboard.</p>
                  )}
                </div>
              </div>

              {/* Auction controls */}
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-4">
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-amber-400/70">Auction</div>
                {isAuctionActive && auction ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-primary">{auctionOffer?.title || "Auction"}</div>
                      <div className="text-xs text-secondary">{auction.bid_count} bids · {auctionCountdown}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-lg font-bold text-primary">${Number(auction.current_bid || auction.starting_price).toFixed(0)}</span>
                      <button onClick={() => handleCloseAuction(true)} className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-400/10">End</button>
                    </div>
                  </div>
                ) : auction && auction.status === "ended" ? (
                  <div className="text-sm text-secondary">Winner: {auction.current_bidder_display || "unknown"}. ${Number(auction.current_bid).toFixed(0)}</div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {offers.filter((o) => o.is_active).map((offer) => (
                        <button key={offer.id} onClick={() => setAuctionOfferSelect(offer.id === auctionOfferSelect ? null : offer.id)}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${offer.id === auctionOfferSelect ? "border-amber-400/40 text-amber-400" : "border-default text-secondary"}`}
                        >{offer.title}</button>
                      ))}
                    </div>
                    {auctionOfferSelect && (
                      <div className="flex items-center gap-2">
                        <input type="number" value={auctionStartPrice} onChange={(e) => setAuctionStartPrice(e.target.value)} placeholder="$10" className="w-20 rounded-lg border border-default bg-surface-muted px-2 py-1.5 text-xs text-primary outline-none" />
                        <select value={auctionDuration} onChange={(e) => setAuctionDuration(Number(e.target.value))} className="rounded-lg border border-default bg-surface-muted px-2 py-1.5 text-xs text-primary outline-none">
                          <option value={60}>1m</option><option value={120}>2m</option><option value={300}>5m</option>
                        </select>
                        <button onClick={handleStartAuction} disabled={auctionStarting} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black disabled:opacity-40">{auctionStarting ? "..." : "Start Auction"}</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* The legacy Mux/camera Go Live flow that rendered here was
              removed with the Mux isolation. On non-IVS builds the panel
              now only shows the live selling controls above for an
              already-live (manual_embed) session. */}
        </div>
      )}

      {/* ── Seller Sales (Owner Only) ──────────────── */}
      {/* Hidden while live — the orders ledger is a post-show task. */}
      {showOwnerInlineUi && !project?.is_live && (
        <details
          id="section-orders"
          // Collapsed by default so the (often long) ledger doesn't
          // dominate the Manage view. Opens only when the merchant
          // navigated here via the AdminBar's Orders link, which would
          // otherwise scroll to a collapsed section and read as broken.
          open={
            typeof window !== "undefined" &&
            window.location.hash === "#section-orders"
          }
          className="scroll-mt-28 mb-8 rounded-3xl border border-default bg-surface-card p-6 sm:p-8"
        >
          <summary className="flex cursor-pointer items-start justify-between gap-4 hover:text-primary">
            <div>
              <div className="mb-1 text-xs uppercase tracking-[0.3em] text-muted">
                Sales
              </div>
              <h2 className="text-2xl font-bold text-primary">Orders</h2>
              <p className="mt-2 text-sm text-secondary">
                Purchases from your offers
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-default bg-surface-page px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-secondary">
              {sellerOrders.length} {sellerOrders.length === 1 ? "order" : "orders"}
            </span>
          </summary>

          <div className="mt-4 rounded-lg border border-default bg-surface-muted px-3 py-2">
            <span className="text-[11px] text-muted">
              Your earnings go to your Stripe account after each sale. Need help? Contact support.
            </span>
          </div>

          {sellerOrders.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-default p-8 text-center">
              <p className="text-sm text-muted">No sales yet</p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {sellerOrders.map((order) => {
                const isPaid = order.status === "paid";
                const isDelivered = order.status === "delivered";
                return (
                  <div key={order.id} className="rounded-2xl border border-default bg-surface-page p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-primary truncate">
                          {order.offers?.title || "Offer"}
                        </h3>
                        <div className="mt-1 text-xs text-muted">
                          {order.buyer_email || "Anonymous buyer"} · {new Date(order.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-base font-bold text-primary">
                          ${Number(order.amount_paid_usd).toFixed(2)}
                        </div>
                        {(() => {
                          // Per-order Marketplace Fee breakdown, computed
                          // from data already on the row (no extra call).
                          // `seller_receives_usd` is the merchant's payout
                          // AFTER our 1.5% Marketplace Fee but BEFORE Stripe's
                          // own processing fee, which Stripe deducts on
                          // payout. gross - net here equals the Marketplace
                          // Fee, not the Stripe processing fee. Falls back
                          // to a plain copy line when the math isn't sensible
                          // (e.g. refund / pending row).
                          const gross = Number(order.amount_paid_usd || 0);
                          const net = Number(order.seller_receives_usd || 0);
                          const fee = Math.max(0, gross - net);
                          const breakdownOk = Number.isFinite(fee) && fee > 0 && Number.isFinite(net) && net > 0;
                          const tipMsg = breakdownOk
                            ? `Gross Sale $${gross.toFixed(2)} − Marketplace Fee $${fee.toFixed(2)} (1.5%) = Net Received $${net.toFixed(2)}. Marketplace Fee is deducted from your payout; the customer is not charged extra. Stripe's own processing fee is applied separately on payout.`
                            : "Net of Marketplace Fee. Stripe's processing fee is applied separately on payout.";
                          return (
                            <div
                              className="text-[10px] text-muted mt-0.5 inline-flex flex-col items-end gap-0.5"
                              title={tipMsg}
                            >
                              {breakdownOk ? (
                                <>
                                  <span>Marketplace Fee: −${fee.toFixed(2)}</span>
                                  <span className="inline-flex items-center gap-1">
                                    <span>Net Received: ${net.toFixed(2)}</span>
                                    <button
                                      type="button"
                                      aria-label={tipMsg}
                                      title={tipMsg}
                                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-default text-[9px] font-semibold text-muted hover:text-primary"
                                    >
                                      ?
                                    </button>
                                  </span>
                                </>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <span>Net Received: ${Number(order.seller_receives_usd || 0).toFixed(2)}</span>
                                  <button
                                    type="button"
                                    aria-label={tipMsg}
                                    title={tipMsg}
                                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-default text-[9px] font-semibold text-muted hover:text-primary"
                                  >
                                    ?
                                  </button>
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Shipping address (physical orders, captured at
                        checkout) + tracking — what the seller needs to
                        actually fulfill, and a record of what was shipped. */}
                    {(order.shipping_address || order.tracking_number) && (
                      <div className="mt-3 rounded-xl border border-default bg-surface-card px-3 py-2 text-[11px] text-secondary">
                        {order.shipping_address && (
                          <div>
                            <span className="font-semibold text-primary">Ship to: </span>
                            {[
                              order.shipping_address.name,
                              order.shipping_address.line1,
                              order.shipping_address.line2,
                              [order.shipping_address.city, order.shipping_address.state, order.shipping_address.postal_code]
                                .filter(Boolean)
                                .join(", "),
                            ]
                              .filter(Boolean)
                              .join(", ")}
                            {order.shipping_address.phone ? ` · ${order.shipping_address.phone}` : ""}
                          </div>
                        )}
                        {order.tracking_number && (
                          <div className="mt-0.5">
                            <span className="font-semibold text-primary">Tracking: </span>
                            <span className="font-mono">{order.tracking_number}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                        order.status === "fulfilled" || order.status === "delivered"
                          ? "border-default text-brand-teal bg-brand-teal-soft"
                          : order.status === "paid"
                          ? "border-sky-400/30 text-sky-400 bg-sky-400/10"
                          : order.status === "pending_payment"
                          ? "border-amber-400/30 text-amber-400 bg-amber-400/10"
                          : "border-default text-secondary"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          order.status === "fulfilled" || order.status === "delivered" ? "bg-brand-teal"
                          : order.status === "paid" ? "bg-sky-400"
                          : order.status === "pending_payment" ? "bg-amber-400"
                          : "bg-zinc-600"
                        }`} />
                        {order.status === "pending_payment" ? "Checkout not completed" : order.status}
                      </span>
                      <div className="flex items-center gap-2">
                        {order.status === "paid" && (
                          <button
                            onClick={() => {
                              // Optional tracking number on fulfill. Cancel
                              // aborts; OK (even blank) proceeds.
                              const t = window.prompt(
                                "Mark fulfilled. Add a shipment tracking number (optional):",
                                "",
                              );
                              if (t === null) return;
                              updateOrderStatus(order.id, "fulfilled", t.trim() || undefined);
                            }}
                            className="rounded-lg border border-default bg-brand-teal-soft px-3 py-1.5 text-[11px] font-medium text-brand-teal transition hover:border-default hover:text-brand-teal"
                          >
                            Mark Fulfilled
                          </button>
                        )}
                        {(order.status === "paid" || order.status === "fulfilled" || order.status === "delivered") && (
                          <button
                            onClick={() => refundOrder(order.id)}
                            className="rounded-lg border border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition hover:border-[var(--state-live)]/40 hover:text-state-live"
                          >
                            Refund
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </details>
      )}


      {/* ── AI Tools (Score + Builder. Analytics view) ────────────── */}


      {/* Store Status card — the owner's single launch-readiness signal
          and primary call to action. It collapses to one plain next step
          plus one big button so a non-technical owner knows exactly what
          to do in a few seconds. The old token/review "Submit for Review"
          flow is gone: review never published a store and only confused
          merchants. showOwnerInlineUi (isOwner && !viewAsCustomer) keeps
          this off the public/customer storefront. */}
      {showOwnerInlineUi && !ownerManage && !project?.is_live && (() => {
        const hasOffer = offers.length > 0;
        // Store "live" here means the storefront is PUBLISHED and shoppable
        // (status === "live") — the publication signal. This is deliberately
        // NOT is_live: is_live is the livestream/broadcast state, a separate
        // concept (the backend keeps them distinct — see projects.py: status
        // = public publication/discover visibility, is_live = broadcasting).
        // A store can be published with the livestream off, and vice versa.
        const storeIsLive = project?.status === "live";
        const rawDesc = (project?.description || "").trim();
        const descIsPlaceholder =
          !rawDesc ||
          rawDesc === "Auto-created from dashboard." ||
          rawDesc.startsWith("Project workspace for ");
        const { nextStep, primaryLabel, primaryAction } = deriveStoreStatusCta({ hasOffer, storeIsLive });
        const storeUrl =
          typeof window !== "undefined"
            ? `${window.location.origin}/project/${project?.slug || id}`
            : `/project/${project?.slug || id}`;
        // Primary action wires to the page's real flows — never a dead
        // button. Go Live targets the IVS host; the legacy camera flow
        // was removed with the Mux isolation, so non-IVS builds scroll
        // to the live panel anchor instead.
        const runPrimaryAction = () => {
          if (primaryAction === "add_offer") {
            openOfferForm();
            scrollToSection("offers-section");
          } else if (primaryAction === "go_live") {
            if (IVS_REALTIME_ENABLED) {
              setAutoGoLive(true);
            }
            scrollToSection("project-live-host");
          } else {
            copyToClipboard(storeUrl, "store link");
            setCopyFlash(true);
            window.setTimeout(() => setCopyFlash(false), 2000);
          }
        };
        const primaryClass =
          primaryAction === "go_live"
            ? "bg-state-live text-white hover:bg-red-400"
            : "bg-brand-teal text-black hover:bg-brand-teal-hover";
        return (
          <div className="mb-8 rounded-3xl border border-default bg-surface-card p-5 sm:p-6">
            <div className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
              Store Status
            </div>

            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-bold text-primary sm:text-3xl">{projectName}</h2>
              <span className="mt-1 shrink-0 rounded-full border border-default px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-secondary">
                Business
              </span>
            </div>

            <p className="mt-2 text-sm text-secondary">
              {descIsPlaceholder
                ? "Add a short description so customers know what you offer."
                : rawDesc}
            </p>

            <div className="mt-5 rounded-2xl border border-default bg-surface-page p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-muted">Next Step</div>
              <div className="mt-1.5 text-sm font-medium text-primary">{nextStep}</div>
            </div>

            {/* Publish Store toggle — flips the store between draft and
                published (status live). Publishing lists it on Discover
                and is separate from Go Live broadcasting: customers can
                buy a published store whether or not a stream is on.
                Shown once there is something to sell. */}
            {hasOffer && (
              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-default bg-surface-page p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-primary">
                    {storeIsLive ? "Your store is published" : "Your store is a draft"}
                  </div>
                  <div className="mt-0.5 text-xs text-secondary">
                    {storeIsLive
                      ? "Customers can find it on Discover and buy any time, stream or not."
                      : "Publish to list it on Discover. Customers can buy without you going live."}
                  </div>
                  {publishError && (
                    <div className="mt-1.5 text-xs text-state-live">{publishError}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={togglePublish}
                  disabled={publishing}
                  className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition active:scale-[0.99] disabled:opacity-60 ${
                    storeIsLive
                      ? "border border-default bg-surface-card text-secondary hover:text-primary"
                      : "bg-brand-teal text-black hover:bg-brand-teal-hover"
                  }`}
                >
                  {publishing ? "Saving…" : storeIsLive ? "Unpublish" : "Publish Store"}
                </button>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={runPrimaryAction}
                className={`w-full rounded-2xl px-6 py-3.5 text-center text-base font-bold transition active:scale-[0.99] sm:w-auto ${primaryClass}`}
              >
                {primaryAction === "copy_link" && copyFlash ? "Copied ✓" : primaryLabel}
              </button>
              <Link
                href="/dashboard"
                className="w-full rounded-2xl border border-default bg-surface-page px-6 py-3.5 text-center text-base font-semibold text-primary transition hover:bg-surface-muted sm:w-auto"
              >
                Edit Project
              </Link>
            </div>
          </div>
        );
      })()}


        {/* Business Blueprint is advanced/curiosity tooling — irrelevant to
            a merchant chasing their first sale. Hidden until first sale,
            then it returns as a reference. */}
        {showOwnerInlineUi && ownerHasSales && !project?.is_live && (
        <details className="mb-8 rounded-3xl border border-default bg-surface-card p-6">
          <summary className="flex cursor-pointer items-center justify-between text-xs uppercase tracking-[0.3em] text-muted hover:text-secondary">
            <span>Business Blueprint</span>
            <span className="text-[10px] text-muted">Click to expand</span>
          </summary>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-default bg-surface-page p-5">
              <h2 className="text-2xl font-bold text-primary">Original Prompt</h2>
              <p className="mt-3 text-secondary">{project?.prompt || "No prompt saved yet."}</p>
            </div>

            <div className="rounded-2xl border border-default bg-surface-page p-5">
              <h2 className="text-2xl font-bold text-primary">Rewards &amp; Perks</h2>
              <p className="mt-3 text-secondary">
                {parsedAiOutput?.token_utility || project?.token_utility || "Rewards details are not configured yet."}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-default bg-surface-page p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-muted">Description</div>
              <p className="mt-3 text-primary">
                {parsedAiOutput?.description ||
                  project?.description ||
                  "No AI-generated description available yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-default bg-surface-page p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-muted">Category</div>
              <p className="mt-3 text-primary">{category}</p>
            </div>

            <div className="rounded-2xl border border-default bg-surface-page p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-muted">Template Type</div>
              <p className="mt-3 text-primary">
                {parsedAiOutput?.template_type ||
                  project?.template_type ||
                  "No template type available yet."}
              </p>
            </div>
          </div>
        </details>
        )}



    </>)}

  </div>

  {/* ── Image Lightbox Modal ── */}
  {lightboxUrl && (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-page/90 backdrop-blur-sm"
      onClick={() => setLightboxUrl(null)}
    >
      <button
        className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted/80 text-xl text-primary transition hover:bg-zinc-700 hover:text-white"
        onClick={() => setLightboxUrl(null)}
        aria-label="Close"
      >
        ✕
      </button>
      <img
        src={lightboxUrl}
        alt="Full size"
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onError={() => setLightboxUrl(null)}
      />
    </div>
  )}

  {/* Storefront reviews: list + write-a-review for signed-in non-owners.
      Customer-facing surface (hidden in the owner's inline view). */}
  {!showOwnerInlineUi && id && (
    <ReviewsSection
      projectId={id as string}
      isOwner={isOwner}
      isAuthenticated={!!authUser}
      getToken={getToken}
      onLogin={login}
    />
  )}

  {/* AI Sales Assistant ("Chat with <business>" bubble). Customer-facing —
      hidden for the authenticated owner (2E/2F). Gated behind
      ENABLE_AI_FEATURES so the whole AI surface set toggles as one. */}
  {ENABLE_AI_FEATURES && offers.length > 0 && !showOwnerInlineUi && (
    <AiSalesChat
      projectId={id}
      businessName={projectName}
      onScrollToOffer={(title) => {
        const match = offers.find((o) => o.title === title);
        const el = match ? document.getElementById(`offer-${match.id}`) : document.getElementById("offers-section");
        if (el) el.scrollIntoView({ behavior: "smooth", block: match ? "center" : "start" });
      }}
    />
  )}

  {/* Guest chat: storefront visitor -> merchant inbox. Customer view only,
      bottom-left so it clears the AiSalesChat bubble on the right. */}
  {!showOwnerInlineUi && (
    <GuestChat projectId={id} businessName={projectName} />
  )}

  {/* Trust & safety: discreet report control for the customer view.
      Hidden for the owner (non-preview). Extra bottom padding on mobile
      clears the sticky buy bar. */}
  {!showOwnerInlineUi && (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-2 text-center sm:px-6 lg:pb-6">
      <ReportButton projectId={id as string} />
      <Link
        href="/"
        className="mt-3 block text-[11px] tracking-wide text-muted transition hover:text-brand-teal"
      >
        Powered by DUM Club
      </Link>
    </div>
  )}

  {/* Sticky mobile CTA bar. only visible on mobile, hides on desktop */}
  {!isOwner && offers.length > 0 && (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-default bg-surface-card backdrop-blur-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-secondary">From</div>
          <div className="text-lg font-black text-primary">
            ${Math.min(...offers.map(o => Number(o.price_usd))).toFixed(0)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => scrollToSection("offers-section")}
          className="rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Browse Offers ↓
        </button>
      </div>
    </div>
  )}

  </div>
  );
}

