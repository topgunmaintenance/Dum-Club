"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), { ssr: false });

import { IVS_REALTIME_ENABLED, isIVSSession } from "../../../lib/liveProvider";
import { deriveStoreStatusCta } from "../../../lib/storeStatus";
const IVSStageHost = dynamic(() => import("../../../components/IVSStageHost").then(m => ({ default: m.IVSStageHost })), { ssr: false });
const IVSStageViewer = dynamic(() => import("../../../components/IVSStageViewer").then(m => ({ default: m.IVSStageViewer })), { ssr: false });
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
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
import { createClient } from "../../../lib/supabase/client";
import { AiSalesChat } from "../../../components/AiSalesChat";
import { ReportButton } from "../../../components/ReportButton";
import { ScheduledLiveBanner } from "../../../components/ScheduledLiveBanner";
import { LiveAlertSignup } from "../../../components/LiveAlertSignup";
import { ReplayCard } from "../../../components/ReplayCard";
import { isSimulatedToken } from "../../../lib/tokenMode";
import { SimulatedTokenBanner } from "../../../components/SimulatedTokenBanner";
import { LiveChat, broadcastLiveEvent } from "../../../components/LiveChat";
import { LiveChatIVS } from "../../../components/LiveChatIVS";
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
import {
  createOffer,
  OffersError,
  sanitizeBearerToken,
  updateOffer,
} from "../../../lib/offers";
import { AdminBar, ExitCustomerViewChip, useViewAsCustomer, writeViewAsCustomer } from "../../../components/project/AdminBar";
import { OfferActionsMenu } from "../../../components/project/OfferActionsMenu";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const { wallets } = useSolanaWallets();
  // External Solana wallet adapter (Phantom / Solflare). Used as a
  // fallback for the "Pay with SOL" CTA when the user prefers an
  // external wallet over the Privy embedded wallet. Always called
  //. rules of hooks. and consumed only when SOL checkout fires.
  const adapterWallet = useWallet();

  // Diagnostic: log effective API base on mount
  useEffect(() => {
  }, []);

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("DUM Club Business");
  // Pin-offer feedback state. pinningOfferId tracks which chip is
  // currently in flight (or "__unpin__" when clearing); pinError
  // surfaces backend failures inline next to the new offline pin UI
  // so the merchant doesn't have to crack open the console.
  const [pinningOfferId, setPinningOfferId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
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
  const [backendReviews, setBackendReviews] = useState<{ id: number; rating: number; comment: string; created_at: string }[]>([]);
  const [backendAvgRating, setBackendAvgRating] = useState(0);
  const [backendReviewCount, setBackendReviewCount] = useState(0);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);

  const [loadingProject, setLoadingProject] = useState(true);
  const [ownerBizProfile, setOwnerBizProfile] = useState<{ business_name?: string; verification_status?: string } | null>(null);
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
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
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
  const [liveStreamUrl, setLiveStreamUrl] = useState("");
  const [goingLive, setGoingLive] = useState(false);
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
  const [liveMode, setLiveMode] = useState<"native_mux" | "manual_embed">("native_mux");
  const [muxStreamKey, setMuxStreamKey] = useState<string | null>(null);
  const [muxIngestUrl, setMuxIngestUrl] = useState<string | null>(null);
  const [muxPlaybackId, setMuxPlaybackId] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [goLiveError, setGoLiveError] = useState<string | null>(null);
  const [cameraPreview, setCameraPreview] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [showAdvancedLive, setShowAdvancedLive] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const relayWsRef = useRef<WebSocket | null>(null);
  const liveCameraStreamRef = useRef<MediaStream | null>(null);

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
  }>({
    is_holder: false,
    free_limit: 3,
    used_count: 0,
    free_questions_left: 3,
    holder_unlimited: true,
    token_required: false,
    token_mint_address: null,
    locked: false,
    lock_message: "",
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
        free_limit: Number(projectData?.ai_free_question_limit || 3),
        free_questions_left: Number(projectData?.ai_free_question_limit || 3),
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

  async function uploadOfferImage(file: File): Promise<string | null> {
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "jpg";
      const path = `offer-images/${id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("offers").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) { console.error("[image] Upload error:", error); throw error; }
      const { data } = supabase.storage.from("offers").getPublicUrl(path);
      return data.publicUrl;
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
        const uploaded = await uploadOfferImage(offerImageFile);
        if (uploaded) {
          imageUrl = uploaded;
        } else {
          setOfferSaveError("Image upload failed. Offer will be saved without image. Check that the 'offers' storage bucket exists in Supabase.");
        }
      }

      const isEdit = Boolean(offerEditing.id);
      const body = {
        title: offerEditing.title?.trim() || "",
        description: offerEditing.description?.trim() || null,
        price_usd: priceNum,
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

      const res = await fetch(`${API_BASE}/api/checkout/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(checkoutPayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("[buyOffer] Checkout error detail:", errData);
        const msg = typeof errData.detail === "string" ? errData.detail : `Checkout failed (HTTP ${res.status})`;
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
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[buyOffer] ERROR:", msg);
      setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
      setBuyError((p) => ({ ...p, [oid]: msg }));
      setBuyingOfferId(null);
    }
  }

  // Solana wallet checkout. secondary CTA, additive to Stripe.
  // Same per-offer state (buyingOfferId, buyStep, buyError) so the
  // Stripe button is disabled while a SOL payment is in flight.
  async function payOfferWithSolHandler(
    offer: Offer,
    auctionId?: string,
    overridePrice?: number,
  ) {
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
    if (!id || !isOwner) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/checkout/orders/seller/${id}`, {
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
    if (!window.confirm("Refund this order in full? This returns the buyer's money (including the 1% fee) and can't be undone.")) return;
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

      if (res.status === 403) {
        const errorData = await res.json();
        const detail = errorData?.detail || {};

        setChatMeta((prev) => ({
          ...prev,
          is_holder: Boolean(detail?.is_holder),
          free_limit: Number(detail?.free_limit || prev.free_limit || 3),
          used_count: Number(detail?.used_count || prev.used_count || 0),
          free_questions_left: Number(detail?.free_questions_left || 0),
          token_required: Boolean(detail?.token_required),
          token_mint_address: detail?.token_mint_address || prev.token_mint_address,
          locked: true,
          lock_message:
            detail?.message ||
            "You’ve reached the free question limit. Purchase an offer to unlock unlimited AI access.",
        }));

        setResponse(
          detail?.message ||
            "You’ve reached the free question limit. Purchase an offer to unlock unlimited AI access."
        );
        return;
      }

      if (!res.ok) throw new Error("Failed to ask AI");

      const data: GatedChatResponse = await res.json();

      setResponse(data.answer || "No response returned.");
      setQuestion("");

      setChatMeta({
        is_holder: Boolean(data.is_holder),
        free_limit: Number(data.free_limit || 3),
        used_count: Number(data.used_count || 0),
        free_questions_left: Number(data.free_questions_left || 0),
        holder_unlimited: Boolean(data.holder_unlimited),
        token_required: Boolean(data.token_required),
        token_mint_address: data.token_mint_address || null,
        locked: false,
        lock_message: "",
      });
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

  /* ── Camera Preview ────────────────────────────────── */
  async function startCameraPreview() {
    setGoLiveError(null);

    // Check if getUserMedia is available
    if (!navigator.mediaDevices?.getUserMedia) {
      setGoLiveError("Camera not supported on this browser. Try Chrome or Safari.");
      console.error("[camera] getUserMedia not available");
      return;
    }

    // Mobile-friendly constraints: prefer front camera, limit resolution for performance
    const constraints: MediaStreamConstraints = {
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      setCameraStream(stream);
      setCameraPreview(true);

      // Attach to video element after render. retry a few times for mobile
      const attachToVideo = (attempt = 0) => {
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          previewVideoRef.current.play().catch(() => {});
        } else if (attempt < 5) {
          setTimeout(() => attachToVideo(attempt + 1), 100);
        } else {
        }
      };
      setTimeout(() => attachToVideo(), 50);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[camera] getUserMedia failed:", msg);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setGoLiveError("Camera access denied. Please allow camera and microphone in your browser settings.");
      } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
        setGoLiveError("No camera found. Make sure your device has a camera.");
      } else {
        setGoLiveError(`Camera error: ${msg}`);
      }
    }
  }

  function cancelCameraPreview() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setCameraPreview(false);
  }

  async function startLiveFromCamera() {
    setCameraPreview(false);
    setGoingLive(true);
    setGoLiveError(null);

    // Keep the camera stream alive. we need it for MediaRecorder
    const stream = cameraStream;
    if (!stream) {
      setGoLiveError("Camera stream lost. Please try again.");
      setGoingLive(false);
      return;
    }
    liveCameraStreamRef.current = stream;

    try {
      // 1. Create native Mux stream on backend
      const res = await fetch(`${API_BASE}/api/projects/${id}/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        body: JSON.stringify({ provider: "native_mux" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const detail = typeof errData.detail === "string" ? errData.detail : "Failed to create stream";
        // Fallback: if Mux isn't configured, go live without video
        if (res.status === 503 || res.status === 502) {
          // Mux not available. fall back to live-without-video mode
          const fallbackRes = await fetch(`${API_BASE}/api/projects/${id}/go-live`, {
            method: "POST",
            headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
            body: JSON.stringify({ provider: "manual_embed", stream_url: "camera://local" }),
          });
          if (fallbackRes.ok) {
            stream.getTracks().forEach((t) => t.stop());
            setCameraStream(null);
            setProject((prev) => prev ? { ...prev, is_live: true, live_provider: "manual_embed", stream_url: "camera://local", live_playback_id: null } : prev);
            setLiveSalesCount(0);
            setGoingLive(false);
            return;
          }
        }
        setGoLiveError(detail);
        setGoingLive(false);
        return;
      }

      const data = await res.json();
      setMuxStreamKey(data.stream_key);
      setMuxIngestUrl(data.ingest_url);
      setMuxPlaybackId(data.playback_id);
      setProject((prev) => prev ? {
        ...prev, is_live: true, live_provider: "native_mux",
        live_playback_id: data.playback_id, stream_url: null,
      } : prev);
      setLiveSalesCount(0);

      // 2. Open WebSocket to live relay
      const wsProtocol = API_BASE.startsWith("https") ? "wss" : "ws";
      const wsHost = API_BASE.replace(/^https?:\/\//, "");
      const wsUrl = `${wsProtocol}://${wsHost}/api/live/stream/${id}`;

      const ws = new WebSocket(wsUrl);
      relayWsRef.current = ws;

      ws.binaryType = "arraybuffer";

      ws.onopen = () => {

        // 3. Detect best supported mimeType
        // Order: webm VP8 (Chrome/Firefox) → webm VP9 → webm (generic) → mp4 (Safari)
        const candidates = [
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8",
          "video/webm",
          "video/mp4",  // Safari on iOS/macOS
        ];
        const supported = candidates.filter((m) => {
          try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
        });

        const mimeType = supported[0] || "";

        // Determine input format for backend ffmpeg
        const isMP4 = mimeType.includes("mp4");
        if (isMP4) {
        }

        let recorder: MediaRecorder;
        try {
          const opts: MediaRecorderOptions = { videoBitsPerSecond: 1_500_000 };
          if (mimeType) opts.mimeType = mimeType;
          recorder = new MediaRecorder(stream, opts);
        } catch (recErr) {
          console.error("[go-live] MediaRecorder creation failed:", recErr);
          // Last resort: try with no options
          recorder = new MediaRecorder(stream);
        }
        mediaRecorderRef.current = recorder;

        let chunksSent = 0;
        let totalBytesSent = 0;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            chunksSent++;
            totalBytesSent += e.data.size;
            ws.send(e.data);
            if (chunksSent <= 5 || chunksSent % 50 === 0) {
            }
          }
        };

        recorder.onerror = (e) => {
          console.error("[go-live] MediaRecorder error:", e);
          setGoLiveError("Recording error. Please try again.");
        };

        recorder.onstop = () => {
        };

        // Send chunks every 1000ms. gives ffmpeg substantial data per chunk
        recorder.start(1000);
      };

      ws.onmessage = (e) => {
        // Backend sends status/error JSON messages
        try {
          const msg = typeof e.data === "string" ? JSON.parse(e.data) : null;
          if (msg) {
            if (msg.error) {
              setGoLiveError(msg.error);
            }
          }
        } catch { /* ignore binary */ }
      };

      ws.onclose = (e) => {
      };

      ws.onerror = (err) => {
        console.error("[go-live] WebSocket error:", err);
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setGoLiveError(msg);
      // Clean up camera on failure
      stream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    } finally {
      setGoingLive(false);
    }
  }

  // Clean up live stream on unmount / tab close
  useEffect(() => {
    function cleanup() {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (relayWsRef.current) relayWsRef.current.close();
      if (liveCameraStreamRef.current) liveCameraStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, []);

  /* ── Live Commerce ────────────────────────────────── */
  async function handleGoLive() {
    if (!id) return;
    if (liveMode === "manual_embed" && !liveStreamUrl.trim()) return;
    setGoingLive(true);
    setGoLiveError(null);
    try {
      const reqBody: Record<string, unknown> = { provider: liveMode };
      if (liveMode === "manual_embed") reqBody.stream_url = liveStreamUrl.trim();
      const res = await fetch(`${API_BASE}/api/projects/${id}/go-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        body: JSON.stringify(reqBody),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.provider === "native_mux") {
          setMuxStreamKey(data.stream_key);
          setMuxIngestUrl(data.ingest_url);
          setMuxPlaybackId(data.playback_id);
          setProject((prev) => prev ? {
            ...prev, is_live: true, live_provider: "native_mux",
            live_playback_id: data.playback_id, stream_url: null,
          } : prev);
        } else {
          setProject((prev) => prev ? {
            ...prev, is_live: true, live_provider: "manual_embed",
            stream_url: liveStreamUrl.trim(), live_playback_id: null,
          } : prev);
        }
        setLiveSalesCount(0);
      } else {
        const errData = await res.json().catch(() => ({}));
        const detail = typeof errData.detail === "string" ? errData.detail : `Go live failed (HTTP ${res.status})`;
        setGoLiveError(detail);
        console.error("[go-live] Error:", detail);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setGoLiveError(msg);
      console.error("Go live failed", err);
    } finally {
      setGoingLive(false);
    }
  }

  async function handleEndLive() {
    if (!id) return;

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Close WebSocket relay
    if (relayWsRef.current) {
      relayWsRef.current.close();
      relayWsRef.current = null;
    }

    // Stop camera tracks
    if (liveCameraStreamRef.current) {
      liveCameraStreamRef.current.getTracks().forEach((t) => t.stop());
      liveCameraStreamRef.current = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }

    try {
      await fetch(`${API_BASE}/api/projects/${id}/end-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
      });
      setProject((prev) => prev ? {
        ...prev, is_live: false, stream_url: null, pinned_offer_id: null,
        live_provider: null, live_playback_id: null,
      } : prev);
      setMuxStreamKey(null);
      setMuxIngestUrl(null);
      setMuxPlaybackId(null);
    } catch (err) {
      console.error("End live failed", err);
    }
  }

  async function handlePinOffer(offerId: string | null) {
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
        body: JSON.stringify({ offer_id: offerId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg =
          typeof errBody.detail === "string"
            ? errBody.detail
            : `Pin failed (HTTP ${res.status})`;
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

  // Countdown timer
  useEffect(() => {
    if (!auction || auction.status !== "active") { setAuctionCountdown(""); return; }
    function tick() {
      const now = Date.now();
      const end = new Date(auction!.ends_at).getTime();
      const diff = Math.max(0, end - now);
      if (diff <= 0) {
        setAuctionCountdown("0:00");
        // Auto-close when timer hits zero
        fetch(`${API_BASE}/api/auctions/${auction!.id}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json", user_id: authUser?.privyId || "" },
        }).then(() => loadAuction()).catch(() => {});
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
        setAuctionBidError(err.detail || "Bid failed");
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
        setPublishError(
          typeof errData.detail === "string"
            ? errData.detail
            : "Could not update your store. Try again.",
        );
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
    fetch(`${API_BASE}/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store_items: items }),
    }).catch((err) => console.error("Failed to persist store items:", err));
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

  // Load business profile for the project owner (for verified badge)
  useEffect(() => {
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
  }, [project?.privy_id, project?.owner_id]);

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
    if (params.get("golive") === "1") {
      setAutoGoLive(true);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("golive");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
  }, []);

  // Auto-dismiss 8s after isOwner resolves (only fires if banner was shown).
  useEffect(() => {
    if (!isOwner || !showLiveBanner) return;
    const t = window.setTimeout(() => setShowLiveBanner(false), 8000);
    return () => clearTimeout(t);
  }, [isOwner, showLiveBanner]);

  useEffect(() => {
    const addr = authUser?.walletAddress ?? wallets[0]?.address ?? null;
    setUserWallet(addr);
  }, [authUser, wallets]);

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

  // Load favorite status
  useEffect(() => {
    if (!id) return;
    // Public count
    fetch(`${API_BASE}/api/favorites/count/${id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setFavoriteCount(data.count || 0); })
      .catch(() => {});
    // Auth check
    if (authUser) {
      getToken().then((token) => {
        if (!token) return;
        fetch(`${API_BASE}/api/favorites/check/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => { if (data) setIsFavorited(data.favorited); })
          .catch(() => {});
      });
    }
  }, [id, authUser]);

  // Toggle favorite
  async function toggleFavorite() {
    if (!authUser) { login(); return; }
    setTogglingFavorite(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/favorites/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: id }),
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

return (
  <div className="relative min-h-screen bg-surface-page px-4 py-8 text-primary sm:px-6 lg:px-8">
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
    {project?.is_live && pinnedOffer && !isOwner && (() => {
      const isSoldOut = !pinnedOffer.unlimited_inventory
        && (pinnedOffer.quantity_available || 0) > 0
        && ((pinnedOffer.quantity_available || 0) - (pinnedOffer.quantity_sold || 0)) <= 0;
      return (
        <div
          className="fixed inset-x-0 bottom-0 z-[55] border-t border-default bg-surface-card/95 backdrop-blur-md px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:hidden"
          aria-label="Featured item. Buy while the live show is on."
        >
          <div className="mx-auto flex max-w-md items-center gap-3">
            {pinnedOffer.primary_image_url && (
              <img
                src={pinnedOffer.primary_image_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-primary">
                {pinnedOffer.title}
              </div>
              <div className="font-mono text-sm font-bold text-brand-teal">
                ${Number(pinnedOffer.price_usd).toFixed(2)}
              </div>
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
        customers and STATE_3+ owners keep it. */}
    {(!showOwnerInlineUi || ownerHasSales) && <SectionNav />}
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
              <button
                onClick={() => { setPitchMode(false); setTimeout(scrollToAiWorkspace, 100); }}
                // Mobile: hidden — AI is the floating bubble only.
                // Desktop: keeps the in-pitch Ask AI affordance.
                className="hidden rounded-xl border border-default px-8 py-3 text-sm font-medium text-primary transition hover:border-default hover:text-brand-teal sm:inline-flex"
              >
                Ask AI
              </button>
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
      {showOwnerInlineUi && ownerHasSales && (
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

      {/* ── LIVE NOW Banner + Stream ────────────────── */}
      {project?.is_live && (project.stream_url || project.live_playback_id || project.ivs_stage_arn || isIVSSession(project)) && (
        <div className="mb-6">
          {/* ── LIVE banner. always full width above the grid ──
               Audit #4 Phase 1 surfaces three real-data signals that
               were previously hidden: the cumulative sales count
               (Q1, was buried inside the bouncing toast), the viewer
               count (Q2, was scoped to LiveChatIVS), and the rewards
               pill (Q8, was zinc-on-zinc and easy to miss). All real
               data; nothing fabricated. The Q3 "Live for HH:MM"
               since-timer is intentionally absent. it requires a
               backend `live_started_at` field; client-side approx.
               would mislead late-joiners. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-[var(--state-live)]/30 bg-state-live/[0.06] px-4 py-2.5 sm:px-5 sm:py-3">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-state-live" />
              </span>
              <span className="text-xs sm:text-sm font-bold uppercase tracking-[0.15em] text-state-live">Live</span>
              <span className="text-xs sm:text-sm text-secondary truncate">{projectName}</span>
              {/* Q2. viewer count (real, from existing WebSocket) */}
              {liveViewerCount > 0 && (
                <span className="rounded-full border border-default bg-surface-card px-2 py-0.5 text-[10px] font-mono text-secondary">
                  {liveViewerCount} watching
                </span>
              )}
              {/* Q1. persistent sold-this-show counter (real,
                  from `liveSalesCount` already incremented on
                  every `item_sold` WebSocket event). Hidden until
                  the first sale to avoid a sad "0 sold" pill. */}
              {liveSalesCount > 0 && (
                <span className="rounded-full border border-default bg-brand-teal-soft px-2 py-0.5 text-[10px] font-mono font-bold text-brand-teal">
                  {liveSalesCount} sold this show
                </span>
              )}
            </div>
            {/* Q8. promote the rewards pill from zinc-on-zinc to
                 emerald so the buyer's biggest reward signal isn't
                 whispered. Same visual weight as the founding-100
                 pill on /merchant. */}
            <span className="rounded-full border border-default bg-brand-teal-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-teal">
              Earn DUM Points
            </span>
          </div>

          {/* ── Two-column grid: video (left) + chat (right) on lg:, stacked on mobile ── */}
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">

            {/* ── LEFT COLUMN: video + product + controls ── */}
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
                  {project.live_provider === "native_mux" && project.live_playback_id ? (
                    <MuxPlayer
                      playbackId={project.live_playback_id}
                      streamType="live"
                      autoPlay="muted"
                      muted
                      style={{ width: "100%", aspectRatio: "16/9" }}
                      primaryColor="#10b981"
                      secondaryColor="#09090b"
                      accentColor="#10b981"
                    />
                  ) : project.stream_url === "camera://local" ? (
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
                            src={pinnedOffer.primary_image_url}
                            alt={pinnedOffer.title}
                            className="mb-3 h-32 w-full rounded-xl object-cover"
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
                            <span className="text-secondary">Stripe checkout</span> · Your card never touches DUM Club. <span className="text-muted">Prices in USD; Stripe converts at checkout.</span>
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

              {/* Host controls. below product on desktop */}
              {isOwner && isIVSSession(project) && (
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

            {/* ── RIGHT COLUMN (lg:) / BELOW VIDEO (mobile): LiveChatIVS ── */}
            {isIVSSession(project) && (
              <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)] pb-20 lg:pb-0">
                <LiveChatIVS
                  projectId={id as string}
                  userId={authUser?.privyId || ""}
                  userName={authUser?.email || "Viewer"}
                  isHost={isOwner}
                  getToken={getToken}
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
                  Stripe checkout · Your card never touches DUM Club. <span className="text-muted">Prices in USD; Stripe converts at checkout.</span>
                </p>
                </div>
              ) : null}
            </div>
          )}
        </div>

      )}

      <div
        id="section-top"
        className={`mb-8 rounded-3xl border border-default bg-surface-page p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8 ${project?.is_live && isIVSSession(project) ? "hidden" : ""}`}
        style={{
          borderTop: `3px solid ${accent}`,
          boxShadow: `0 0 1px rgba(255,255,255,0.02), 0 0 40px rgba(0,255,178,0.06)`,
        }}
      >
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border border-default bg-surface-card text-3xl shadow-inner sm:h-20 sm:w-20 sm:text-4xl">
              {emoji}
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
                  {category}
                </span>
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
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                    isFavorited
                      ? "border-rose-400/30 bg-rose-400/10 text-rose-400"
                      : "border-default text-secondary hover:border-strong hover:text-primary"
                  }`}
                >
                  {isFavorited ? "♥" : "♡"} {favoriteCount > 0 ? favoriteCount : "Save"}
                </button>
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
                    {category}
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

                {/* Price anchor. show cheapest offer */}
                {offers.length > 0 && (
                  <div className="mb-4 flex items-baseline gap-2">
                    <span className="text-2xl font-black text-brand-navy">
                      From ${Math.min(...offers.map(o => Number(o.price_usd))).toFixed(0)}
                    </span>
                    <span className="text-sm text-secondary">USD</span>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <button type="button" onClick={() => scrollToSection("offers-section")} className="flex items-center justify-center rounded-xl bg-brand-teal px-5 py-3.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover hover:">
                    {offers.length > 0 ? `Browse ${offers.length} Offer${offers.length > 1 ? "s" : ""} ↓` : "View Offers ↓"}
                  </button>
                  {/* Mobile: render only the share menu (full-width).
                      Desktop: 2-column grid with Ask AI + Share. */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => scrollToSection("ai-workspace")} className="hidden items-center justify-center rounded-xl border border-default px-4 py-3 text-sm text-primary transition hover:border-strong hover:text-primary sm:flex">
                      Ask AI
                    </button>
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

      <div id="section-about" className="mb-8 rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm">
        <div className="mb-4 text-xs uppercase tracking-[0.3em] text-secondary">About</div>
        {loadingProject ? (
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-surface-muted" />
          </div>
        ) : (
          <p className="max-w-3xl text-base leading-relaxed text-primary">
            {project?.description || parsedAiOutput?.description || "No description available yet."}
          </p>
        )}
        {project?.prompt && (
          <p className="mt-4 text-sm text-secondary">
            Launched from the idea: &ldquo;{project.prompt}&rdquo;
          </p>
        )}
      </div>

      {/* ── FOUNDER CARD. Topgun Maintenance only (Phase 0B pilot) ── */}
      {project?.slug === "topgun-maintenance" && (
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
          <div id="project-live-host" className={`scroll-mt-28 ${project?.is_live ? "" : "rounded-3xl border border-default bg-surface-card p-6"}`}>
            <IVSStageHost
              projectId={id as string}
              userId={authUser?.privyId || ""}
              autoStart={autoGoLive}
              // Phase 3 (Q6). pre-stream guard. The component shows a
              // confirm dialog before requesting camera if no offer is
              // pinned, so the merchant doesn't go live to viewers who
              // can't buy.
              pinnedOfferId={project?.pinned_offer_id ?? null}
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
          </div>
        )}

      {/* ── Offers (Public Storefront + Owner Tools) ──
           Side-by-side with the host block above for owners;
           single column otherwise. */}
      <div id="offers-section" className={`scroll-mt-28 rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm sm:p-8 ${!isOwner && project?.is_live && isIVSSession(project) ? "hidden" : ""}`}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.3em] text-brand-teal/50">
              Offers
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

        {/* Owner-only: pin the offer that appears as "Now showing" in the
            embed and on the live storefront. Mirrors the existing in-stream
            pin chip control (line ~4210) but is visible while offline so
            the merchant can pin BEFORE going live. Visual is louder than
            the in-stream chips (filled emerald + ✓ PINNED label) because
            this surface is mobile-first and the in-stream version's
            10%-opacity emerald was too subtle to read on a phone screen
            in daylight. */}
        {isOwner && offers.filter((o) => o.is_active).length > 0 && (
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
                  that exposed code immediately. */}
              <div className="mt-4 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-5 sm:p-6">
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
                      className="w-full rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal sm:w-auto"
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
                                  1% sales fee per order · Your bank info goes to Stripe, never to DUM Club.
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
                        src={offer.primary_image_url}
                        alt={offer.title}
                        className="w-full aspect-[4/3] object-cover transition-transform duration-300 group-hover/img:scale-105"
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
                                and lower-contrast. */}
                            {SOL_CHECKOUT_ENABLED && (
                              <button
                                type="button"
                                disabled={buyingOfferId === offer.id}
                                onClick={() => payOfferWithSolHandler(offer)}
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
      {(!showOwnerInlineUi || ownerHasSales) && (
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
                  : `This business includes ${chatMeta.free_limit} free AI questions. Purchase any offer to unlock unlimited access.`}
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
            {loadingAsk ? "Asking..." : chatMeta.locked ? "Purchase to Unlock" : "Ask AI"}
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
      {showOwnerInlineUi && (
        <div className="mb-6 mt-2 flex items-center gap-4">
          <div className="h-px flex-1 bg-surface-muted" />
          <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-muted">Owner Tools</span>
          <div className="h-px flex-1 bg-surface-muted" />
        </div>
      )}

      {showOwnerInlineUi && (
        <div className="mb-8 rounded-2xl border border-default bg-surface-card p-4 text-sm text-primary">
          <span className="uppercase tracking-[0.18em] text-secondary">
            Shop status
          </span>
          <div className="mt-2 text-base text-primary">{statusBanner}</div>
        </div>
      )}


      {/* ── Legacy Live Control Panel (non-IVS only) ── */}
      {isOwner && !IVS_REALTIME_ENABLED && (
        <div className="mb-8 rounded-3xl border border-default bg-surface-card p-6">

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

          {/* Legacy Mux/camera flow. only when IVS is NOT enabled and NOT live */}
          {!IVS_REALTIME_ENABLED && !project?.is_live && (
            goingLive ? (
              // Optimistic-feedback panel: shown the instant Start Live is
              // clicked, before the /go-live API + Mux stream creation
              // resolve. The merchant gets clear reassurance during the
              // ~1-2s wait instead of a silently-disabled button. Covers
              // both startLiveFromCamera() and handleGoLive() — both set
              // goingLive=true on click.
              <div className="rounded-2xl border border-[var(--state-live)]/30 bg-state-live/5 p-8 text-center">
                <div
                  className="mx-auto mb-4 flex h-12 w-12 items-center justify-center"
                  role="status"
                  aria-live="polite"
                  aria-label="Starting your live show"
                >
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-state-live" />
                  </span>
                </div>
                <div className="text-lg font-bold text-primary">Starting your live show…</div>
                <p className="mt-2 text-sm text-secondary">
                  Connecting your camera. This usually takes a second or two.
                </p>
              </div>
            ) : cameraPreview ? (
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-primary">Camera Ready</h2>
                <div className="overflow-hidden rounded-2xl border border-default bg-black">
                  <video ref={previewVideoRef} autoPlay muted playsInline className="w-full" style={{ aspectRatio: "16/9", objectFit: "cover" }} />
                </div>
                <div className="flex gap-3">
                  <button onClick={startLiveFromCamera} disabled={goingLive} className="flex-1 rounded-xl bg-state-live py-3 text-sm font-bold text-white transition hover:bg-red-400 disabled:opacity-40">
                    {goingLive ? "Starting..." : "Start Live"}
                  </button>
                  <button onClick={cancelCameraPreview} className="rounded-xl border border-default px-5 py-3 text-sm text-secondary hover:text-white">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <button onClick={startCameraPreview} className="rounded-2xl bg-state-live px-10 py-4 text-lg font-bold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-400 active:scale-[0.98]">
                  Go Live
                </button>
                <p className="mt-3 text-sm text-secondary">Start selling in seconds</p>
                {goLiveError && (
                  <div className="mt-3 mx-auto max-w-md rounded-xl border border-[var(--state-live)]/30 bg-state-live/5 px-4 py-3 text-sm text-state-live">{goLiveError}</div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Seller Sales (Owner Only) ──────────────── */}
      {showOwnerInlineUi && (
        <details
          id="section-orders"
          // Open by default when there are orders to show OR when
          // the merchant navigated here via the AdminBar's
          // Orders link — scrolling to a collapsed section reads
          // as a broken link. Empty-state remains collapsed so
          // brand-new merchants aren't faced with an empty box.
          open={
            sellerOrders.length > 0 ||
            (typeof window !== "undefined" &&
              window.location.hash === "#section-orders")
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
                          // AFTER our 1% Marketplace Fee but BEFORE Stripe's
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
                            ? `Gross Sale $${gross.toFixed(2)} − Marketplace Fee $${fee.toFixed(2)} (1%) = Net Received $${net.toFixed(2)}. Marketplace Fee is deducted from your payout; the customer is not charged extra. Stripe's own processing fee is applied separately on payout.`
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
      {showOwnerInlineUi && (() => {
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
        // button. Go Live uses the IVS host when enabled, otherwise the
        // legacy camera preview, matching how the rest of the page goes
        // live.
        const runPrimaryAction = () => {
          if (primaryAction === "add_offer") {
            openOfferForm();
            scrollToSection("offers-section");
          } else if (primaryAction === "go_live") {
            if (IVS_REALTIME_ENABLED) {
              setAutoGoLive(true);
              scrollToSection("project-live-host");
            } else {
              startCameraPreview();
            }
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
        {showOwnerInlineUi && ownerHasSales && (
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
      />
    </div>
  )}

  {/* AI Sales Assistant. Customer-facing — hidden for the authenticated
      owner (2E/2F) so the owner's own page isn't cluttered with a buyer
      chat widget. Still shown to all visitors and in view-as-customer. */}
  {offers.length > 0 && !showOwnerInlineUi && (
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

  {/* Trust & safety: discreet report control for the customer view.
      Hidden for the owner (non-preview). Extra bottom padding on mobile
      clears the sticky buy bar. */}
  {!showOwnerInlineUi && (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-2 text-center sm:px-6 lg:pb-6">
      <ReportButton projectId={id as string} />
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

