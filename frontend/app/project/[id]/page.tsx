"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
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
  if (source.includes("tasty") || source.includes("meal") || source.includes("food") || source.includes("cook")) {
    return "AI Meal Planning";
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
  if (source.includes("tasty") || source.includes("meal") || source.includes("food") || source.includes("cook")) {
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
  const { publicKey, connected } = useWallet();

  const [project, setProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectStatus, setProjectStatus] = useState("draft");

  const [memoryText, setMemoryText] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState("No response yet.");

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
  const [loadingTrade, setLoadingTrade] = useState(false);
  const [tradeMessage, setTradeMessage] = useState("");
  const [chartRange, setChartRange] = useState<ChartRange>("1D");

  const [loadingMemory, setLoadingMemory] = useState(false);
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

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
    } catch (err) {
      console.error(err);
      setProject(null);
      setProjectName("Untitled Project");
      setProjectStatus("draft");
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
    if (!id || !tradeAmount.trim()) return;

    const numericAmount = Number(tradeAmount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setTradeMessage("Enter a valid amount.");
      return;
    }

    if (side === "sell" && numericAmount > walletBalance) {
      setTradeMessage(
        `Insufficient balance. You only have ${formatNumber(walletBalance, 2)} ${
          project?.token_symbol || tokenMeta.symbol || "TOKENS"
        }.`
      );
      return;
    }

    const wallet = userWallet?.trim();
    if (!wallet || wallet.length < 8) {
      setTradeMessage("Connected wallet not found.");
      return;
    }

    try {
      setLoadingTrade(true);
      setTradeMessage("");

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

      setTradeMessage(
        `${side === "buy" ? "Buy" : "Sell"} executed: ${formatNumber(numericAmount, 2)} ${
          project?.token_symbol || tokenMeta.symbol || "TOKENS"
        }`
      );

      setTradeAmount("");
      await refreshMarketData();
      await loadWalletBalance();
    } catch (err: any) {
      console.error(err);
      setTradeMessage(err?.message || `Failed to ${side}`);
    } finally {
      setLoadingTrade(false);
    }
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

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();

    if (!tokenName.trim() || !tokenSymbol.trim() || !tokenSupply.trim()) {
      alert("Please complete token name, symbol, and supply.");
      return;
    }

    try {
      setLoadingAction(true);

      const res = await fetch(`${API_BASE}/api/projects/${id}/submit-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          user_id: "demo-user",
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

  useEffect(() => {
    loadProject();
    loadMemories();
    loadTokenMetadata();
    refreshMarketData();
  }, [id]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setUserWallet(null);
      return;
    }

    setUserWallet(publicKey.toBase58());
  }, [connected, publicKey]);

  useEffect(() => {
    if (!id) return;

    const interval = setInterval(() => {
      refreshMarketData();
    }, 10000);

    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (!id || !userWallet) {
      setWalletBalance(0);
      return;
    }

    loadWalletBalance();
  }, [id, userWallet]);

  const reviewStatus = projectStatus || "draft";
  const isSubmitted = reviewStatus === "submitted";
  const isApproved = reviewStatus === "approved";
  const isTokenLive = reviewStatus === "token_live";
  const isRejected = reviewStatus === "rejected";

  const emoji = useMemo(() => getProjectEmoji(project), [project]);
  const category = useMemo(() => getCategory(project), [project]);
  const accent = useMemo(() => getAccent(project), [project]);
  const parsedAiOutput = useMemo(() => parseAiOutput(project?.ai_output), [project?.ai_output]);

  const tokenStage = getTokenStageIndex(tokenMeta.status || project?.token_status || "draft");
  const tokenStages = ["Draft", "Mint Created", "Tokens Minted", "Liquidity Added", "Trading Live"];
  const latestCandle = candles.length ? candles[candles.length - 1] : null;

  const filteredCandles = useMemo(() => {
    if (!candles.length || chartRange === "ALL") return candles;

    const latestTime = new Date(candles[candles.length - 1].bucket_time).getTime();
    const cutoff = latestTime - getRangeMs(chartRange);

    return candles.filter((c) => new Date(c.bucket_time).getTime() >= cutoff);
  }, [candles, chartRange]);

  const useCandles = filteredCandles.length ? filteredCandles : candles;
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

  return (
    <div className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
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
            boxShadow: `0 0 0 1px rgba(255,255,255,0.02), 0 0 40px rgba(0,255,178,0.06)`,
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

                <h1 className="font-mono text-4xl font-bold leading-tight text-white sm:text-6xl">
                  {projectName}
                </h1>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                  <span
                    className="rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em]"
                    style={{ borderColor: accent, color: accent }}
                  >
                    {category}
                  </span>

                  <span className="rounded-full border border-zinc-700 px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-zinc-300">
                    {project?.template_type || "ai_project"}
                  </span>

                  <span
                    className={`rounded-full border px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] ${
                      isTokenLive
                        ? "border-emerald-400/30 text-emerald-300"
                        : isApproved
                        ? "border-yellow-400/30 text-yellow-300"
                        : isSubmitted
                        ? "border-blue-400/30 text-blue-300"
                        : isRejected
                        ? "border-red-400/30 text-red-300"
                        : "border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {isTokenLive ? "TOKEN LIVE" : reviewStatus}
                  </span>

                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                    Market Active
                  </span>
                </div>

                <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
                  {project?.description ||
                    "This project is live inside DUM Club and ready to be expanded with memory, AI, and discovery."}
                </p>

                <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-emerald-300">
                    Utility Signal
                  </div>
                  <p className="text-sm leading-7 text-zinc-300">
                    {heroUtility}
                  </p>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-600">Price</div>
                    <div className="mt-2 font-mono text-2xl text-white">${formatPrice(market?.price)}</div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-600">Market Cap</div>
                    <div className="mt-2 font-mono text-2xl text-white">{formatCurrencyCompact(market?.market_cap, 2)}</div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-600">Range Change</div>
                    <div className={`mt-2 font-mono text-2xl ${rangeChangePct >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {formatPercent(rangeChangePct, 2)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-600">Activity</div>
                    <div className="mt-2 font-mono text-2xl text-white">{trades.length}</div>
                    <div className="mt-1 text-xs text-zinc-500">Recent trades</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {isSubmitted && (
                <>
                  <button
                    type="button"
                    disabled={loadingAction}
                    onClick={approveProject}
                    className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                    style={{ background: accent }}
                  >
                    {loadingAction ? "Working..." : "Approve"}
                  </button>

                  <button
                    type="button"
                    disabled={loadingAction}
                    onClick={rejectProject}
                    className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {loadingAction ? "Working..." : "Reject"}
                  </button>
                </>
              )}

              {isApproved && !project?.token_mint_address && (
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={createToken}
                  className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: accent }}
                >
                  {loadingAction ? "Minting..." : "Create Token"}
                </button>
              )}

              {isTokenLive && (
                <div className="rounded-2xl border border-emerald-400/30 px-4 py-3 font-mono text-xs uppercase tracking-[0.18em] text-emerald-300">
                  TOKEN LIVE
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">Project ID</div>
            <div className="break-all text-sm text-zinc-300">{id}</div>
          </div>

          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">Category</div>
            <div className="text-2xl font-semibold text-white">{category}</div>
          </div>

          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">Review Status</div>
            <div className="text-2xl font-semibold text-white">{isTokenLive ? "TOKEN LIVE" : reviewStatus}</div>
          </div>

          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-2 text-xs uppercase tracking-[0.3em] text-zinc-600">Memory Count</div>
            <div className="text-2xl font-semibold text-white">{memories.length}</div>
          </div>
        </div>

        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">Market Terminal</div>
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

              <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                <div className="mb-4 text-xs uppercase tracking-[0.25em] text-zinc-600">Latest Candle</div>

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

            <div className="rounded-3xl border border-zinc-800 bg-black p-5">
              <div className="mb-4 text-xs uppercase tracking-[0.25em] text-zinc-600">Trade Panel</div>

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

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={loadingTrade}
                    onClick={() => executeTrade("buy")}
                    className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                    style={{ background: accent }}
                  >
                    {loadingTrade ? "Working..." : "Buy"}
                  </button>

                  <button
                    type="button"
                    disabled={loadingTrade}
                    onClick={() => executeTrade("sell")}
                    className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-white transition hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {loadingTrade ? "Working..." : "Sell"}
                  </button>
                </div>

                {tradeMessage && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-300">
                    {tradeMessage}
                  </div>
                )}
              </div>

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

                  <div className="mt-2 rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-600">Token Structure</div>
                    <div className="space-y-3">
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
                  </div>

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

        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Token Status</div>

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
            {getStatusExplanation(tokenMeta.status || project?.token_status || "draft")}
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
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Token Status</div>
              <div className="mt-2 break-words text-lg text-white">
                {formatTokenStatus(tokenMeta.status || project?.token_status || "")}
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

        {(reviewStatus === "draft" || reviewStatus === "pending") && (
          <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Review Pipeline</div>

            <h2 className="font-mono text-3xl font-bold text-white">Submit for Review</h2>

            <p className="mt-3 max-w-3xl text-zinc-500">
              Prepare this project for DUM Club review. Once submitted, it can be approved and then
              minted into a live Solana token.
            </p>

            <form onSubmit={submitReview} className="mt-6 grid gap-4 md:grid-cols-3">
              <input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Token Name"
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <input
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="Symbol"
                maxLength={6}
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <input
                value={tokenSupply}
                onChange={(e) => setTokenSupply(e.target.value)}
                placeholder="Total Supply"
                className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
              />

              <div className="flex flex-wrap gap-3 md:col-span-3">
                <button
                  type="submit"
                  disabled={loadingAction}
                  className="rounded-2xl px-5 py-3 font-mono text-sm uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: accent }}
                >
                  {loadingAction ? "Submitting..." : "Submit Review"}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
            <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Project Memory</div>

            <h2 className="font-mono text-3xl font-bold text-white">Add Memory</h2>

            <p className="mt-3 max-w-2xl text-zinc-500">
              Paste a memory, note, creator post, transcript, or product insight so your AI can use it
              later.
            </p>

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

          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
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
              Each project includes 3 free AI questions. Support this project by holding its token to
              unlock unlimited AI access.
            </p>

            {chatMeta.locked && (
              <div className="mt-5 rounded-2xl border border-red-400/30 bg-red-950/20 p-4 text-sm text-red-200">
                {chatMeta.lock_message}
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
                {response}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
