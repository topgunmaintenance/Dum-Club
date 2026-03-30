"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  privy_id?: string | null;
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
  const { user: authUser, login, getToken } = useAuth();
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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionIsError, setActionIsError] = useState(false);

  const [serviceProfile, setServiceProfile] = useState<Record<string, unknown> | null>(null);
  const [isOwner, setIsOwner] = useState(false);

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
  const [buyingOfferId, setBuyingOfferId] = useState<string | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<"success" | "cancelled" | null>(null);
  const [demoClickedId, setDemoClickedId] = useState<string | null>(null);
  const [buyStep, setBuyStep] = useState<Record<string, string>>({});
  const [buyError, setBuyError] = useState<Record<string, string>>({});
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
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
    offers?: { title: string; offer_type: string; price_usd: number } | null;
  }
  const [sellerOrders, setSellerOrders] = useState<Order[]>([]);
  const [storeEditing, setStoreEditing] = useState<StoreItem | null>(null);
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

  async function loadOffers() {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/offers/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load offers");
      const data = await res.json();
      console.log("OFFERS DATA:", data);
      setOffers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setOffers([]);
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
    document.getElementById("offers-section")?.scrollIntoView({ behavior: "smooth" });
  }

  async function uploadOfferImage(file: File): Promise<string | null> {
    console.log("[image] Uploading:", file.name, file.size, "bytes");
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
      console.log("[image] Upload success:", data.publicUrl);
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
      // silently fail — user can type manually
    } finally {
      setOfferAiField(null);
    }
  }

  async function saveOffer() {
    console.log("[saveOffer] clicked, offerEditing:", offerEditing?.title, "id:", id);
    if (!offerEditing) return;
    if (!offerEditing.title?.trim()) {
      setOfferSaveError("Title is required");
      return;
    }
    if (!id) {
      setOfferSaveError("Project ID missing — try refreshing the page");
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
      const token = await getToken();
      console.log("[saveOffer] token obtained:", !!token);
      if (!token) throw new Error("Not authenticated — please sign in again");

      // Upload image if file selected
      let imageUrl = offerEditing.primary_image_url?.trim() || null;
      if (offerImageFile) {
        const uploaded = await uploadOfferImage(offerImageFile);
        if (uploaded) {
          imageUrl = uploaded;
        } else {
          setOfferSaveError("Image upload failed — offer will be saved without image. Check that the 'offers' storage bucket exists in Supabase.");
        }
      }

      const isEdit = Boolean(offerEditing.id);
      const url = isEdit
        ? `${API_BASE}/api/offers/${offerEditing.id}`
        : `${API_BASE}/api/offers/create`;
      const method = isEdit ? "PATCH" : "POST";

      const body: Record<string, unknown> = {
        title: offerEditing.title?.trim(),
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
      if (!isEdit) body.project_id = id;

      console.log("[saveOffer] sending", method, url, JSON.stringify(body));
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      console.log("[saveOffer] response status:", res.status);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Pydantic 422 errors return detail as an array of objects
        let msg = "Failed to save offer";
        if (typeof errData.detail === "string") {
          msg = errData.detail;
        } else if (Array.isArray(errData.detail)) {
          msg = errData.detail.map((e: any) => e.msg || JSON.stringify(e)).join("; ");
        }
        throw new Error(msg);
      }
      const created = await res.json();
      console.log("[saveOffer] success, offer id:", created?.id);
      await loadOffers();
      setOfferFormOpen(false);
      setOfferEditing(null);
      setOfferImageFile(null);
      setOfferImagePreview(null);
      setOfferSaveSuccess(true);
      setTimeout(() => setOfferSaveSuccess(false), 5000);
    } catch (err) {
      console.error("[saveOffer] ERROR:", err);
      setOfferSaveError(err instanceof Error ? err.message : "Failed to save offer");
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

  async function buyOffer(offer: Offer) {
    const oid = offer.id;
    console.log("[buyOffer] clicked, offer:", oid, offer.title);
    setBuyStep((p) => ({ ...p, [oid]: "clicked" }));
    setBuyError((p) => ({ ...p, [oid]: "" }));

    if (!authUser) {
      setBuyStep((p) => ({ ...p, [oid]: "blocked_no_auth" }));
      return;
    }
    if (isOwner) {
      setBuyStep((p) => ({ ...p, [oid]: "blocked_owner" }));
      return;
    }
    if (isDemo) {
      setBuyStep((p) => ({ ...p, [oid]: "blocked_demo" }));
      setDemoClickedId(oid);
      setTimeout(() => setDemoClickedId(null), 5000);
      return;
    }

    setBuyingOfferId(oid);
    setBuyStep((p) => ({ ...p, [oid]: "getting_token" }));

    try {
      const token = await getToken();
      console.log("[buyOffer] token obtained:", !!token);
      if (!token) {
        setBuyStep((p) => ({ ...p, [oid]: "no_privy_token" }));
        setBuyError((p) => ({ ...p, [oid]: "Authentication failed — please sign in again" }));
        setBuyingOfferId(null);
        return;
      }

      setBuyStep((p) => ({ ...p, [oid]: "calling_checkout" }));

      // Strip existing query params to avoid malformed URLs on repeat purchases
      const cleanUrl = window.location.origin + window.location.pathname;
      console.log("[buyOffer] clean URL for redirect:", cleanUrl);

      const res = await fetch(`${API_BASE}/api/checkout/create-payment-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          offer_id: oid,
          success_url: cleanUrl,
          cancel_url: cleanUrl,
        }),
      });

      console.log("[buyOffer] checkout response status:", res.status);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = typeof errData.detail === "string" ? errData.detail : `Checkout failed (HTTP ${res.status})`;
        setBuyStep((p) => ({ ...p, [oid]: "checkout_error" }));
        setBuyError((p) => ({ ...p, [oid]: msg }));
        setBuyingOfferId(null);
        return;
      }

      const data = await res.json();
      console.log("[buyOffer] checkout response:", { checkout_url: !!data.checkout_url, order_id: data.order_id });
      if (data.checkout_url) {
        setBuyStep((p) => ({ ...p, [oid]: "redirecting" }));
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

  async function loadSellerOrders() {
    if (!id || !isOwner) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/checkout/orders/seller/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSellerOrders(Array.isArray(data) ? data : []);
    } catch { setSellerOrders([]); }
  }

  async function updateOrderStatus(orderId: string, status: string) {
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_BASE}/api/checkout/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      await loadSellerOrders();
      await loadOffers(); // refresh inventory counts
    } catch (err) { console.error(err); }
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
    console.log("[executeTrade] clicked:", side, "amount:", tradeAmount, "project:", id);
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
      setTradeIsError(false);
      setTradeMessage("");

      console.log("[executeTrade] sending POST /trade:", { side, amount: numericAmount, wallet: wallet.slice(0, 12) + "..." });
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

      console.log("[executeTrade] response status:", res.status);
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

      console.log("[executeTrade] success:", { newPrice: data.market?.price, newBalance: data.balance?.balance });
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
      console.error("[executeTrade] ERROR:", err);
      setTradeIsError(true);
      setTradeMessage(err?.message || `Failed to ${side}`);
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
        `You are a startup branding expert. Improve this project headline to be more compelling, memorable, and clear.\n\nCurrent headline: "${p.title || p.name || "Untitled"}"\nProject description: "${p.description || "N/A"}"\nCategory: ${p.template_type || "General"}\nToken: ${p.token_symbol || "N/A"}\n\nReturn ONLY the improved headline text, nothing else. Keep it under 60 characters.`,
    },
    {
      key: "description",
      label: "Improve Description",
      field: "description",
      group: "project",
      prompt: (p) =>
        `You are a startup copywriter. Improve this project description to be more engaging, clear, and professional.\n\nCurrent description: "${p.description || "N/A"}"\nProject title: "${p.title || p.name || "Untitled"}"\nCategory: ${p.template_type || "General"}\nToken utility: "${p.token_utility || "N/A"}"\n\nReturn ONLY the improved description text, nothing else. Keep it under 300 characters.`,
    },
    {
      key: "token_utility",
      label: "Improve Token Utility",
      field: "token_utility",
      group: "project",
      prompt: (p) =>
        `You are a tokenomics expert. Improve this token utility description to be clearer, more compelling, and specific about the value proposition.\n\nCurrent token utility: "${p.token_utility || "N/A"}"\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken symbol: ${p.token_symbol || "N/A"}\n\nReturn ONLY the improved token utility text, nothing else. Keep it under 250 characters.`,
    },
    {
      key: "promo",
      label: "Create Promo Copy",
      field: null,
      group: "project",
      prompt: (p) =>
        `You are a crypto marketing copywriter. Create short, punchy promotional copy for this project that could be used on social media or a landing page.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken: ${p.token_symbol || "N/A"}\nUtility: "${p.token_utility || "N/A"}"\nCategory: ${p.template_type || "General"}\n\nReturn 2-3 lines of promotional copy. Be bold and engaging. No hashtags.`,
    },
    {
      key: "roast",
      label: "Roast My Project 🔥",
      field: null,
      group: "project",
      prompt: (p) =>
        `You are a brutally honest startup critic known for sharp, useful roasts. Roast this project — be honest, pointed, and constructive. Highlight weak spots, vague claims, or missed opportunities. Be funny but not abusive.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken: ${p.token_symbol || "N/A"}\nUtility: "${p.token_utility || "N/A"}"\nCategory: ${p.template_type || "General"}\n\nKeep it to 3-5 sentences.`,
    },
    // ── Store Intelligence ──
    {
      key: "store_ideas",
      label: "Generate Product Ideas",
      field: null,
      group: "store",
      prompt: (p, items) =>
        `You are a product strategist for crypto/web3 projects. Generate 2-3 product or service ideas for this project that the owner could sell.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken: ${p.token_symbol || "N/A"}\nUtility: "${p.token_utility || "N/A"}"\nCategory: ${p.template_type || "General"}${storeCtx(items || [])}\n\nReturn ONLY a valid JSON array of objects with these fields: name, description, price (string like "0.5 SOL"), type (one of: physical, digital, service, subscription). For subscription type, also include a "benefits" array of 2-3 short strings.\n\nExample: [{"name":"...", "description":"...", "price":"0.5 SOL", "type":"digital"}]\n\nReturn ONLY the JSON array, no markdown, no explanation.`,
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
        `You are a pricing strategist for crypto/web3 projects. Suggest an optimal price for this product.\n\nProject: "${p.title || p.name || "Untitled"}"\nProduct: "${target?.name || "N/A"}"\nDescription: "${target?.description || "N/A"}"\nType: ${target?.type || "N/A"}\nCurrent price: ${target?.price || "N/A"}${storeCtx(items || [])}\n\nReturn ONLY the suggested price as a short string (e.g. "0.25 SOL" or "1.5 SOL/month"). Nothing else.`,
    },
    {
      key: "store_subscription",
      label: "Create Subscription Offer",
      field: null,
      group: "store",
      prompt: (p, items) =>
        `You are a subscription product designer for crypto/web3 projects. Create a subscription offer for this project.\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken: ${p.token_symbol || "N/A"}\nUtility: "${p.token_utility || "N/A"}"${storeCtx(items || [])}\n\nReturn ONLY a valid JSON object with these fields: name, description, price (string like "1 SOL/month"), type (must be "subscription"), benefits (array of 3-4 short benefit strings).\n\nExample: {"name":"...", "description":"...", "price":"1 SOL/month", "type":"subscription", "benefits":["...", "..."]}\n\nReturn ONLY the JSON object, no markdown, no explanation.`,
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

    // Promo copy — persist via PATCH
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
      showBuilderToast("Promo copy saved — ready to share");
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
        showBuilderToast("Could not parse product ideas — try regenerating");
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
        showBuilderToast("Could not parse subscription — try regenerating");
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
        setProjectName(updated.name || updated.title || "Untitled Project");
        showBuilderToast("Updated — your project just got stronger");
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

  /* ── Project Score ────────────────────────────────── */
  async function evaluateProjectScore() {
    if (!project) return;
    setScoreLoading(true);
    setProjectScore(null);
    const storeSummary = storeItems.length
      ? storeItems.map((i) => `${i.name} (${i.type}, ${i.price})`).join(", ")
      : "none";
    const prompt = `You are a startup scoring engine. Evaluate this project on 3 dimensions and return ONLY a valid JSON object.\n\nProject: "${project.title || project.name || "Untitled"}"\nDescription: "${project.description || "N/A"}"\nToken: ${project.token_symbol || "N/A"}\nToken utility: "${project.token_utility || "N/A"}"\nPromo copy: "${promoCopy || "N/A"}"\nStore items: ${storeSummary}\nCategory: ${project.template_type || "General"}\n\nScore each dimension 0-100:\n1. Virality — how shareable and attention-grabbing is this project?\n2. Trust — how credible and professional does it appear?\n3. Utility — how useful and valuable is the token/product offering?\n\nReturn ONLY this JSON:\n{"virality":{"score":N,"reason":"..."},"trust":{"score":N,"reason":"..."},"utility":{"score":N,"reason":"..."}}\n\nKeep each reason under 80 characters. Be honest and specific. No markdown.`;
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
      showBuilderToast("Failed to evaluate — try again");
    } finally {
      setScoreLoading(false);
    }
  }

  function scoreColor(score: number): string {
    if (score >= 75) return "text-emerald-400";
    if (score >= 50) return "text-amber-400";
    return "text-red-400";
  }

  function barColor(score: number): string {
    if (score >= 75) return "bg-emerald-400";
    if (score >= 50) return "bg-amber-400";
    return "bg-red-400";
  }

  /* ── Store / Offers helpers ─────────────────────── */
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
    subscription: { label: "Subscription", color: "border-emerald-400/30 text-emerald-400" },
  };

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
      setActionMessage(`Token created — mint: ${data.mint}`);
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
    loadMemories();
    loadOffers();
    loadTokenMetadata();
    refreshMarketData();
    loadRedemptions();
  }, [id]);

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
    if (params.get("checkout") === "success") {
      console.log("[checkout] Success redirect detected — scheduling data refreshes");
      setCheckoutResult("success");
      // Refresh offers after webhook processes (may take a few seconds)
      // Note: loadSellerOrders is also triggered by the isOwner effect, so always safe to call loadOffers here
      const refreshAfterCheckout = () => {
        console.log("[checkout] Refreshing offers and orders...");
        loadOffers();
        loadSellerOrders();
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
  const tradeInputValid = numericTradeAmount > 0 && Number.isFinite(numericTradeAmount);
  const tradeHint = !userWallet
    ? "Connect a wallet to trade"
    : tradeAmount !== "" && !tradeInputValid
    ? "Enter a valid amount"
    : null;
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
      ? "Mint Token Supply"
      : tokenStatus === "tokens_minted"
      ? "Add Liquidity"
      : tokenStatus === "liquidity_added"
      ? "Go Live"
      : "Live";

  const launchSectionHeading =
    tokenStatus === "draft"
      ? "Create Your Token"
      : tokenStatus === "mint_created"
      ? "Token Initialized"
      : tokenStatus === "tokens_minted"
      ? "Supply Minted"
      : tokenStatus === "liquidity_added"
      ? "Liquidity Ready"
      : "Live on DUM Club";

  const nextStepHint =
    tokenStatus === "draft"
      ? "Initialize on-chain token infrastructure for this project."
      : tokenStatus === "mint_created"
      ? "Next: mint the full token supply to the project treasury."
      : tokenStatus === "tokens_minted"
      ? "Next: add market liquidity to enable live pricing."
      : tokenStatus === "liquidity_added"
      ? "Next: open live trading on DUM Club."
      : null;
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

  const isSimulated = (tokenMeta.mint_address || project?.token_mint_address || "").startsWith("SIM_");

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
    className={`min-h-screen bg-black px-4 py-8 text-white sm:px-6 lg:px-8 ${
      canShowMarketUi && hasMarketSnapshot ? "pb-28 lg:pb-24" : ""
    }`}
  >
    <div className="mx-auto max-w-6xl">

      {/* ── Presentation / Pitch Mode ──────────────── */}
      {pitchMode && (
        <div className="relative">
          {/* Exit button (owner sees toggle, public sees back) */}
          <div className="mb-8 flex items-center justify-between">
            <Link
              href="/discover"
              className="inline-flex rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
            >
              ← Back to Feed
            </Link>
            {isOwner && (
              <button
                onClick={togglePitchMode}
                className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-medium uppercase tracking-[0.15em] text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
              >
                Exit Pitch View
              </button>
            )}
          </div>

          {/* Pitch hero */}
          <div
            className="mb-10 rounded-3xl border border-zinc-800 bg-black p-8 sm:p-12 text-center"
            style={{
              borderTop: `3px solid ${accent}`,
              boxShadow: `0 0 80px rgba(0,255,178,0.06)`,
            }}
          >
            <div className="mx-auto max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-1.5">
                <span className="text-2xl">{emoji}</span>
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
                  {category} · DUM Club
                </span>
              </div>

              <h1 className="font-mono text-4xl font-bold leading-tight text-white sm:text-6xl">
                {projectName}
              </h1>

              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
                {parsedAiOutput?.description || project?.description || ""}
              </p>

              {/* Token badge */}
              {displaySymbol && displaySymbol !== "TOKEN" && (
                <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-5 py-2">
                  <span className="text-sm font-bold text-emerald-400">${displaySymbol}</span>
                  {hasMarketSnapshot && (
                    <span className={`text-sm font-medium ${heroPriceUp ? "text-emerald-400" : "text-red-400"}`}>
                      {heroPriceUp ? "+" : ""}{heroPriceChangePct.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Pitch content grid */}
          <div className="mb-10 grid gap-6 md:grid-cols-2">
            {/* Token Utility */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
                Token Utility
              </div>
              <p className="text-sm leading-relaxed text-zinc-300">
                {heroUtility}
              </p>
              {utilityBullets.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {utilityBullets.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                      <span className="mt-0.5 text-emerald-400">✦</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Key Metrics */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
                Key Metrics
              </div>
              <div className="space-y-3">
                {hasMarketSnapshot && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Price</span>
                      <span className="font-mono font-semibold text-white">${heroPrice.toFixed(6)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Market Cap</span>
                      <span className="font-mono font-semibold text-white">
                        ${formatNumber(Number(market?.market_cap || 0), 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">24h Volume</span>
                      <span className="font-mono font-semibold text-white">
                        ${formatNumber(Number(market?.volume_24h || 0), 2)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Supply</span>
                  <span className="font-mono font-semibold text-white">{supplyDisplay}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Status</span>
                  <span className="font-mono text-xs font-semibold uppercase text-emerald-400">
                    {displayStatusLabel}
                  </span>
                </div>
                {feedbackEntries.length > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Rating</span>
                    <span className="font-mono font-semibold text-white">
                      {averageRating.toFixed(1)} / 5
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Project Score in pitch view */}
          {projectScore && (
            <div className="mb-10 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="mb-4 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
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
                      <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.15em] text-zinc-500">
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
            <div className="mb-10 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
                About This Project
              </div>
              <p className="mx-auto max-w-xl text-base leading-relaxed text-zinc-300 whitespace-pre-wrap">
                {promoCopy}
              </p>
            </div>
          )}

          {/* Offers in pitch view */}
          {storeItems.length > 0 && (
            <div className="mb-10">
              <div className="mb-5 text-center">
                <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
                  Offers
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {storeItems.map((item) => {
                  const badge = storeTypeBadge[item.type];
                  const hasPerk = Boolean(item.required_token_amount && item.required_token_amount > 0);
                  const tokenConfigured = Boolean(project?.token_mint_address && !project.token_mint_address.startsWith("SIM_"));
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
                    <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 flex flex-col">
                      <div className="mb-3 flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${badge.color}`}>
                          {badge.label}
                        </span>
                        {showGating && perkState === "unlocked" && (
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-400">
                            ✓ Unlocked
                          </span>
                        )}
                        {showGating && perkState === "locked" && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400">
                            Requires {item.required_token_amount} tokens
                          </span>
                        )}
                        {showGating && perkState === "no_wallet" && (
                          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[9px] font-semibold uppercase text-zinc-500">
                            🔒 Gated
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-white">{item.name}</h3>
                      {item.description && (
                        <p className="mt-1 text-sm text-zinc-400 leading-relaxed">{item.description}</p>
                      )}
                      {item.type === "subscription" && item.benefits && item.benefits.length > 0 && (
                        <ul className="mt-3 space-y-1.5">
                          {item.benefits.map((b, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-zinc-400">
                              <span className="mt-0.5 text-emerald-400">✦</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {showGating && item.perk_description && (
                        <div className="mt-3 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.03] px-3 py-2">
                          <span className="text-xs text-emerald-400/80">{item.perk_description}</span>
                        </div>
                      )}
                      <div className="mt-auto pt-4 flex items-center justify-between">
                        <div>
                          {pitchFree ? (
                            <span className="font-mono text-lg font-bold text-emerald-400">Free for holders</span>
                          ) : (
                            <span className="font-mono text-lg font-bold text-white">{pitchPrice}</span>
                          )}
                          {perkState === "unlocked" && item.token_holder_price != null && item.price && !pitchFree && (
                            <span className="ml-2 text-xs text-zinc-600 line-through">{item.price}</span>
                          )}
                        </div>
                        <button className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-400 transition hover:border-emerald-400/30 hover:text-emerald-300">
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
              {canShowMarketUi && (
                <button
                  onClick={() => { setPitchMode(false); setTimeout(scrollToBuyPanel, 100); }}
                  className="rounded-xl bg-emerald-500 px-8 py-3 text-sm font-bold text-black transition hover:bg-emerald-400"
                >
                  Buy ${displaySymbol}
                </button>
              )}
              <button
                onClick={() => { setPitchMode(false); setTimeout(scrollToAiWorkspace, 100); }}
                className="rounded-xl border border-zinc-700 px-8 py-3 text-sm font-medium text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
              >
                Ask AI
              </button>
              {isOwner && (
                <button
                  onClick={() => copyToClipboard(`${window.location.origin}/project/${id}?view=pitch`, "pitch link")}
                  className="rounded-xl border border-zinc-800 px-6 py-3 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
                >
                  Copy Pitch Link
                </button>
              )}
            </div>
          </div>

          {/* Toast (shared with builder) */}
          {builderToast && (
            <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-slide-down rounded-xl border border-emerald-400/20 bg-zinc-950 px-5 py-2.5 shadow-lg">
              <span className="text-sm font-medium text-emerald-400">{builderToast}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Normal project view ────────────────────── */}
      {!pitchMode && (<>
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
        className="mb-8 rounded-3xl border border-zinc-900 bg-black p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8"
        style={{
          borderTop: `3px solid ${accent}`,
          boxShadow: `0 0 1px rgba(255,255,255,0.02), 0 0 40px rgba(0,255,178,0.06)`,
        }}
      >
        <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border border-zinc-800 bg-zinc-950 text-3xl shadow-inner sm:h-20 sm:w-20 sm:text-4xl">
              {emoji}
            </div>

            <div className="max-w-4xl">
              <div className="mb-3 text-xs uppercase tracking-[0.35em] text-zinc-600">
                {category} · DUM Club
              </div>

              {loadingProject ? (
                <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-800 sm:h-14" />
              ) : (
                <h1 className="font-mono text-3xl font-bold leading-tight text-white sm:text-5xl">
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
        <div className="mb-4 text-xs uppercase tracking-[0.3em] text-zinc-600">About</div>
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
          <div className="mx-auto max-w-6xl px-2">
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

      {/* ── AI Project Builder (Owner Only) ────────── */}
      {isOwner && (
        <div className="mb-8 rounded-3xl border border-emerald-400/10 bg-zinc-950 p-6">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.3em] text-emerald-400/60">
              Owner Tools
            </span>
            <button
              onClick={togglePitchMode}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              Presentation Mode
            </button>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            DUM AI Project Builder
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Improve your project page and promo copy with AI
          </p>

          {/* Action buttons */}
          {!builderAction && !storePickerFor && (
            <div className="mt-5 space-y-4">
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600">Project Copy</div>
                <div className="flex flex-wrap gap-2">
                  {builderActions.filter((a) => a.group === "project").map((a) => (
                    <button
                      key={a.key}
                      onClick={() => initiateBuilderAction(a)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-emerald-400/30 hover:text-emerald-400"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-600">Store Intelligence</div>
                <div className="flex flex-wrap gap-2">
                  {builderActions.filter((a) => a.group === "store").map((a) => (
                    <button
                      key={a.key}
                      onClick={() => initiateBuilderAction(a)}
                      className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-emerald-400/30 hover:text-emerald-400"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Item picker for store actions */}
          {storePickerFor && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                Select an item
              </div>
              <div className="space-y-2">
                {storeItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      const action = builderActions.find((a) => a.key === storePickerFor);
                      if (action) runBuilderAction(action, item);
                    }}
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-left transition hover:border-emerald-400/30"
                  >
                    <div className="text-sm font-medium text-white">{item.name}</div>
                    <div className="text-xs text-zinc-500">{item.type} · {item.price || "No price"}</div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setStorePickerFor(null)}
                className="mt-3 rounded-xl border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Loading state */}
          {builderLoading && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-sm text-zinc-400">
                  DUM AI is analyzing your project...
                </span>
              </div>
            </div>
          )}

          {/* Preview panel */}
          {builderResult && !builderLoading && (
            <div className="mt-5 space-y-4">
              {builderField && builderResult.current && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    Current
                  </div>
                  <div className="text-sm leading-relaxed text-zinc-400">
                    {builderResult.current}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-400/70">
                    {builderAction === "roast" ? "Roast"
                      : builderAction === "promo" ? "Promo Copy"
                      : builderAction === "store_ideas" ? "Product Ideas"
                      : builderAction === "store_subscription" ? "Subscription Offer"
                      : builderAction === "store_improve_desc" ? "Improved Description"
                      : builderAction === "store_pricing" ? "Suggested Price"
                      : "Suggested"}
                  </span>
                  {(builderAction === "promo" || builderAction === "roast") && (
                    <button
                      onClick={() => copyToClipboard(builderResult.suggested, "text")}
                      className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-emerald-400"
                    >
                      Copy
                    </button>
                  )}
                </div>
                <div className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap">
                  {builderResult.suggested}
                </div>
              </div>

              <div className="flex gap-2">
                {builderAction !== "roast" && (
                  <button
                    onClick={applyBuilderResult}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition-all hover:bg-emerald-400"
                  >
                    Apply
                  </button>
                )}
                {builderAction !== "roast" && (
                  <button
                    onClick={() => {
                      const action = builderActions.find((a) => a.key === builderAction);
                      if (action) runBuilderAction(action, storeTargetItem);
                    }}
                    className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-all hover:border-zinc-500 hover:text-zinc-200"
                  >
                    Regenerate
                  </button>
                )}
                <button
                  onClick={dismissBuilder}
                  className="rounded-xl border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-500 transition-all hover:border-zinc-600 hover:text-zinc-300"
                >
                  {builderAction === "roast" ? "Dismiss" : "Cancel"}
                </button>
              </div>
            </div>
          )}

          {/* Saved promo copy display */}
          {!builderAction && promoCopy && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                  Saved Promo Copy
                </span>
                <button
                  onClick={() => copyToClipboard(promoCopy, "promo copy")}
                  className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-emerald-400"
                >
                  Copy
                </button>
              </div>
              <div className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
                {promoCopy}
              </div>
            </div>
          )}

          {/* Share project */}
          {!builderAction && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => copyToClipboard(window.location.href, "project link")}
                className="rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-500 transition-all hover:border-zinc-600 hover:text-zinc-300"
              >
                Share Project Link
              </button>
              {promoCopy && (
                <button
                  onClick={() => copyToClipboard(`${promoCopy}\n\n${window.location.href}`, "promo + link")}
                  className="rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-500 transition-all hover:border-emerald-400/30 hover:text-emerald-400"
                >
                  Share Promo + Link
                </button>
              )}
            </div>
          )}

          {/* Success toast */}
          {builderToast && (
            <div className="mt-4 animate-fade-slide-down rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2.5">
              <span className="text-sm font-medium text-emerald-400">{builderToast}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Project Score ────────────────────────── */}
      {isOwner && (
        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.3em] text-zinc-600">
              AI Evaluation
            </span>
            <button
              onClick={evaluateProjectScore}
              disabled={scoreLoading}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-40"
            >
              {scoreLoading ? "Evaluating..." : projectScore ? "Re-evaluate" : "Score My Project"}
            </button>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Project Score</h2>
          <p className="mt-1 text-sm text-zinc-500">
            AI-powered evaluation of your project's strength
          </p>

          {scoreLoading && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-sm text-zinc-400">Evaluating your project...</span>
              </div>
            </div>
          )}

          {!scoreLoading && !projectScore && (
            <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
              <p className="text-sm text-zinc-600">
                Click "Score My Project" to get an AI evaluation
              </p>
            </div>
          )}

          {!scoreLoading && projectScore && (
            <div className="mt-5 space-y-4">
              {(["virality", "trust", "utility"] as const).map((dim) => {
                const entry = projectScore[dim];
                const label = dim.charAt(0).toUpperCase() + dim.slice(1);
                return (
                  <div key={dim} className="rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-white">{label}</span>
                      <span className={`font-mono text-lg font-bold ${scoreColor(entry.score)}`}>
                        {entry.score}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden mb-2">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${barColor(entry.score)}`}
                        style={{ width: `${entry.score}%` }}
                      />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs text-zinc-500 leading-relaxed">{entry.reason}</p>
                      <button
                        onClick={() => {
                          const tips: Record<string, string> = {
                            virality: "How can I make my project more shareable and attention-grabbing? Be specific with 3 actionable suggestions.",
                            trust: "How can I make my project appear more credible and professional? Give me 3 specific improvements.",
                            utility: "How can I improve my token utility and product value? Give me 3 concrete suggestions.",
                          };
                          const action = builderActions.find((a) => a.key === "roast")!;
                          const improveAction: BuilderActionDef = {
                            ...action,
                            key: `improve_${dim}`,
                            label: `Improve ${label}`,
                            prompt: (p) =>
                              `You are a startup advisor. The user's project scored ${entry.score}/100 on ${label} with this feedback: "${entry.reason}"\n\nProject: "${p.title || p.name || "Untitled"}"\nDescription: "${p.description || "N/A"}"\nToken: ${p.token_symbol || "N/A"}\nUtility: "${p.token_utility || "N/A"}"${storeItems.length ? `\nStore: ${storeItems.map((i) => i.name).join(", ")}` : ""}\n\n${tips[dim]}\n\nKeep it actionable and concise.`,
                          };
                          runBuilderAction(improveAction, null);
                        }}
                        className="shrink-0 text-[10px] font-medium text-zinc-600 transition hover:text-emerald-400"
                      >
                        Improve →
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 text-center">
                <span className="font-mono text-2xl font-bold text-white">
                  {Math.round((projectScore.virality.score + projectScore.trust.score + projectScore.utility.score) / 3)}
                </span>
                <span className="ml-2 text-sm text-zinc-500">/ 100 overall</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Offers (Public Storefront + Owner Tools) ── */}
      <div id="offers-section" className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6 sm:p-8">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-[0.3em] text-emerald-400/50">
              Creator Offers
            </span>
            {isDemo && (
              <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase text-amber-400/60">
                Demo
              </span>
            )}
          </div>
          {isOwner && !offerFormOpen && (
            <button
              onClick={() => openOfferForm()}
              className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-400/70 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              + Add Offer
            </button>
          )}
        </div>
        <h2 className="font-mono text-2xl font-bold text-white">Offers</h2>
        <p className="mt-2 text-sm text-zinc-500">
          {isOwner ? "Products, services, and subscriptions for your community" : "Browse what this creator has to offer"}
        </p>

        {/* Demo mode indicator (section-level) */}

        {/* Checkout result banner (only in live mode) */}
        {!isDemo && checkoutResult === "success" && (
          <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-300">Payment successful — thank you for your purchase!</span>
            <button onClick={() => setCheckoutResult(null)} className="text-xs text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}
        {!isDemo && checkoutResult === "cancelled" && (
          <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-zinc-400">Checkout was cancelled</span>
            <button onClick={() => setCheckoutResult(null)} className="text-xs text-zinc-600 hover:text-zinc-300">Dismiss</button>
          </div>
        )}

        {/* Owner: create/edit offer form (backend offers) */}
        {isOwner && offerFormOpen && offerEditing && (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-400/70">
              {offerEditing.id ? "Edit Offer" : "New Offer"}
            </div>
            <div>
              <input
                type="text"
                placeholder="Offer title"
                value={offerEditing.title || ""}
                onChange={(e) => setOfferEditing({ ...offerEditing, title: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
              <button
                type="button"
                onClick={() => offerAiAssist("title")}
                disabled={offerAiField === "title"}
                className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[10px] font-medium text-emerald-400/70 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-40"
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
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40 resize-none"
              />
              <button
                type="button"
                onClick={() => offerAiAssist("description")}
                disabled={offerAiField === "description"}
                className="mt-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[10px] font-medium text-emerald-400/70 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-40"
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
                    className="flex-1 min-w-0 rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                  />
                  <button
                    type="button"
                    onClick={() => offerAiAssist("price")}
                    disabled={offerAiField === "price"}
                    className="shrink-0 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-3 py-3 text-[10px] font-medium text-emerald-400/70 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-40"
                  >
                    {offerAiField === "price" ? "..." : "$?"}
                  </button>
                </div>
              </div>
              <select
                value={offerEditing.offer_type || "digital_service"}
                onChange={(e) => setOfferEditing({ ...offerEditing, offer_type: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-white outline-none focus:border-emerald-400/40"
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
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
            />
            <input
              type="number"
              min="0"
              max="100"
              placeholder="Token holder discount % (0-100)"
              value={offerEditing.token_discount_percent || ""}
              onChange={(e) => setOfferEditing({ ...offerEditing, token_discount_percent: Number(e.target.value) })}
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
            />
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Inventory</div>
              <label className="flex items-center gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={offerEditing.unlimited_inventory ?? true}
                  onChange={(e) => setOfferEditing({ ...offerEditing, unlimited_inventory: e.target.checked })}
                  className="rounded border-zinc-700"
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
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              )}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Media (optional)</div>

              {/* Image upload */}
              <div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    console.log("[image] File selected:", file?.name, file?.size);
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
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-black px-4 py-4 text-sm text-zinc-500 transition hover:border-emerald-400/30 hover:text-zinc-300 active:scale-[0.98]"
                >
                  <span className="text-lg">📷</span>
                  <span className="text-left">
                    {offerImageFile ? offerImageFile.name : "Tap to upload image or take photo"}
                  </span>
                </button>
              </div>

              {/* Image preview (upload or existing URL) */}
              {(offerImagePreview || offerEditing.primary_image_url?.trim()) && (
                <div className="relative rounded-lg overflow-hidden border border-zinc-800">
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
                    className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs text-zinc-400 hover:text-white"
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
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              )}

              {/* Video URL */}
              <input
                type="url"
                placeholder="Video URL (YouTube, Loom, etc.)"
                value={offerEditing.video_url || ""}
                onChange={(e) => setOfferEditing({ ...offerEditing, video_url: e.target.value })}
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
            </div>
            {offerSaveError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
                {offerSaveError}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => { setOfferSaveError(null); saveOffer(); }}
                disabled={offerSaving || !offerEditing.title?.trim() || !offerEditing.price_usd}
                className="w-full sm:w-auto rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {offerSaving ? "Saving..." : offerEditing.id ? "Save Changes" : "Create Offer"}
              </button>
              <button
                onClick={() => { setOfferFormOpen(false); setOfferEditing(null); setOfferImageFile(null); setOfferImagePreview(null); setOfferSaveError(null); }}
                className="w-full sm:w-auto rounded-xl border border-zinc-800 px-5 py-3 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Offer save success toast */}
        {offerSaveSuccess && (
          <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-emerald-300">Offer created successfully!</span>
            <button onClick={() => setOfferSaveSuccess(false)} className="text-xs text-emerald-400/60 hover:text-emerald-300">Dismiss</button>
          </div>
        )}

        {/* Owner: add/edit form */}
        {isOwner && storeFormOpen && storeEditing && (
          <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-400/70">
              {storeEditing.id ? "Edit Offer" : "New Offer"}
            </div>
            <input
              type="text"
              placeholder="Name"
              value={storeEditing.name}
              onChange={(e) => setStoreEditing({ ...storeEditing, name: e.target.value })}
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
            />
            <textarea
              placeholder="Description"
              value={storeEditing.description}
              onChange={(e) => setStoreEditing({ ...storeEditing, description: e.target.value })}
              rows={2}
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40 resize-none"
            />
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Price (e.g. 0.5 SOL)"
                value={storeEditing.price}
                onChange={(e) => setStoreEditing({ ...storeEditing, price: e.target.value })}
                className="flex-1 rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
              <select
                value={storeEditing.type}
                onChange={(e) => setStoreEditing({ ...storeEditing, type: e.target.value as StoreItemType })}
                className="rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400/40"
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
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40 resize-none"
              />
            )}
            {/* Token perk fields */}
            {project?.token_mint_address && !project.token_mint_address.startsWith("SIM_") && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/60">Token Perk (optional)</div>
                <input
                  type="number"
                  placeholder="Required token amount (e.g. 100)"
                  value={storeEditing.required_token_amount ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, required_token_amount: e.target.value ? Number(e.target.value) : null })}
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
                <input
                  type="text"
                  placeholder="Perk description (e.g. 50% off for holders)"
                  value={storeEditing.perk_description ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, perk_description: e.target.value || null })}
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
                <input
                  type="text"
                  placeholder="Token holder price (e.g. 0.25 SOL or Free)"
                  value={storeEditing.token_holder_price ?? ""}
                  onChange={(e) => setStoreEditing({ ...storeEditing, token_holder_price: e.target.value || null })}
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={saveStoreItem}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400"
              >
                {storeEditing.id ? "Save Changes" : "Add Offer"}
              </button>
              <button
                onClick={() => { setStoreFormOpen(false); setStoreEditing(null); }}
                className="rounded-xl border border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Offers from offers table */}
        {offers.length > 0 && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {offers.map((offer) => {
              const typeBadge = offer.offer_type === "physical_product"
                ? { label: "Physical Product", color: "border-amber-400/30 text-amber-400 bg-amber-400/5" }
                : { label: "Digital Service", color: "border-sky-400/30 text-sky-400 bg-sky-400/5" };
              return (
                <div key={offer.id} className="rounded-2xl border border-zinc-800 bg-black p-5 sm:p-6 flex flex-col transition hover:border-zinc-700">
                  {/* Header: badge + owner controls */}
                  <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${typeBadge.color}`}>
                        {typeBadge.label}
                      </span>
                      {offer.token_discount_percent > 0 && (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">
                          {offer.token_discount_percent}% off for holders
                        </span>
                      )}
                    </div>
                    {isOwner && (
                      <div className="flex gap-1">
                        <button onClick={() => openOfferForm(offer)} className="rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-300">Edit</button>
                        <button onClick={() => toggleOfferActive(offer)} className="rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-600 transition hover:bg-zinc-800 hover:text-amber-400">
                          Deactivate
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Media */}
                  {offer.video_url ? (
                    <div className="mb-3 rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 aspect-video">
                      <iframe
                        src={offer.video_url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")}
                        className="w-full h-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope"
                        allowFullScreen
                        title={offer.title}
                      />
                    </div>
                  ) : offer.primary_image_url ? (
                    <div className="mb-3 rounded-xl overflow-hidden border border-zinc-800">
                      <img src={offer.primary_image_url} alt={offer.title} className="w-full max-h-56 object-cover" />
                    </div>
                  ) : (
                    <div className="mb-3 flex h-32 items-center justify-center rounded-xl border border-zinc-800/50 bg-zinc-900/30 text-zinc-700 text-2xl">
                      {offer.offer_type === "physical_product" ? "📦" : "💼"}
                    </div>
                  )}

                  {/* Content */}
                  <h3 className="text-lg font-bold text-white leading-snug">{offer.title}</h3>
                  {offer.description && (
                    <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{offer.description}</p>
                  )}
                  {offer.delivery_info && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
                      <span>↳</span><span>{offer.delivery_info}</span>
                    </div>
                  )}

                  {/* Inventory info */}
                  {!offer.unlimited_inventory && offer.quantity_available != null && (
                    <div className="mt-2 text-xs text-zinc-600">
                      {(offer.quantity_sold || 0) > 0 && <span>{offer.quantity_sold} sold</span>}
                      {(() => {
                        const remaining = offer.quantity_available - (offer.quantity_sold || 0);
                        if (remaining <= 0) return <span className="ml-1 text-red-400">· Sold out</span>;
                        if (remaining <= 5) return <span className="ml-1 text-amber-400">· {remaining} left</span>;
                        return <span className="ml-1">· {remaining} available</span>;
                      })()}
                    </div>
                  )}

                  {/* Price + Action */}
                  {(() => {
                    const soldOut = !offer.unlimited_inventory && offer.quantity_available != null && (offer.quantity_available - (offer.quantity_sold || 0)) <= 0;
                    return (
                      <div className="mt-auto pt-4 flex items-end justify-between gap-3 border-t border-zinc-900 mt-4">
                        <div>
                          <div className="font-mono text-2xl font-bold text-white">${Number(offer.price_usd).toFixed(2)}</div>
                          <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 mt-0.5">USD</div>
                        </div>
                        {soldOut ? (
                          <span className="rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-2.5 text-xs font-semibold text-red-400 select-none">
                            Sold Out
                          </span>
                        ) : isOwner ? (
                          <span className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2.5 text-[11px] font-medium text-zinc-600 select-none">
                            Your Offer
                          </span>
                        ) : !authUser ? (
                          <button disabled className="rounded-xl bg-zinc-800 px-5 py-2.5 text-xs font-semibold text-zinc-500 cursor-not-allowed">
                            Connect to buy
                          </button>
                        ) : isDemo ? (
                          <button
                            onClick={() => buyOffer(offer)}
                            className="rounded-xl border border-emerald-400/40 px-5 py-2.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-400/10 active:scale-95"
                          >
                            {demoClickedId === offer.id ? "⚠ Demo" : "Demo Checkout"}
                          </button>
                        ) : (
                          <button
                            disabled={buyingOfferId === offer.id}
                            onClick={() => buyOffer(offer)}
                            className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-black transition hover:bg-emerald-400 active:scale-95 disabled:opacity-60"
                          >
                            {buyingOfferId === offer.id ? "Processing..." : "Buy Now"}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Demo inline feedback */}
                  {demoClickedId === offer.id && (
                    <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-300/80">
                      Checkout is disabled in demo mode.
                    </div>
                  )}

                  {/* Error feedback */}
                  {buyError[offer.id] && (
                    <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                      {buyError[offer.id]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Legacy store items (owner-only — not checkout-enabled) */}
        {isOwner && storeItems.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Legacy Items</span>
              <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold text-amber-400/60">Not purchasable</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {storeItems.map((item) => {
                const badge = storeTypeBadge[item.type];
                return (
                  <div key={item.id} className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-5 flex flex-col">
                    <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.color} opacity-60`}>
                        {badge.label}
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => removeStoreItem(item.id)} className="rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-600 transition hover:bg-zinc-800 hover:text-red-400">Remove</button>
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-zinc-300">{item.name}</h3>
                    {item.description && <p className="mt-1 text-sm text-zinc-500 leading-relaxed line-clamp-2">{item.description}</p>}
                    <div className="mt-auto pt-4 flex items-center justify-between gap-3 border-t border-zinc-800/50 mt-4">
                      <span className="font-mono text-base text-zinc-500">{item.price || "Free"}</span>
                      <button
                        onClick={() => convertStoreItemToOffer(item)}
                        className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[11px] font-medium text-emerald-400/80 transition hover:border-emerald-400/40 hover:text-emerald-300"
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

        {/* Empty state */}
        {offers.length === 0 && storeItems.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
            <div className="text-2xl mb-3 opacity-30">🛍</div>
            <p className="text-sm font-medium text-zinc-500">
              {isOwner ? "You haven't listed any offers yet" : "This creator hasn't listed any offers yet."}
            </p>
            {isOwner && !offerFormOpen && (
              <button
                onClick={() => openOfferForm()}
                className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-2.5 text-sm font-medium text-emerald-400 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
              >
                + Create your first offer
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Seller Sales (Owner Only) ──────────────── */}
      {isOwner && (
        <div className="mb-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-6 sm:p-8">
          <div className="mb-1 text-xs uppercase tracking-[0.3em] text-zinc-600">
            Sales
          </div>
          <h2 className="font-mono text-2xl font-bold text-white">Orders</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Purchases from your offers
          </p>

          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2">
            <span className="text-[11px] text-zinc-600">
              Payouts are currently platform-managed. Automated seller payouts will be enabled in a future update.
            </span>
          </div>

          {sellerOrders.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
              <p className="text-sm text-zinc-600">No sales yet</p>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {sellerOrders.map((order) => {
                const isPaid = order.status === "paid";
                const isDelivered = order.status === "delivered";
                return (
                  <div key={order.id} className="rounded-2xl border border-zinc-800 bg-black p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-white truncate">
                          {order.offers?.title || "Offer"}
                        </h3>
                        <div className="mt-1 text-xs text-zinc-600">
                          {order.buyer_email || "Anonymous buyer"} · {new Date(order.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-base font-bold text-white">
                          ${Number(order.amount_paid_usd).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-zinc-600 mt-0.5">
                          You receive: ${Number(order.seller_receives_usd).toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
                        order.status === "fulfilled" || order.status === "delivered"
                          ? "border-emerald-400/30 text-emerald-400 bg-emerald-400/10"
                          : order.status === "paid"
                          ? "border-sky-400/30 text-sky-400 bg-sky-400/10"
                          : order.status === "pending_payment"
                          ? "border-amber-400/30 text-amber-400 bg-amber-400/10"
                          : "border-zinc-700 text-zinc-500"
                      }`}>
                        {order.status === "pending_payment" ? "Awaiting Payment" : order.status}
                      </span>
                      {order.status === "paid" && (
                        <button
                          onClick={() => updateOrderStatus(order.id, "fulfilled")}
                          className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[11px] font-medium text-emerald-400/80 transition hover:border-emerald-400/40 hover:text-emerald-300"
                        >
                          Mark Fulfilled
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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

        <h2 className="font-mono text-2xl font-bold text-white">Ask AI</h2>

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
          <h3 className="font-mono text-xl font-bold text-white">AI Response</h3>

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
                  <h3 className="font-mono text-xl font-bold text-white">
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
                        className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-sm md:grid-cols-[90px_1.05fr_0.9fr_0.9fr_1.2fr] md:gap-3 md:p-4"
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
                        <div className="col-span-2 text-zinc-500 md:col-span-1">{formatDateTime(trade.created_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}

            <div id="buy-panel" className="rounded-3xl border border-zinc-800 bg-black p-5">
              <div className="mb-4 text-xs uppercase tracking-[0.25em] text-zinc-600">{displaySymbol} · Support this project</div>

              <h2 className="font-mono text-xl font-bold text-white">Buy / Sell</h2>

              {/* State indicator */}
              <div className="mt-3 flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${authUser ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400" : "border-zinc-700 bg-zinc-900 text-zinc-500"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${authUser ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  {authUser ? "Signed in" : "Not signed in"}
                </span>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${userWallet ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-400" : "border-zinc-700 bg-zinc-900 text-zinc-500"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${userWallet ? "bg-emerald-400" : "bg-zinc-600"}`} />
                  {userWallet ? "Wallet connected" : "Wallet required"}
                </span>
              </div>

              {!authUser ? (
                /* Not signed in */
                <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-center">
                  <p className="text-sm text-zinc-400">Sign in to trade {displaySymbol}.</p>
                  <button
                    type="button"
                    onClick={login}
                    className="mt-4 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500"
                  >
                    Sign in
                  </button>
                </div>
              ) : !userWallet ? (
                /* Signed in but no Solana wallet */
                <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-center">
                  <p className="text-sm text-zinc-400">A connected Solana wallet is required to trade.</p>
                  <p className="mt-2 text-xs text-zinc-600">Connect a Phantom, Solflare, or Backpack wallet to continue.</p>
                  <button
                    type="button"
                    onClick={login}
                    className="mt-4 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500"
                  >
                    Connect wallet
                  </button>
                </div>
              ) : (
                /* Signed in + wallet connected — full trade form */
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
                    disabled={loadingTrade || !tradeInputValid}
                    onClick={() => executeTrade(tradeTab)}
                    className={`w-full rounded-xl py-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
              )}
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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">Token Launch Pipeline</div>
            {isSimulated && (
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-400">Simulation Mode</span>
                <span className="text-[10px] text-zinc-600">· off-chain</span>
              </div>
            )}
          </div>

          <h2 className="font-mono text-2xl font-bold text-white sm:text-3xl">{launchSectionHeading}</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500">
            {getStatusExplanation(tokenStatus)}
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Token</div>
              <div className="mt-2 font-mono text-white">${(tokenMeta.symbol || project?.token_symbol || "-").toUpperCase()}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{tokenMeta.name || project?.token_name || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Supply</div>
              <div className="mt-2 text-white">{tokenMeta.supply || project?.token_supply || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-black p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-600">Stage</div>
              <div className="mt-2 text-white">{formatTokenStatus(tokenStatus)}</div>
            </div>
          </div>

          <div className="mt-6 grid gap-2 md:grid-cols-5">
            {tokenStages.map((stage, index) => {
              const isCompleted = index <= tokenStage;
              const isCurrent = index === tokenStage;
              return (
                <div
                  key={`launch-${stage}`}
                  className={`rounded-2xl border p-3 text-center ${
                    isCurrent
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : isCompleted
                      ? "border-zinc-700 bg-zinc-900/50"
                      : "border-zinc-800 bg-black"
                  }`}
                >
                  <div className={`font-mono text-xs ${isCurrent ? "text-emerald-500" : isCompleted ? "text-zinc-600" : "text-zinc-800"}`}>
                    0{index + 1}
                  </div>
                  <div
                    className={`mt-1 text-[11px] uppercase tracking-[0.18em] ${
                      isCurrent ? "text-emerald-300" : isCompleted ? "text-zinc-400" : "text-zinc-700"
                    }`}
                  >
                    {stage}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-5">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                disabled={loadingAction || tokenStatus === "trading_live"}
                onClick={tokenStatus === "draft" ? createToken : advanceTokenStatus}
                className="rounded-xl px-6 py-3 font-mono text-sm font-bold uppercase tracking-[0.18em] text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: tokenStatus === "trading_live" ? "#52525b" : accent }}
              >
                {loadingAction ? "Working..." : nextTokenActionLabel}
              </button>
              {actionMessage && (
                <p className={`text-xs leading-relaxed ${actionIsError ? "text-red-400" : "text-emerald-400"}`}>
                  {actionMessage}
                </p>
              )}
            </div>
            {nextStepHint && !loadingAction && (
              <p className="mt-3 text-xs text-zinc-600">{nextStepHint}</p>
            )}
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
          <div className="mb-6 text-xs uppercase tracking-[0.3em] text-zinc-600">Token Details</div>

          {!isApprovedProject && (
            <div className="mb-6 grid gap-2 md:grid-cols-5">
              {tokenStages.map((stage, index) => {
                const isCompleted = index <= tokenStage;
                const isCurrent = index === tokenStage;
                return (
                  <div
                    key={stage}
                    className={`rounded-2xl border p-3 text-center ${
                      isCurrent
                        ? "border-emerald-400/50 bg-emerald-400/10"
                        : isCompleted
                        ? "border-zinc-700 bg-zinc-900/50"
                        : "border-zinc-800 bg-black"
                    }`}
                  >
                    <div className={`font-mono text-xs ${isCurrent ? "text-emerald-500" : isCompleted ? "text-zinc-600" : "text-zinc-800"}`}>
                      0{index + 1}
                    </div>
                    <div
                      className={`mt-1 text-[11px] uppercase tracking-[0.18em] ${
                        isCurrent ? "text-emerald-300" : isCompleted ? "text-zinc-400" : "text-zinc-700"
                      }`}
                    >
                      {stage}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!isApprovedProject && (
            <div className="mb-6 rounded-2xl border border-zinc-800 bg-black p-4 text-sm text-zinc-400">
              {getStatusExplanation(tokenStatus)}
            </div>
          )}

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
              <div className="text-xs uppercase tracking-[0.25em] text-zinc-600">Category</div>
              <p className="mt-3 text-zinc-300">{category}</p>
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

    </>)}

    {canShowMarketUi && hasMarketSnapshot && (
      <div className="fixed bottom-0 left-0 right-0 z-50 hidden border-t border-zinc-800 bg-black/90 backdrop-blur-md lg:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
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
  </div>
  );
}

