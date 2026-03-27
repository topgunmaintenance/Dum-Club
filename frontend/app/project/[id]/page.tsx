"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useAuth } from "../../../lib/auth/AuthContext";
import { createClient } from "../../../lib/supabase/client";
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
  owner_id?: string | null;
  wallet_address?: string | null;
  name?: string;
  title?: string;
  description?: string;
  status?: string;
  review_status?: string;
  template_type?: string;
  prompt?: string;
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_FEE_RATE = 0.015;
const DUM_FEE_RATE = 0.005;
const TOTAL_FEE_RATE = PROJECT_FEE_RATE + DUM_FEE_RATE;

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

  return "AI Project";
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

/** Legacy DB values not in TOKEN_LIFECYCLE — treat as draft for UI/pipeline. */
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
  const { user: authUser } = useAuth();
  const { wallets } = useSolanaWallets();

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectStatus, setProjectStatus] = useState("draft");

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
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeTab, setTradeTab] = useState<"buy" | "sell">("buy");
  const [loadingTrade, setLoadingTrade] = useState(false);
  const [tradeMessage, setTradeMessage] = useState("");
  const [tradeWinFlash, setTradeWinFlash] = useState(false);
  const [tradeIsError, setTradeIsError] = useState(false);
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

  const [loadingProject, setLoadingProject] = useState(true);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  const [serviceProfile, setServiceProfile] = useState<Record<string, unknown> | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  // Live banner — shown only on launch arrivals via ?launched=1 from /build
  const [showLiveBanner, setShowLiveBanner] = useState(false);
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

      const resolvedName = projectData?.title || projectData?.name || "Untitled Project";
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
      setProjectName("Untitled Project");
      setProjectStatus("draft");
    } finally {
      setLoadingProject(false);
    }
  }

  async function loadTokenMetadata() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/token-metadata`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("Failed to load token metadata");

      const data = await res.json();

      setTokenMeta({
        name: data.name || "",
        symbol: data.symbol || "",
        supply: data.supply != null ? String(data.supply) : "",
        decimals: data.decimals != null ? String(data.decimals) : "",
        status: data.status || "",
        mint_address: data.mint_address || "",
      });
    } catch (err) {
      console.error(err);
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
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/memories?project_id=${id}`);
      if (!res.ok) throw new Error("Failed to load memories");

      const data = await res.json();
      setMemories(data.memories || data || []);
    } catch (err) {
      console.error(err);
      setMemories([]);
    }
  }

  async function loadMarket() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/market`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load market");
      const data = await res.json();
      setMarket(data);
    } catch (err) {
      console.error(err);
      setMarket(null);
    }
  }

  async function loadTrades() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/trades`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load trades");
      const data = await res.json();
      setTrades(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setTrades([]);
    }
  }

  async function loadCandles() {
    if (!id) return;

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/candles`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to load candles");
      const data = await res.json();
      setCandles(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setCandles([]);
    }
  }
  
  async function loadRedemptions() {
    if (!id) return;
  
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/redemptions`, {
        cache: "no-store",
      });
  
      if (!res.ok) throw new Error("Failed to load redemptions");
  
      const data = await res.json();
      setRedemptions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
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

    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/balance/${wallet}`, {
        cache: "no-store",
      });

      if (!res.ok) throw new Error("Failed to load wallet balance");

      const data = await res.json();
      setWalletBalance(Number(data?.balance || 0));
    } catch (err) {
      console.error(err);
      setWalletBalance(0);
    }
  }

  async function executeTrade(side: "buy" | "sell") {
    if (!id) return;

    if (!tradeAmount.trim() || Number(tradeAmount) <= 0) {
      setTradeMessage("Enter a token amount to trade.");
      setTradeIsError(true);
      return;
    }

    const numericAmount = Number(tradeAmount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setTradeMessage("Enter a valid amount.");
      setTradeIsError(true);
      return;
    }

    if (side === "sell" && numericAmount > walletBalance) {
      setTradeMessage(
        `Insufficient balance. You only have ${formatNumber(walletBalance, 2)} ${
          project?.token_symbol || tokenMeta.symbol || "TOKENS"
        }.`
      );
      setTradeIsError(true);
      return;
    }

    const wallet = userWallet?.trim();
    if (!wallet || wallet.length < 8) {
      setTradeMessage("A connected Solana wallet is required to trade. Sign in with a wallet-linked account or connect a Solana wallet.");
      setTradeIsError(true);
      return;
    }

    try {
      setLoadingTrade(true);
      setTradeMessage("");
      setTradeIsError(false);

      const res = await fetch(`${API_BASE}/api/projects/${id}/trade`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          side,
          amount: numericAmount,
          wallet,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : Array.isArray(data?.detail)
            ? data.detail.map((d: any) => d?.msg || JSON.stringify(d)).join(", ")
            : JSON.stringify(data);

        throw new Error(detail || `Failed to ${side}`);
      }

      const sym = project?.token_symbol || tokenMeta.symbol || "TOKENS";
      const supply = Number(
        market?.max_supply ?? project?.token_supply ?? 21_000_000
      );
      const nextBal =
        side === "buy"
          ? walletBalance + numericAmount
          : Math.max(0, walletBalance - numericAmount);
      const ownershipPct =
        supply > 0 && Number.isFinite(nextBal)
          ? (nextBal / supply) * 100
          : 0;

      setTradeMessage(
        `${side === "buy" ? "Buy" : "Sell"} executed: ${formatNumber(
          numericAmount,
          2
        )} ${sym} · est. ${formatNumber(ownershipPct, 4)}% of supply`
      );
      setTradeWinFlash(true);
      window.setTimeout(() => setTradeWinFlash(false), 900);

      setTradeAmount("");
      await refreshMarketData();
      await loadWalletBalance();
    } catch (err: any) {
      console.error(err);
      setTradeMessage(err?.message || `Failed to ${side}`);
      setTradeIsError(true);
    } finally {
      setLoadingTrade(false);
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

  function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;

    const entry: ProjectFeedback = {
      rating: Math.min(5, Math.max(1, Number(feedbackRating) || 5)),
      comment: feedbackComment.trim(),
      created_at: new Date().toISOString(),
    };

    const next = [entry, ...feedbackEntries].slice(0, 20);
    setFeedbackEntries(next);
    setFeedbackComment("");
    setFeedbackRating(5);
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
      alert("Failed to save memory");
    } finally {
      setLoadingMemory(false);
    }
  }

  async function askAI(e: React.FormEvent) {
    e.preventDefault();

    if (!question.trim() || !id) return;

    const currentQuestion = question.trim();
    const sessionId = getOrCreateSessionId(id);

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
            "You’ve reached the 3-question free limit. Support this project by holding its token to unlock unlimited AI access.",
        }));

        setResponse(
          detail?.message ||
            "You’ve reached the 3-question free limit. Support this project by holding its token to unlock unlimited AI access."
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

  async function submitReview(e?: React.FormEvent) {
    e?.preventDefault();

    if (!tokenName.trim() || !tokenSymbol.trim() || !tokenSupply.trim()) {
      alert("Please complete token name, symbol, and supply.");
      return;
    }

    const isPlaceholder =
      !project?.description ||
      project.description === "Auto-created from dashboard." ||
      project.description.startsWith("Project workspace for ");

    if (isPlaceholder) {
      alert("Please add a real description before submitting for review.");
      return;
    }

    try {
      setLoadingAction(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const userId = user?.id;
      if (!userId || !UUID_RE.test(userId)) {
        alert("Please sign in with a valid account to submit for review.");
        return;
      }

      const res = await fetch(`${API_BASE}/api/projects/${id}/submit-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          user_id: userId,
        },
        body: JSON.stringify({
          token_name: tokenName.trim(),
          token_symbol: tokenSymbol.trim().toUpperCase(),
          token_supply: Number(tokenSupply),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to submit review");
      }

      await loadProject();
      await loadTokenMetadata();
      alert("Project submitted for review.");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to submit review");
    } finally {
      setLoadingAction(false);
    }
  }

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
      alert("Project approved.");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to approve project");
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
      alert("Project rejected.");
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to reject project");
    } finally {
      setLoadingAction(false);
    }
  }

  async function createToken() {
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
      alert(`Token created: ${data.mint}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to create token");
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
      alert(`Token status advanced to: ${data.token_status}`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to advance token status");
    } finally {
      setLoadingAction(false);
    }
  }

  useEffect(() => {
    loadProject();
    loadMemories();
    loadTokenMetadata();
    refreshMarketData();
    loadRedemptions();
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setIsOwner(Boolean(user?.id && project?.owner_id === user.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [project?.owner_id, project?.id]);

  // Gate banner to launch arrivals only (?launched=1 from /build redirect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("launched") === "1") setShowLiveBanner(true);
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

  const reviewStatus = projectStatus || "draft";
  const tokenStatus = normalizeTokenLifecycleStatus(
    tokenMeta.status || project?.token_status
  );
  const isSubmitted = reviewStatus === "submitted";
  const isRejected = reviewStatus === "rejected";
  const isPending = reviewStatus === "pending";
  const isApprovedProject = reviewStatus === "approved";
  const isTradingLive = tokenStatus === "trading_live";
  const canShowMarketUi = isTradingLive;

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

  const positionValue = walletBalance * Number(market?.price || 0);
  const numericTradeAmount = Number(tradeAmount || 0);
  const tradeGrossValue = numericTradeAmount * Number(market?.price || 0);
  const estimatedProjectFee = tradeGrossValue * PROJECT_FEE_RATE;
  const estimatedDumFee = tradeGrossValue * DUM_FEE_RATE;
  const estimatedTotalFees = estimatedProjectFee + estimatedDumFee;
  const estimatedBuyCost = tradeGrossValue + estimatedTotalFees;
  const estimatedSellProceeds = Math.max(0, tradeGrossValue - estimatedTotalFees);

  const referenceDepthTokens = useMemo(() => {
    const price = Number(market?.price || 0);
    const implied24hTokens = price > 0 ? Number(market?.volume_24h || 0) / price : 0;
    const supplyDepth = Number(market?.circulating_supply || market?.max_supply || project?.token_supply || 0) * 0.005;
    return Math.max(implied24hTokens * 0.35, supplyDepth, 1000);
  }, [market, project?.token_supply]);

  const estimatedPriceImpactPct = useMemo(() => {
    if (!numericTradeAmount || numericTradeAmount <= 0) return 0;
    return (numericTradeAmount / referenceDepthTokens) * 100;
  }, [numericTradeAmount, referenceDepthTokens]);

  const impactTone =
    estimatedPriceImpactPct >= 5
      ? "text-red-300 border-red-400/30 bg-red-950/20"
      : estimatedPriceImpactPct >= 2
      ? "text-yellow-300 border-yellow-400/30 bg-yellow-950/20"
      : "text-emerald-300 border-emerald-400/30 bg-emerald-950/20";

const heroUtility =
  parsedAiOutput?.token_utility ||
  project?.token_utility ||
  `Hold ${project?.token_symbol || tokenMeta.symbol || "this token"} to unlock deeper project access and utility inside DUM Club.`;
 
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
  const statusBanner = canShowMarketUi
    ? "Approved / Live - trading enabled"
    : isApprovedProject
    ? "Approved - ready to launch token trading"
    : isRejected
    ? "Rejected - needs changes before resubmission"
    : isSubmitted
    ? "Submitted for Review - awaiting admin review"
    : isPending
    ? "Pending - created but not submitted"
    : "Draft - continue setting up your project";
  const nextTokenActionLabel =
    tokenStatus === "draft"
      ? "Create Token"
      : tokenStatus === "mint_created"
      ? "Advance to Tokens Minted"
      : tokenStatus === "tokens_minted"
      ? "Advance to Liquidity Added"
      : tokenStatus === "liquidity_added"
      ? "Advance to Trading Live"
      : "Launch In Progress";
  const averageRating = feedbackEntries.length
    ? feedbackEntries.reduce((acc, item) => acc + item.rating, 0) / feedbackEntries.length
    : 0;
  const nextStepMessage = isRejected
    ? "Make edits and resubmit"
    : isSubmitted
    ? "Waiting for admin approval"
    : isPending
    ? "Ready to submit for review"
    : "Complete your project details";

  // ── Hero display values (read-only aliases; gates unchanged) ─────────────
  const heroTitle = projectName;
  const displaySymbol = (project?.token_symbol || tokenSymbol || tokenMeta.symbol || "TOKEN").toUpperCase();
  const displayStatusLabel = formatTokenStatus(tokenStatus);

  const hasMarketSnapshot = Boolean(
    canShowMarketUi && market != null && Number(market.price ?? 0) > 0
  );
  const heroPrice = Number(market?.price || 0);
  const heroPriceChangePct = rangeChangePct;
  const heroPriceUp = heroPriceChangePct >= 0;

  const utilityBullets: string[] = useMemo(() => {
    const raw = (project?.utility_value || "").trim();
    if (raw.includes("•") || raw.includes("\n")) {
      return raw
        .split(/[•\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 4)
        .slice(0, 3);
    }
    const first = raw || "Unlock premium access";
    return [
      first,
      "AI-powered features for holders",
      "Ecosystem growth benefits",
    ].slice(0, 3);
  }, [project?.utility_value]);

  const scrollToBuyPanel = () => {
    document.getElementById("buy-panel")?.scrollIntoView({ behavior: "smooth" });
  };
  const scrollToAiWorkspace = () => {
    document.getElementById("ai-workspace")?.scrollIntoView({ behavior: "smooth" });
  };

  const supplyDisplay =
    project?.token_supply != null && project.token_supply > 0
      ? formatNumber(project.token_supply, 0)
      : tokenMeta.supply
      ? formatNumber(Number(tokenMeta.supply), 0)
      : "—";

return (
  <div
    className={`min-h-screen bg-black px-4 py-10 text-white sm:px-6 ${
      canShowMarketUi && hasMarketSnapshot ? "pb-28 lg:pb-24" : ""
    }`}
  >
    <div className="mx-auto max-w-7xl">
      {isOwner && showLiveBanner && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 animate-fade-slide-down">
          <div className="flex items-center gap-3">
            <span className="text-emerald-400">✦</span>
            <span className="text-sm font-semibold text-emerald-200">
              <span className="font-mono uppercase tracking-[0.15em]">{heroTitle}</span>
              {" is live — "}
              <span className="font-normal text-emerald-300/80">share it with your community</span>
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
              className="rounded-lg border border-emerald-400/40 px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
            >
              {bannerCopied ? "Copied ✓" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => setShowLiveBanner(false)}
              aria-label="Dismiss"
              className="text-emerald-600 transition hover:text-emerald-400"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <Link
        href="/discover"
        className="mb-8 inline-flex rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
      >
        ← Back to Feed
      </Link>

      <div
        className="mb-8 rounded-3xl border border-zinc-900 bg-black p-8 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
        style={{
          borderTop: `3px solid ${accent}`,
          boxShadow: `0 0 1px rgba(255,255,255,0.02), 0 0 40px rgba(0,255,178,0.06)`,
        }}
      >
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950 text-4xl shadow-inner">
              {emoji}
            </div>

            <div className="max-w-4xl">
              <div className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-600">
                Project Profile
              </div>

              {loadingProject ? (
                <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-800 sm:h-14" />
              ) : (
                <h1 className="font-mono text-4xl font-bold leading-tight text-white sm:text-6xl">
                  {projectName}
                </h1>
              )}

              {loadingProject ? (
                <div className="mt-2 h-4 w-80 animate-pulse rounded bg-zinc-800" />
              ) : (
                <p className="mt-2 max-w-2xl text-sm text-zinc-400 sm:text-base">{heroUtility}</p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                <span
                  className="rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]"
                  style={{ borderColor: accent, color: accent }}
                >
                  {category}
                </span>
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/40 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Why hold this token
                </p>
                <ul className="space-y-2">
                  {utilityBullets.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                      <span className="mt-0.5 text-emerald-400">✦</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="w-full space-y-3 lg:w-80">
            {canShowMarketUi && (
              <div className="flex items-center justify-end gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-medium text-emerald-400">LIVE MARKET</span>
              </div>
            )}

            {hasMarketSnapshot ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="mb-1 text-xs text-zinc-500">Current Price</div>
                <div className="flex items-end gap-3">
                  <span className="text-3xl font-black text-white">
                    ${heroPrice ? formatPrice(heroPrice) : "0.000000"}
                  </span>
                  <span
                    className={`mb-1 text-sm font-semibold ${
                      heroPriceUp ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {heroPriceUp ? "+" : ""}
                    {heroPriceChangePct.toFixed(2)}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
                  <div>
                    <div className="text-xs text-zinc-500">Market Cap</div>
                    <div className="text-sm font-semibold text-white">
                      {market?.market_cap != null ? `$${formatNumber(market.market_cap, 2)}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Volume 24h</div>
                    <div className="text-sm font-semibold text-white">
                      {market?.volume_24h != null ? `$${formatNumber(market.volume_24h, 2)}` : "—"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-zinc-800 bg-black/40 p-3">
                  <p className="text-xs font-medium text-emerald-400">Holder benefit</p>
                  <p className="mt-1 text-sm text-zinc-300">
                    {chatMeta.holder_unlimited
                      ? "Holding unlocks unlimited AI access and deeper project utility."
                      : "This token powers access, perks, and participation in the project."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="mb-1 text-xs text-zinc-500">Token</div>
                <div className="text-2xl font-black text-white">${displaySymbol}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
                  <div>
                    <div className="text-xs text-zinc-500">Supply</div>
                    <div className="text-sm font-semibold text-white">{supplyDisplay}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Launch stage</div>
                    <div className="text-sm font-semibold text-zinc-300">{displayStatusLabel}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-lg bg-zinc-800/50 px-3 py-2 text-xs text-zinc-400">
                  {isApprovedProject
                    ? "Approved — completing token launch"
                    : "Pending review before market launch"}
                </div>
                <div className="mt-3 text-xs text-zinc-500">
                  Early stage — supply and liquidity still forming.
                </div>
              </div>
            )}

            {canShowMarketUi ? (
              <>
                <button
                  type="button"
                  onClick={scrollToBuyPanel}
                  className="w-full rounded-xl bg-emerald-500 px-5 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-400 active:scale-[0.98]"
                >
                  Buy ${displaySymbol}
                </button>
                <button
                  type="button"
                  onClick={scrollToAiWorkspace}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Ask AI →
                </button>
                {Boolean(serviceProfile?.is_active) && (
                  <Link
                    href={`/project/${id}/book`}
                    className="block w-full px-5 py-2 text-center font-mono text-xs text-zinc-600 transition hover:text-zinc-300"
                  >
                    Book service →
                  </Link>
                )}
                {isOwner && (
                  Boolean(serviceProfile?.is_active) ? (
                    <Link
                      href={`/project/${id}/manage`}
                      className="block w-full rounded-xl border border-zinc-800 px-5 py-2 text-center font-mono text-xs text-zinc-600 transition hover:text-zinc-300"
                    >
                      Manage bookings →
                    </Link>
                  ) : serviceProfile ? (
                    <div className="rounded-xl border border-dashed border-zinc-700 px-5 py-3 text-center">
                      <Link
                        href={`/project/${id}/manage`}
                        className="block font-mono text-xs text-emerald-400/70 transition hover:text-emerald-400"
                      >
                        Set up your service →
                      </Link>
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Turn this project into a bookable offer
                      </p>
                    </div>
                  ) : null
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={scrollToAiWorkspace}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Ask AI →
                </button>
                {Boolean(serviceProfile?.is_active) && (
                  <Link
                    href={`/project/${id}/book`}
                    className="block w-full px-5 py-2 text-center font-mono text-xs text-zinc-600 transition hover:text-zinc-300"
                  >
                    Book service →
                  </Link>
                )}
                {isOwner && (
                  Boolean(serviceProfile?.is_active) ? (
                    <Link
                      href={`/project/${id}/manage`}
                      className="block w-full rounded-xl border border-zinc-800 px-5 py-2 text-center font-mono text-xs text-zinc-600 transition hover:text-zinc-300"
                    >
                      Manage bookings →
                    </Link>
                  ) : serviceProfile ? (
                    <div className="rounded-xl border border-dashed border-zinc-700 px-5 py-3 text-center">
                      <Link
                        href={`/project/${id}/manage`}
                        className="block font-mono text-xs text-emerald-400/70 transition hover:text-emerald-400"
                      >
                        Set up your service →
                      </Link>
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Turn this project into a bookable offer
                      </p>
                    </div>
                  ) : null
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
        <div className="mb-3 text-xs uppercase tracking-[0.3em] text-zinc-600">About this project</div>
        {loadingProject ? (
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-zinc-800" />
          </div>
        ) : (
          <p className="max-w-3xl text-base leading-relaxed text-zinc-300">
            {project?.description || parsedAiOutput?.description || "No description available yet."}
          </p>
        )}
        {project?.prompt && (
          <p className="mt-4 text-sm text-zinc-500">
            Launched from the idea: &ldquo;{project.prompt}&rdquo;
          </p>
        )}
      </div>

      {canShowMarketUi && hasMarketSnapshot && (
        <div className="mb-8 border-b border-t border-zinc-800 bg-black">
          <div className="mx-auto max-w-7xl px-2">
            <div className="flex items-center divide-x divide-zinc-800 overflow-x-auto">
              {[
                {
                  label: "Price",
                  value: `$${formatPrice(market?.price)}`,
                },
                {
                  label: "24h Change",
                  value: `${heroPriceUp ? "+" : ""}${heroPriceChangePct.toFixed(2)}%`,
                  positive: heroPriceUp,
                },
                {
                  label: "Market Cap",
                  value:
                    market?.market_cap != null ? `$${formatNumber(market.market_cap, 2)}` : "—",
                },
                {
                  label: "Volume 24h",
                  value:
                    market?.volume_24h != null ? `$${formatNumber(market.volume_24h, 2)}` : "—",
                },
                {
                  label: "Last Trade",
                  value: market?.last_trade_at ? formatDateTime(market.last_trade_at) : "—",
                },
                ...(supplyDisplay !== "—"
                  ? [
                      {
                        label: "Supply",
                        value: supplyDisplay,
                      },
                    ]
                  : []),
              ].map((stat: { label: string; value: string; positive?: boolean }) => (
                <div key={stat.label} className="min-w-0 flex-shrink-0 px-4 py-3 sm:px-5">
                  <div className="text-xs text-zinc-500">{stat.label}</div>
                  <div
                    className={`text-sm font-semibold ${
                      stat.positive === true
                        ? "text-emerald-400"
                        : stat.positive === false
                        ? "text-red-400"
                        : "text-white"
                    }`}
                  >
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-200">
          <span className="font-mono uppercase tracking-[0.18em] text-zinc-400">
            Review & publication
          </span>
          <div className="mt-2 text-base text-white">{statusBanner}</div>
        </div>
      )}

      <div id="ai-workspace" className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
        <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">AI Workspace</div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-zinc-700 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
            {chatMeta.is_holder ? "Holder" : "Non-holder"}
          </span>

          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] ${
              chatMeta.locked ? "border-red-400/30 text-red-300" : "border-zinc-700 text-zinc-300"
            }`}
          >
            {chatMeta.is_holder && chatMeta.holder_unlimited
              ? "Unlimited AI"
              : chatMeta.free_questions_left > 0
              ? `${chatMeta.free_questions_left} FREE QUESTION${
                  chatMeta.free_questions_left === 1 ? "" : "S"
                }`
              : "SUPPORT TO UNLOCK"}
          </span>

          <span className="rounded-full border border-zinc-700 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
            Mint: {shortMint(chatMeta.token_mint_address || project?.token_mint_address)}
          </span>
        </div>

        <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
          <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-emerald-300">Token-Gated Utility</div>
          <div className="text-sm text-zinc-300">
            {chatMeta.is_holder && chatMeta.holder_unlimited
              ? `Wallet recognized. ${project?.token_symbol || tokenMeta.symbol || "Token"} holders have unlimited AI access on this project.`
              : `This project gives ${chatMeta.free_limit} free AI questions. Hold ${project?.token_symbol || tokenMeta.symbol || "the project token"} to unlock deeper ongoing access.`}
          </div>
        </div>

        <h2 className="font-mono text-3xl font-bold text-white">Ask AI</h2>

        <p className="mt-3 text-zinc-500">
          This project includes {chatMeta.free_limit} free AI question
          {chatMeta.free_limit === 1 ? "" : "s"}. Support it by holding its token to unlock
          unlimited AI access.
        </p>

        {chatMeta.locked && (
          <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-zinc-950 p-5">
            <p className="text-sm text-zinc-400">{chatMeta.lock_message}</p>
            {canShowMarketUi && (
              <button
                type="button"
                onClick={scrollToBuyPanel}
                className="mt-3 w-full rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 active:scale-[0.98]"
              >
                Get ${displaySymbol} to unlock →
              </button>
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
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={loadingAsk || chatMeta.locked || !question.trim()}
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {loadingAsk ? "Asking..." : chatMeta.locked ? "Hold Token to Unlock" : "Ask AI"}
          </button>
        </form>

        <div className="mt-10">
          <h3 className="font-mono text-2xl font-bold text-white">AI Response</h3>

          <div className="mt-4 min-h-[220px] whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-black p-4 text-zinc-300">
            {response || (
              <span className="text-zinc-600">
                Ask a question above — the AI knows this project deeply.
              </span>
            )}
          </div>
        </div>
      </div>

      {canShowMarketUi ? (
      <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">
              Token Activity
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className={`font-mono text-2xl ${rangeChangePct >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                {formatPercent(rangeChangePct, 2)}
              </span>
              <span className="text-sm text-zinc-500">selected range</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(["1H", "1D", "1W", "1M", "ALL"] as ChartRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setChartRange(range)}
                className={`rounded-full border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
                  chartRange === range
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "border-zinc-800 bg-black text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

          <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            {trades.length === 0 ? (
              <div className="flex flex-col justify-center gap-6 rounded-3xl border border-zinc-800 bg-black p-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
                  ◆ Day Zero
                </div>
                <div>
                  <h3 className="font-mono text-2xl font-bold text-white">
                    Be the first to support this project
                  </h3>
                  <p className="mt-3 max-w-sm text-zinc-400">
                    No trades yet. Early supporters back ideas before the market
                    does — and shape the token's opening price history.
                  </p>
                </div>
                <p className="text-sm text-zinc-500">
                  <span className="font-mono text-zinc-400">${displaySymbol}</span>
                  {" · "}Starting price{" "}
                  {market?.price ? `$${formatPrice(market.price)}` : "$0.001000"}
                  {supplyDisplay !== "—" && <>{" · "}{supplyDisplay} supply</>}
                </p>
              </div>
            ) : (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-5">
                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-zinc-600">Price</div>
                  <div className="font-mono text-2xl text-white">${formatPrice(market?.price)}</div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-zinc-600">Market Cap</div>
                  <div className="font-mono text-2xl text-white">${formatNumber(market?.market_cap, 4)}</div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-zinc-600">24h Volume</div>
                  <div className="font-mono text-2xl text-white">${formatNumber(market?.volume_24h, 4)}</div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-zinc-600">Last Trade</div>
                  <div className="text-sm text-zinc-300">{formatDateTime(market?.last_trade_at)}</div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.25em] text-zinc-600">Flow</div>
                  <div className="font-mono text-sm text-zinc-300">
                    <span className="text-emerald-300">{buyCount} buy</span>
                    <span className="mx-2 text-zinc-600">/</span>
                    <span className="text-red-300">{sellCount} sell</span>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">
                    Price Chart
                  </div>
                  <div className="text-xs text-zinc-500">
                    {chartData.length ? `${chartData.length} data points` : "No chart data"}
                  </div>
                </div>

                <div style={{ width: "100%", height: 310 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis dataKey="time" stroke="#666" tickLine={false} axisLine={false} />
                      <YAxis stroke="#666" tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                      <Tooltip
                        contentStyle={{
                          background: "#050505",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 16,
                          color: "#fff",
                        }}
                        labelStyle={{ color: "#9ca3af" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#00FFB2"
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <details className="rounded-3xl border border-zinc-800 bg-black">
                <summary className="cursor-pointer select-none px-5 py-4 text-xs uppercase tracking-[0.25em] text-zinc-600 hover:text-zinc-400">
                  Latest Candle OHLCV ▸
                </summary>
                <div className="px-5 pb-5">
                  <div className="grid gap-4 sm:grid-cols-5">
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Open</div>
                      <div className="mt-2 font-mono text-white">{formatPrice(selectedLatestCandle?.open)}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">High</div>
                      <div className="mt-2 font-mono text-white">{formatPrice(selectedLatestCandle?.high)}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Low</div>
                      <div className="mt-2 font-mono text-white">{formatPrice(selectedLatestCandle?.low)}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Close</div>
                      <div className="mt-2 font-mono text-white">{formatPrice(selectedLatestCandle?.close)}</div>
                    </div>
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Volume</div>
                      <div className="mt-2 font-mono text-white">{formatNumber(selectedLatestCandle?.volume, 4)}</div>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-zinc-500">
                    Candle Bucket: {selectedLatestCandle?.bucket_time ? formatDateTime(selectedLatestCandle.bucket_time) : "-"}
                  </div>
                </div>
              </details>

              <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Recent Trades</div>
                  <button
                    type="button"
                    onClick={refreshMarketData}
                    className="rounded-full border border-zinc-700 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-300 transition hover:bg-zinc-900"
                  >
                    Refresh
                  </button>
                </div>

                {trades.length === 0 ? (
                  <div className="text-sm text-zinc-500">No trades yet.</div>
                ) : (
                  <div className="space-y-3">
                    {trades.slice(0, 8).map((trade) => (
                      <div
                        key={trade.id}
                        className="grid gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm md:grid-cols-[90px_1.05fr_0.9fr_0.9fr_1.2fr]"
                      >
                        <div
                          className={`font-mono uppercase tracking-[0.15em] ${
                            trade.side === "buy" ? "text-emerald-300" : "text-red-300"
                          }`}
                        >
                          {trade.side}
                        </div>
                        <div className="text-zinc-300">
                          {formatNumber(trade.amount, 2)} {trade.token_symbol || ""}
                        </div>
                        <div className="font-mono text-zinc-300">${formatPrice(trade.price)}</div>
                        <div className="font-mono text-zinc-300">${formatNumber(trade.gross_value, 6)}</div>
                        <div className="text-zinc-500">{formatDateTime(trade.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            <div id="buy-panel" className="rounded-3xl border border-zinc-800 bg-black p-5">
              <div className="mb-4 text-xs uppercase tracking-[0.25em] text-zinc-600">{displaySymbol} · Support this project</div>

              <h2 className="font-mono text-2xl font-bold text-white">Buy / Sell</h2>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                    Token Amount
                  </label>
                  <input
                    value={tradeAmount}
                    onChange={(e) => setTradeAmount(e.target.value)}
                    placeholder={`Enter ${project?.token_symbol || tokenMeta.symbol || "token"} amount`}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                    type="number"
                    min="0"
                    step="any"
                  />
                </div>

                <div className="mb-1 flex rounded-xl border border-zinc-800 p-1">
                  <button
                    type="button"
                    onClick={() => setTradeTab("buy")}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${
                      tradeTab === "buy"
                        ? "bg-emerald-500 text-black"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setTradeTab("sell")}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${
                      tradeTab === "sell"
                        ? "bg-red-500 text-white"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Sell
                  </button>
                </div>

                <button
                  type="button"
                  disabled={loadingTrade}
                  onClick={() => executeTrade(tradeTab)}
                  className={`w-full rounded-xl py-3.5 text-sm font-bold transition disabled:opacity-50 ${
                    tradeTab === "buy"
                      ? "bg-emerald-500 text-black hover:bg-emerald-400"
                      : "bg-red-500 text-white hover:bg-red-400"
                  }`}
                >
                  {loadingTrade
                    ? "Working..."
                    : tradeTab === "buy"
                    ? `Buy $${displaySymbol}`
                    : `Sell $${displaySymbol}`}
                </button>

                {tradeMessage && (
                  <div
                    className={`rounded-2xl border p-4 text-sm ${
                      tradeWinFlash
                        ? "win-flash border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                        : tradeIsError
                        ? "border-red-500/30 bg-red-950/20 text-red-300"
                        : "border-zinc-800 bg-zinc-950 text-zinc-300"
                    }`}
                  >
                    {tradeMessage}
                  </div>
                )}
              </div>
              <div className="mt-8 grid gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
  <div className="flex items-center justify-between gap-4">
    <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Project Fee</span>
    <span className="font-mono text-zinc-300">1.50%</span>
  </div>
  <div className="flex items-center justify-between gap-4">
    <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">DUM Fee</span>
    <span className="font-mono text-zinc-300">0.50%</span>
  </div>
  <div className="flex items-center justify-between gap-4">
    <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Total Fee</span>
    <span className="font-mono text-white">2.00%</span>
  </div>
</div>
<details className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950">
  <summary className="cursor-pointer select-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-400">
    Holder access ▸
  </summary>
  <div className="p-4 pt-0">
  <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-600">
    Holder Access
  </div>

  <div className="mb-3 text-sm text-zinc-400">
    Use tokens to signal support and unlock holder access.
  </div>

  <input
    value={redeemAmount}
    onChange={(e) => setRedeemAmount(e.target.value)}
    placeholder={`Enter ${project?.token_symbol || tokenMeta.symbol || "token"} amount`}
    className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-white"
    type="number"
    min="0"
    step="any"
  />

  <button
    type="button"
    onClick={handleRedeem}
    disabled={loadingRedeem}
    className="mt-3 w-full rounded-xl bg-green-500 py-2 font-semibold text-black disabled:opacity-50"
  >
    {loadingRedeem ? "Unlocking..." : "Unlock Access"}
  </button>

  {redeemStatus && (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-black p-3 text-sm text-zinc-300">
      {redeemStatus}
    </div>
  )}

  {redeemCode && (
    <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">
        Access Code
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-white">{redeemCode}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(redeemCode);
              setCopyFlash(true);
              window.setTimeout(() => setCopyFlash(false), 800);
            } catch {
              setRedeemStatus("Could not copy to clipboard.");
            }
          }}
          className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
            copyFlash
              ? "border-emerald-400 bg-emerald-400/20 text-emerald-200"
              : "border-zinc-600 text-zinc-300 hover:border-emerald-500/50"
          }`}
        >
          {copyFlash ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const sym =
                project?.token_symbol || tokenMeta.symbol || "TOKEN";
              const base =
                typeof window !== "undefined"
                  ? window.location.origin
                  : process.env.NEXT_PUBLIC_SITE_URL || "https://dumclub.xyz";
              const projectUrl = `${base.replace(/\/$/, "")}/project/${id}`;
              await navigator.clipboard.writeText(
                `Just unlocked $${sym} holder access on DUM Club.\n\nCode: ${redeemCode}\nProject: ${projectName}\n\n${projectUrl}`
              );
              setShareFlash(true);
              window.setTimeout(() => setShareFlash(false), 800);
            } catch {
              setRedeemStatus("Could not copy share message.");
            }
          }}
          className={`rounded-lg border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition ${
            shareFlash
              ? "border-emerald-400 bg-emerald-400/20 text-emerald-200"
              : "border-emerald-500/40 text-emerald-200/90 hover:border-emerald-400"
          }`}
        >
          {shareFlash ? "Copied" : "Share"}
        </button>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        Share this code with your team or drop it in Discord.
      </p>
      {project?.token_mint_address && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-black/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Verified on Solana
          </div>
          <div className="mt-1 break-all font-mono text-[11px] text-zinc-400">
            Mint · {project.token_mint_address}
          </div>
        </div>
      )}
    </div>
  )}

  <div className="mt-4 rounded-xl border border-zinc-800 bg-black p-3">
    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Unlocked Utility</div>
    <div className="mt-2 text-sm text-zinc-300">
      {parsedAiOutput?.token_utility || project?.token_utility || "Utility details are not configured yet."}
    </div>
  </div>

  <div className="mt-4 border-t border-zinc-800 pt-4">
    <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-600">
      Access History
    </div>

    {redemptions.length === 0 ? (
      <div className="text-sm text-zinc-500">No access history yet.</div>
    ) : (
      <div className="space-y-2">
        {redemptions.slice(0, 5).map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-zinc-800 bg-black p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-sm text-white">{item.code}</div>
              <div className="text-xs uppercase tracking-[0.15em] text-zinc-500">
                {item.status}
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-zinc-400">
              <div>
                {formatNumber(item.amount, 2)}{" "}
                {project?.token_symbol || tokenMeta.symbol || "TOKENS"}
              </div>
              <div>{formatDateTime(item.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>

  <div className="mt-4 border-t border-zinc-800 pt-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Trust Layer</div>
      <div className="text-xs text-zinc-500">
        {feedbackEntries.length
          ? `${averageRating.toFixed(1)} / 5 (${feedbackEntries.length} review${
              feedbackEntries.length === 1 ? "" : "s"
            })`
          : "No ratings yet"}
      </div>
    </div>

    <form onSubmit={submitFeedback} className="space-y-3">
      <div>
        <label className="mb-2 block text-[11px] uppercase tracking-[0.2em] text-zinc-600">Rating</label>
        <select
          value={feedbackRating}
          onChange={(e) => setFeedbackRating(Number(e.target.value))}
          className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-white"
        >
          <option value={5}>5 - Excellent</option>
          <option value={4}>4 - Good</option>
          <option value={3}>3 - Okay</option>
          <option value={2}>2 - Poor</option>
          <option value={1}>1 - Bad</option>
        </select>
      </div>

      <textarea
        value={feedbackComment}
        onChange={(e) => setFeedbackComment(e.target.value)}
        rows={3}
        placeholder="Share a quick note about this project..."
        className="w-full rounded-xl border border-zinc-700 bg-black px-3 py-2 text-white"
      />

      <button
        type="submit"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
      >
        Save Review
      </button>
    </form>
  </div>
  </div>
</details>
              <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="mb-4 text-[11px] uppercase tracking-[0.22em] text-zinc-600">Trade Preview</div>

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Current Price</span>
                    <span className="font-mono text-zinc-300">${formatPrice(market?.price)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Trade Amount</span>
                    <span className="font-mono text-zinc-300">
                      {formatNumber(numericTradeAmount, 2)} {project?.token_symbol || tokenMeta.symbol || ""}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Gross Value</span>
                    <span className="font-mono text-zinc-300">${formatNumber(tradeGrossValue, 4)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Project Fee</span>
                    <span className="font-mono text-zinc-300">${formatNumber(estimatedProjectFee, 4)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">DUM Fee</span>
                    <span className="font-mono text-zinc-300">${formatNumber(estimatedDumFee, 4)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-zinc-800 pt-3">
                    <span className="text-zinc-400">Est. Buy Cost</span>
                    <span className="font-mono text-white">${formatNumber(estimatedBuyCost, 4)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-400">Est. Sell Proceeds</span>
                    <span className="font-mono text-white">${formatNumber(estimatedSellProceeds, 4)}</span>
                  </div>

                  <div className={`mt-2 rounded-2xl border p-3 text-sm ${impactTone}`}>
                    <div className="flex items-center justify-between gap-4">
                      <span>Est. Price Impact</span>
                      <span className="font-mono">{formatPercent(estimatedPriceImpactPct, 2)}</span>
                    </div>
                    <div className="mt-2 text-xs opacity-90">
                      Frontend estimate based on trade size versus recent activity and available supply depth.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-600">Quick Snapshot</div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Your Balance</div>
                    <div className="mt-2 font-mono text-2xl text-white">
                      {formatNumber(walletBalance, 2)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {project?.token_symbol || tokenMeta.symbol || ""}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Mark Value Est.</div>
                    <div className="mt-2 font-mono text-2xl text-white">
                      ${formatNumber(positionValue, 4)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Based on latest trade price
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Connected Wallet</span>
                    <span className="font-mono text-zinc-300">{shortMint(userWallet)}</span>
                  </div>

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-500">Available to Sell</span>
                    <span className="font-mono text-zinc-300">
                      {formatNumber(walletBalance, 2)} {project?.token_symbol || tokenMeta.symbol || ""}
                    </span>
                  </div>

                  <div className="text-[11px] text-zinc-500">
                    Mark value is an estimate only and may differ from actual exit value depending on trade size and liquidity.
                  </div>

                  <details className="mt-2 rounded-2xl border border-zinc-800 bg-black">
                    <summary className="cursor-pointer select-none px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-400">
                      Token Structure ▸
                    </summary>
                    <div className="space-y-3 px-4 pb-4">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500">Circulating</span>
                        <span className="font-mono text-zinc-300">
                          {formatNumber(market?.circulating_supply, 2)} {project?.token_symbol || tokenMeta.symbol || ""}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500">Max Supply</span>
                        <span className="font-mono text-zinc-300">
                          {formatNumber(
                            market?.max_supply || Number(tokenMeta.supply) || project?.token_supply,
                            2
                          )}{" "}
                          {project?.token_symbol || tokenMeta.symbol || ""}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500">Symbol</span>
                        <span className="font-mono text-zinc-300">
                          {project?.token_symbol || tokenMeta.symbol || "-"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-500">Mint</span>
                        <span className="font-mono text-zinc-300">
                          {shortMint(tokenMeta.mint_address || project?.token_mint_address)}
                        </span>
                      </div>
                    </div>
                  </details>

                  <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600">Market Trust Signals</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <div className="font-mono text-lg text-white">{trades.length}</div>
                        <div className="text-xs text-zinc-500">Recent trades</div>
                      </div>
                      <div>
                        <div className="font-mono text-lg text-white">{uniqueTradeSources}</div>
                        <div className="text-xs text-zinc-500">Active participants</div>
                      </div>
                      <div>
                        <div className="font-mono text-lg text-white">{formatCurrencyCompact(market?.volume_24h, 2)}</div>
                        <div className="text-xs text-zinc-500">24h volume</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : isApprovedProject ? (
        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Approved Launch</div>
          <h2 className="font-mono text-3xl font-bold text-white">Approved - Ready to Mint</h2>
          <p className="mt-3 max-w-3xl text-zinc-400">
            This project is approved. Complete token launch steps to unlock live market and trading UI.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Token Name</div>
              <div className="mt-2 text-white">{tokenMeta.name || project?.token_name || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Symbol</div>
              <div className="mt-2 text-white">{tokenMeta.symbol || project?.token_symbol || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Supply</div>
              <div className="mt-2 text-white">{tokenMeta.supply || project?.token_supply || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Launch stage</div>
              <div className="mt-2 text-white">{formatTokenStatus(tokenStatus)}</div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-300">
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">Publication</span>
            <div className="mt-2 text-white">{project?.status || "draft"}</div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              disabled={loadingAction || tokenStatus === "trading_live"}
              onClick={tokenStatus === "draft" ? createToken : advanceTokenStatus}
              className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
              style={{ background: accent }}
            >
              {loadingAction ? "Working..." : nextTokenActionLabel}
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {tokenStages.map((stage, index) => {
              const isCompleted = index <= tokenStage;
              const isCurrent = index === tokenStage;
              return (
                <div
                  key={`launch-${stage}`}
                  className={`rounded-2xl border p-4 text-center ${
                    isCompleted ? "border-emerald-400/40 bg-emerald-400/10" : "border-zinc-800 bg-black"
                  }`}
                >
                  <div
                    className={`text-[11px] uppercase tracking-[0.22em] ${
                      isCurrent
                        ? "text-emerald-300"
                        : isCompleted
                        ? "text-zinc-200"
                        : "text-zinc-600"
                    }`}
                  >
                    {stage}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Pre-live Project</div>
          <h2 className="font-mono text-3xl font-bold text-white">{projectName}</h2>
          <p className="mt-3 max-w-3xl text-zinc-400">
            {project?.description || parsedAiOutput?.description || "No description available yet."}
          </p>

          <div className="mt-4 inline-flex rounded-full border border-zinc-700 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-300">
            {category}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Token Name</div>
              <div className="mt-2 text-white">{tokenMeta.name || project?.token_name || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Symbol</div>
              <div className="mt-2 text-white">{tokenMeta.symbol || project?.token_symbol || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Supply</div>
              <div className="mt-2 text-white">{tokenMeta.supply || project?.token_supply || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Review</div>
              <div className="mt-2 text-white">{reviewStatus}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Publication</div>
              <div className="mt-2 text-white">{project?.status || "draft"}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Next Step</div>
            <div className="mt-2 text-sm text-zinc-200">{nextStepMessage}</div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded-2xl border border-zinc-700 bg-black px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-900"
            >
              Edit Project
            </Link>
            {(reviewStatus === "draft" || reviewStatus === "pending") && (
              <button
                type="button"
                onClick={() => submitReview()}
                disabled={loadingAction}
                className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                style={{ background: accent }}
              >
                {loadingAction ? "Submitting..." : "Submit for Review"}
              </button>
            )}
          </div>
        </div>
      )}

        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Launch stage</div>

          <div className="mb-8 grid gap-3 md:grid-cols-5">
            {tokenStages.map((stage, index) => {
              const isCompleted = index <= tokenStage;
              const isCurrent = index === tokenStage;

              return (
                <div
                  key={stage}
                  className={`rounded-2xl border p-4 text-center ${
                    isCompleted ? "border-emerald-400/40 bg-emerald-400/10" : "border-zinc-800 bg-black"
                  }`}
                >
                  <div
                    className={`text-[11px] uppercase tracking-[0.22em] ${
                      isCurrent
                        ? "text-emerald-300"
                        : isCompleted
                        ? "text-zinc-200"
                        : "text-zinc-600"
                    }`}
                  >
                    {stage}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mb-6 rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-400">
            {getStatusExplanation(tokenStatus)}
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Token Name</div>
              <div className="mt-2 break-words text-lg text-white">
                {tokenMeta.name || project?.token_name || "-"}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Symbol</div>
              <div className="mt-2 break-words text-lg text-white">
                {tokenMeta.symbol || project?.token_symbol || "-"}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Supply</div>
              <div className="mt-2 break-words text-lg text-white">
                {tokenMeta.supply || project?.token_supply || "-"}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Decimals</div>
              <div className="mt-2 break-words text-lg text-white">
                {tokenMeta.decimals || project?.token_decimals || "-"}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Launch stage</div>
              <div className="mt-2 break-words text-lg text-white">
                {formatTokenStatus(tokenStatus)}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Created At</div>
              <div className="mt-2 break-words text-sm text-white">{project?.token_created_at || "-"}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Mint Address</div>
            <div className="mt-2 break-all text-sm text-white">
              {tokenMeta.mint_address || project?.token_mint_address || "-"}
            </div>
          </div>
        </div>

        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-4 text-xs uppercase tracking-[0.3em] text-zinc-600">AI Blueprint</div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <h2 className="font-mono text-2xl font-bold text-white">Original Prompt</h2>
              <p className="mt-3 text-zinc-400">{project?.prompt || "No prompt saved yet."}</p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <h2 className="font-mono text-2xl font-bold text-white">Token Utility</h2>
              <p className="mt-3 text-zinc-400">
                {parsedAiOutput?.token_utility || project?.token_utility || "No token utility available yet."}
              </p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Description</div>
              <p className="mt-3 text-zinc-300">
                {parsedAiOutput?.description ||
                  project?.description ||
                  "No AI-generated description available yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Token Utility</div>
              <p className="mt-3 text-zinc-300">
                {parsedAiOutput?.token_utility || project?.token_utility || "No token utility available yet."}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black p-5">
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Template Type</div>
              <p className="mt-3 text-zinc-300">
                {parsedAiOutput?.template_type ||
                  project?.template_type ||
                  "No template type available yet."}
              </p>
            </div>
          </div>
        </div>

        {!isApprovedProject && (
          <div id="review-pipeline" className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Review Summary</div>

            <h2 className="font-mono text-3xl font-bold text-white">Submission Details</h2>

            <p className="mt-3 max-w-3xl text-zinc-500">
              This section shows the project details used during review. Submit action is available
              from the pre-live panel above.
            </p>

            <p className="mt-3 text-sm text-zinc-400">
              Review: {reviewStatus} · Publication: {project?.status || "draft"}
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Token Name</div>
                <div className="mt-2 text-white">{tokenName || project?.token_name || "-"}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Symbol</div>
                <div className="mt-2 text-white">{tokenSymbol || project?.token_symbol || "-"}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Supply</div>
                <div className="mt-2 text-white">{tokenSupply || project?.token_supply || "-"}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Utility</div>
                <div className="mt-2 text-white">
                  {parsedAiOutput?.token_utility || project?.token_utility || "-"}
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-300">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-zinc-600">Launch Checklist</div>
              <div>{nextStepMessage}</div>
            </div>
          </div>
        )}

        <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Project Memory</div>

            <h2 className="font-mono text-3xl font-bold text-white">Add Memory</h2>

            <p className="mt-3 max-w-2xl text-zinc-500">
              Paste a memory, note, creator post, transcript, or product insight so your AI can use it
              later.
            </p>

            {authUser ? (
            <form onSubmit={saveMemory} className="mt-6 space-y-4">
              <textarea
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                placeholder="Paste a memory, story, creator post, transcript, or note..."
                rows={7}
                className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <button
                type="submit"
                disabled={loadingMemory}
                className="w-full rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                style={{ background: accent }}
              >
                {loadingMemory ? "Saving..." : "Save Memory"}
              </button>
            </form>
             ) : (
             <div className="mt-6 rounded-2xl border border-zinc-800 bg-black/40 p-5 text-sm text-zinc-500">
             Sign in to add a project memory.
             </div>
             )}

            <div className="mt-10">
              <h3 className="font-mono text-2xl font-bold text-white">Saved Memories ({memories.length})</h3>

              {memories.length === 0 ? (
                <p className="mt-4 text-zinc-400">No memories saved yet.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {memories.map((memory) => (
                    <div key={memory.id} className="rounded-2xl border border-zinc-800 bg-black p-4 text-zinc-300">
                      {memory.content_text || memory.content || "Empty memory"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

    </div>

    {canShowMarketUi && hasMarketSnapshot && (
      <div className="fixed bottom-0 left-0 right-0 z-50 hidden border-t border-zinc-800 bg-black/90 backdrop-blur-md lg:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-4 lg:gap-6">
            <span className="truncate font-black text-white">{heroTitle}</span>
            <span className="font-mono text-sm text-zinc-400">${displaySymbol}</span>
            <span className="text-lg font-bold text-white">
              ${heroPrice ? formatPrice(heroPrice) : "0.000000"}
            </span>
            <span
              className={`text-sm font-semibold ${
                heroPriceUp ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {heroPriceUp ? "+" : ""}
              {heroPriceChangePct.toFixed(2)}%
            </span>
          </div>

          <div className="flex flex-shrink-0 items-center gap-3">
            <span className="hidden text-xs text-zinc-500 xl:inline">
              Holders unlock unlimited AI access
            </span>
            <button
              type="button"
              onClick={scrollToBuyPanel}
              className="rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-black transition hover:bg-emerald-400"
            >
              Buy ${displaySymbol}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
}

