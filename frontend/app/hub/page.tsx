"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { Starfield } from "../../components/Starfield";

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

const DUM_TREASURY = process.env.NEXT_PUBLIC_DUM_TREASURY_WALLET || "";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ── Tier system ── */
const TIERS = [
  { name: "Starter", min: 0, color: "#666" },
  { name: "Builder", min: 50, color: "#00FF87" },
  { name: "Operator", min: 100, color: "#F5A623" },
  { name: "Major", min: 1000, color: "#4F9EFF" },
];

function getTier(pts: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (pts >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

function getNextTier(pts: number) {
  for (const t of TIERS) { if (pts < t.min) return t; }
  return null;
}

function formatTimeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const REASON_LABELS: Record<string, string> = {
  purchase_reward: "Purchase reward",
  launch_bonus: "Business created",
  offer_created: "Offer added",
  discount_spend: "Discount used",
  stripe_purchase: "Points purchased",
  discount: "Discount applied",
  swap_buy: "Swapped SOL → DUM",
  swap_sell: "Swapped DUM → SOL",
  demo_swap: "Demo swap SOL → DUM",
  claim: "Claimed to wallet",
  referral_bonus: "Referral reward",
  referral_welcome: "Welcome bonus",
};

/* ════════════════════════════════════════════════════════════════
   POINTS TAB
   ════════════════════════════════════════════════════════════════ */
function PointsTab({
  balance, tier, next, progressPct, user, getToken,
  purchasing, setPurchasing, purchaseError, setPurchaseError, purchaseSuccess,
  hubClaimable, onNavigateClaim,
}: any) {
  // Balance count-up animation on purchase success
  const [displayBalance, setDisplayBalance] = useState(balance);
  const [deltaAccent, setDeltaAccent] = useState<number | null>(null);
  const prevBalanceRef = useRef(balance);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const prev = prevBalanceRef.current;
    prevBalanceRef.current = balance;

    // Only animate when balance increases AND we have a purchase success with a real amount
    if (balance > prev && purchaseSuccess?.added > 0) {
      const from = prev;
      const to = balance;
      const duration = 700;
      const start = performance.now();
      setDeltaAccent(to - from);

      const step = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayBalance(Math.round(from + (to - from) * eased));
        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          setDisplayBalance(to);
          // Fade out delta accent after a pause
          setTimeout(() => setDeltaAccent(null), 1500);
        }
      };
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(animFrameRef.current);
    } else {
      setDisplayBalance(balance);
    }
  }, [balance, purchaseSuccess?.added]);

  return (
    <>
      {/* Balance */}
      <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Your DUM Balance</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black text-white">{displayBalance.toLocaleString()}</span>
              <span className="text-lg text-zinc-500">points</span>
              {deltaAccent !== null && deltaAccent > 0 && (
                <span className="animate-pulse font-mono text-sm font-bold text-sky-400">+{deltaAccent.toLocaleString()}</span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">Earned + purchased. Use for discounts or claim to wallet.</div>
            {hubClaimable > 0 && (
              <button onClick={onNavigateClaim} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 transition hover:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(0,255,163,0.5)]" />
                {hubClaimable.toLocaleString()} DUM ready to claim →
              </button>
            )}
          </div>
          <div className="rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em]" style={{ borderColor: tier.color, color: tier.color }}>
            {tier.name}
          </div>
        </div>
        {next && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-[10px]">
              <span className="text-zinc-500">Progress to {next.name}</span>
              <span className="font-mono text-zinc-400">{balance} / {next.min}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: next.color }} />
            </div>
          </div>
        )}
      </div>

      {/* How to Earn */}
      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">How to Earn</div>
        <div className="space-y-3">
          {[
            { icon: "🛒", points: "+2", label: "Every purchase you make" },
            { icon: "🏪", points: "+25", label: "Every storefront you launch" },
            { icon: "📦", points: "+5", label: "Every product or service you list" },
            { icon: "🔁", points: "+2", label: "When customers buy from your business" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4">
              <span className="text-lg">{item.icon}</span>
              <span className="w-10 text-right font-mono text-sm font-bold text-emerald-400">{item.points}</span>
              <span className="text-sm text-zinc-400">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Buy Points (Stripe) */}
      <div className="mb-6 rounded-2xl border border-sky-400/15 bg-gradient-to-br from-sky-400/[0.03] to-zinc-950 p-6">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400/70">Buy DUM Points</div>
        <p className="mb-4 text-[12px] text-zinc-500">Card payment via Stripe. Added to your balance immediately.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { id: "tier_100", points: 100, price: "$10", bonus: null, best: false },
            { id: "tier_275", points: 275, price: "$25", bonus: "10% bonus", best: true },
            { id: "tier_600", points: 600, price: "$50", bonus: "20% bonus", best: false },
          ].map((t) => (
            <button
              key={t.id}
              onClick={async () => {
                setPurchasing(t.id);
                try {
                  const token = await getToken();
                  const res = await fetch(`${API_BASE}/api/dum/purchase`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify({ tier_id: t.id, success_url: window.location.origin + "/hub", cancel_url: window.location.origin + "/hub" }),
                  });
                  if (!res.ok) { const err = await res.json().catch(() => ({})); setPurchaseError(err.detail || "Purchase failed"); setPurchasing(null); return; }
                  const data = await res.json();
                  if (data.checkout_url) window.location.href = data.checkout_url;
                } catch { setPurchaseError("Network error"); setPurchasing(null); }
              }}
              disabled={!!purchasing}
              className={`relative rounded-xl border p-5 text-center transition hover:-translate-y-1 ${t.best ? "border-sky-400/30 bg-sky-400/[0.06] shadow-[0_0_16px_rgba(56,189,248,0.06)]" : "border-zinc-800 bg-zinc-900/50"} ${purchasing === t.id ? "opacity-60" : ""}`}
            >
              {t.best && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-sky-400 px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-black">Best Value</div>}
              <div className="mb-1 text-2xl font-black text-white">{t.points}</div>
              <div className="mb-2 text-[11px] text-zinc-500">points</div>
              <div className="text-lg font-bold text-sky-400">{t.price}</div>
              {t.bonus && <div className="mt-1 text-[10px] font-semibold text-sky-400/70">{t.bonus}</div>}
              <div className="mt-3 rounded-lg bg-sky-400/10 px-3 py-1.5 text-[11px] font-bold text-sky-400">
                {purchasing === t.id ? "Processing..." : "Buy Now"}
              </div>
            </button>
          ))}
        </div>
        {purchaseError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">{purchaseError}</div>}
        {purchaseSuccess && (
          <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sky-400">✓</span>
                <span className="text-xs font-bold text-sky-300">Purchase complete</span>
              </div>
              <span className="text-[9px] text-zinc-500">just now</span>
            </div>
            {purchaseSuccess.added > 0 && (
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-lg font-black text-sky-400">+{purchaseSuccess.added.toLocaleString()}</span>
                <span className="text-[11px] text-zinc-500">DUM added</span>
              </div>
            )}
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-600">
              <span>Paid via Stripe</span>
              <span className="font-mono text-zinc-500">Balance: {purchaseSuccess.newBalance.toLocaleString()}</span>
            </div>
          </div>
        )}
        <p className="mt-3 text-center text-[10px] text-zinc-600">💳 Stripe checkout · Instant delivery · No waiting</p>
      </div>

      {/* Purchase History */}
      <PurchaseHistory purchaseSuccess={purchaseSuccess} />

      {/* Recent Activity */}
      <RecentActivity />

    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   PURCHASE HISTORY (Points tab)
   ════════════════════════════════════════════════════════════════ */
function PurchaseHistory({ purchaseSuccess }: { purchaseSuccess: any }) {
  const [purchases, setPurchases] = useState<{ amount: number; created_at: string }[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.privyId) return;
    fetch(`${API_BASE}/api/dum/transactions/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => {
        const buys = (d.transactions || []).filter((t: any) => t.reason === "stripe_purchase").slice(0, 5);
        setPurchases(buys);
      })
      .catch(() => {});
  }, [user?.privyId, purchaseSuccess]);

  if (purchases.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Purchase History</div>
      <div className="space-y-2">
        {purchases.map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-zinc-900/50 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-sky-400">+{p.amount}</span>
              <span className="text-[11px] text-zinc-400">Purchased via Stripe</span>
            </div>
            <span className="text-[10px] text-zinc-600">{p.created_at ? formatTimeAgo(p.created_at) : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   RECENT ACTIVITY (shared)
   ════════════════════════════════════════════════════════════════ */
function RecentActivity() {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "earned" | "spent" | "purchased">("all");
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.privyId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/dum/transactions/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => setTxns(d.transactions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.privyId]);

  const filtered = txns.filter((tx) => {
    if (filter === "earned") return tx.amount > 0 && !["swap_buy", "stripe_purchase", "demo_swap"].includes(tx.reason);
    if (filter === "spent") return tx.amount < 0;
    if (filter === "purchased") return ["swap_buy", "stripe_purchase", "demo_swap"].includes(tx.reason);
    return true;
  });

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Activity</div>
        <div className="flex gap-1">
          {([
            { id: "all" as const, label: "All" },
            { id: "earned" as const, label: "Earned" },
            { id: "spent" as const, label: "Spent" },
            { id: "purchased" as const, label: "Purchased" },
          ]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] transition ${
                filter === f.id
                  ? "bg-emerald-400/10 text-emerald-400"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="py-4 text-center text-xs text-zinc-600">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">
          {filter === "all" ? "No activity yet. Earn DUM Points by creating businesses and making purchases." : `No ${filter} activity yet.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 15).map((tx) => (
            <div key={tx.id} className="rounded-xl bg-zinc-900/50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold ${tx.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                  </span>
                  <div>
                    <span className="text-[12px] text-zinc-300">{REASON_LABELS[tx.reason] || tx.reason}</span>
                    <span className="ml-2 rounded-full bg-emerald-400/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-400/50">confirmed</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-600">{tx.created_at ? formatTimeAgo(tx.created_at) : ""}</span>
              </div>
              {(tx.reason === "swap_buy" || tx.reason === "claim") && tx.reference_id && tx.reference_id.length > 30 && (
                <a
                  href={`https://explorer.solana.com/tx/${tx.reference_id}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[9px] text-emerald-400/50 transition hover:text-emerald-400"
                >
                  View on Explorer → <span className="font-mono text-zinc-700">{tx.reference_id.slice(0, 8)}...{tx.reference_id.slice(-4)}</span>
                </a>
              )}
              {tx.reason === "stripe_purchase" && (
                <div className="mt-1 text-[9px] text-sky-400/50">💳 Stripe purchase · Instant</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CLAIM TAB — Real on-chain DUM token minting
   ════════════════════════════════════════════════════════════════ */
type ClaimState = "idle" | "preparing" | "submitting" | "confirming" | "success" | "error";

function ClaimTab({ balance, onBalanceUpdate }: { balance: number; onBalanceUpdate: (b: number) => void }) {
  const { wallets: privyWallets, createWallet } = useSolanaWallets();
  const privyWallet = privyWallets[0] || null;
  const walletAddress = privyWallet?.address || null;
  const { getToken, user } = useAuth();
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{ dum: number; sig: string; mint: string; mode: string } | null>(null);
  const [onChainBalance, setOnChainBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [claimHistory, setClaimHistory] = useState<{ amount: number; reference_id: string; created_at: string }[]>([]);
  const [claimable, setClaimable] = useState<{ claimable: number; total_earned: number; total_claimed: number } | null>(null);

  function copyToClipboard(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  // Friendly error messages
  function friendlyError(msg: string): string {
    if (msg.includes("wait") && msg.includes("seconds")) return msg;
    if (msg.includes("wallet")) return "Wallet not connected. Please wait for your wallet to set up or refresh the page.";
    if (msg.includes("401") || msg.includes("auth") || msg.includes("Auth")) return "Please sign in to claim DUM tokens.";
    if (msg.includes("429") || msg.includes("limit")) return msg;
    if (msg.includes("insufficient") || msg.includes("gas") || msg.includes("lamport")) return "You need devnet SOL for gas fees. Visit a Solana faucet to get free devnet SOL.";
    if (msg.includes("network") || msg.includes("Network")) return "Network error. Check your connection and try again.";
    return msg || "Something went wrong. Please try again.";
  }

  // Auto-create wallet if user is logged in but has no wallet
  useEffect(() => {
    if (user && !privyWallet) {
      createWallet().catch(() => {});
    }
  }, [user, privyWallet]);

  // Load claim history + claimable amount
  useEffect(() => {
    if (!user?.privyId) return;
    fetch(`${API_BASE}/api/dum/transactions/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => {
        const claims = (d.transactions || []).filter((t: any) => t.reason === "claim").slice(0, 5);
        setClaimHistory(claims);
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/dum/claimable/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => setClaimable(d))
      .catch(() => {});
  }, [user?.privyId, claimState]);

  // Fetch on-chain DUM balance
  useEffect(() => {
    if (!walletAddress) { setOnChainBalance(null); return; }
    fetch(`${API_BASE}/api/dum/balance-onchain/${walletAddress}`)
      .then((r) => r.json())
      .then((d) => setOnChainBalance(d.balance ?? null))
      .catch(() => setOnChainBalance(null));
  }, [walletAddress, claimState]);

  const claimableNow = claimable?.claimable ?? null;
  const claimAmount = claimableNow !== null ? claimableNow : 0;
  const canClaim = claimAmount > 0 && !!walletAddress && claimState === "idle";

  async function handleClaim() {
    if (!walletAddress || !canClaim) return;

    setClaimState("preparing");
    setClaimError(null);
    setClaimResult(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to claim DUM tokens.");

      setClaimState("submitting");
      const res = await fetch(`${API_BASE}/api/dum/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          amount: claimAmount,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Claim failed (${res.status})`);
      }

      setClaimState("confirming");
      const data = await res.json();

      // Update DB balance everywhere
      const newBal = data.new_balance || balance + (data.dum_received || 0);
      localStorage.setItem("dum_points", String(newBal));
      window.dispatchEvent(new Event("dum-points-update"));
      onBalanceUpdate(newBal);

      // Refresh on-chain balance
      fetch(`${API_BASE}/api/dum/balance-onchain/${walletAddress}`)
        .then((r) => r.json())
        .then((d) => setOnChainBalance(d.balance ?? null))
        .catch(() => {});

      setClaimResult({
        dum: data.dum_received,
        sig: data.tx_signature || "",
        mint: data.mint || "",
        mode: data.mode || "db-only",
      });
      setClaimState("success");
    } catch (err: any) {
      setClaimError(friendlyError(err?.message || "Claim failed"));
      setClaimState("error");
    }
  }

  const dumMint = process.env.NEXT_PUBLIC_DUM_MINT || process.env.NEXT_PUBLIC_DUM_MINT_ADDRESS || "J5hiqRLs9Cnj2Yr5q98XN9e2ZeEcmyXabC5dXfQGzq3U";
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : "";
  const hasTxSig = claimResult?.sig && claimResult.sig.length > 20;

  // Claim button label based on state
  const claimButtonLabel = {
    idle: `Claim All ${claimAmount.toLocaleString()} DUM`,
    preparing: "Preparing...",
    submitting: "Submitting to Solana...",
    confirming: "Confirming...",
    success: "Claimed!",
    error: "Try Again",
  }[claimState] || "Claim";

  return (
    <div className="mx-auto max-w-md">
      {/* ── Success panel ── */}
      {claimState === "success" && claimResult ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.06] to-zinc-950 p-6 text-center">
            <div className="mb-3 text-3xl">✓</div>
            <div className="text-xl font-black text-white">DUM Claimed to Wallet</div>
            <div className="mt-2 flex items-baseline justify-center gap-2">
              <span className="text-3xl font-black text-emerald-400">+{claimResult.dum.toLocaleString()}</span>
              <span className="text-sm text-zinc-400">DUM</span>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-400">
              {hasTxSig ? "Minted on Solana Devnet" : "Earned DUM released to balance"}
            </div>
            {onChainBalance !== null && (
              <div className="mt-2 text-[11px] text-zinc-500">On-chain wallet balance: {onChainBalance.toLocaleString()} DUM</div>
            )}
          </div>

          {/* On-chain proof — only show if we have real data */}
          {(hasTxSig || walletAddress) && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">
                {hasTxSig ? "On-chain Proof" : "Wallet Info"}
              </div>
              {hasTxSig && (
                <div className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-4 py-3">
                  <a href={`https://explorer.solana.com/tx/${claimResult.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <div className="text-[12px] font-semibold text-white">Transaction</div>
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-600">{claimResult.sig.slice(0, 16)}...{claimResult.sig.slice(-8)}</div>
                  </a>
                  <button onClick={() => copyToClipboard(claimResult.sig, "tx")} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-zinc-400 hover:text-emerald-400">{copied === "tx" ? "✓" : "Copy"}</button>
                  <a href={`https://explorer.solana.com/tx/${claimResult.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-emerald-400/70 hover:text-emerald-400">View →</a>
                </div>
              )}
              {walletAddress && (
                <div className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-4 py-3">
                  <a href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <div className="text-[12px] font-semibold text-white">Your Wallet</div>
                    <div className="mt-0.5 font-mono text-[9px] text-zinc-600">{shortWallet}</div>
                  </a>
                  <a href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-emerald-400/70 hover:text-emerald-400">View →</a>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { setClaimState("idle"); setClaimResult(null); setCopied(null); }}
            className="w-full rounded-xl border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-emerald-400/30 hover:text-white"
          >
            Claim more
          </button>
        </div>
      ) : (
        <>
          {/* ── Wallet + Network status ── */}
          <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Wallet</div>
              <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/50 px-2.5 py-1 text-[9px] font-bold text-zinc-500">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Solana Devnet
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                {walletAddress ? (
                  <div className="font-mono text-sm text-white">{shortWallet}</div>
                ) : (
                  <div className="text-sm text-zinc-500">Connecting wallet...</div>
                )}
              </div>
              {walletAddress && (
                <button onClick={() => copyToClipboard(walletAddress, "wallet")} className="text-[9px] text-zinc-600 hover:text-emerald-400">
                  {copied === "wallet" ? "✓ Copied" : "Copy address"}
                </button>
              )}
            </div>
            {/* Balance row */}
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-zinc-800 pt-3">
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Total Balance</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-white">{balance.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-emerald-400/60">Claimable</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-emerald-400">
                  {claimableNow !== null ? claimableNow.toLocaleString() : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">On-chain</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-zinc-400">
                  {onChainBalance !== null ? onChainBalance.toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* ── Claim form ── */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Claim Earned DUM</div>
            <p className="mb-4 text-[12px] text-zinc-500">
              Release earned DUM to your Solana wallet. Minted as real SPL tokens on devnet.
            </p>

            {/* Claimable zero state */}
            {claimableNow !== null && claimableNow === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 text-center">
                <div className="text-sm font-bold text-zinc-400">Nothing to claim yet</div>
                <p className="mt-2 text-[12px] text-zinc-600">
                  Earn DUM by creating businesses, adding offers, making purchases, or referring friends.
                </p>
                <div className="mt-3 text-[10px] text-zinc-700">
                  Earned: {claimable?.total_earned?.toLocaleString() || 0} · Claimed: {claimable?.total_claimed?.toLocaleString() || 0}
                </div>
              </div>
            ) : (
              <>
                {/* Claimable amount display */}
                {claimableNow !== null && (
                  <div className="mb-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-400/60">Available to claim</div>
                    <div className="mt-1 font-mono text-3xl font-black text-emerald-400">{claimableNow.toLocaleString()}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">DUM earned from activity</div>
                  </div>
                )}

                {/* Claim All button */}
                <button
                  onClick={claimState === "error" ? () => setClaimState("idle") : handleClaim}
                  disabled={!canClaim}
                  className={`w-full rounded-xl px-6 py-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    claimState === "error"
                      ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      : "bg-emerald-400 text-black hover:bg-emerald-300"
                  }`}
                >
                  {!walletAddress ? "Setting up wallet..." : claimButtonLabel}
                </button>
              </>
            )}

            {claimState === "error" && claimError && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400">
                {claimError}
              </div>
            )}

            {claimState !== "idle" && claimState !== "error" && claimState !== "success" && (
              <div className="mt-3 text-center text-[10px] text-zinc-600">
                {claimState === "preparing" && "Preparing your claim..."}
                {claimState === "submitting" && "Submitting transaction to Solana devnet..."}
                {claimState === "confirming" && "Confirming on-chain..."}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Claim History ── */}
      {claimHistory.length > 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Claim History</div>
          <div className="space-y-2">
            {claimHistory.map((c, i) => {
              const hasSig = c.reference_id && c.reference_id.length > 30;
              return (
                <div key={i} className="flex items-center justify-between rounded-xl bg-zinc-900/50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-emerald-400">+{c.amount}</span>
                    <span className="text-[11px] text-zinc-400">Claimed to wallet</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">{c.created_at ? formatTimeAgo(c.created_at) : ""}</span>
                    {hasSig && (
                      <a
                        href={`https://explorer.solana.com/tx/${c.reference_id}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[8px] font-bold text-emerald-400/70 transition hover:text-emerald-400"
                      >
                        Tx →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   USE TAB — How to spend DUM Points
   ════════════════════════════════════════════════════════════════ */
function UseTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">Spend Your DUM Points</div>
        <div className="space-y-4">
          {[
            { icon: "%", title: "10% off any offer", desc: "Spend 10 points at checkout. Instant discount, any business." },
            { icon: "🌐", title: "Works everywhere", desc: "Earn at any storefront, spend at any storefront." },
            { icon: "⬆", title: "Higher tiers, more perks", desc: "More points, better tier. Priority placement, more AI, exclusive features." },
          ].map((f) => (
            <div key={f.title} className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">{f.icon}</div>
              <div>
                <div className="text-sm font-bold text-white">{f.title}</div>
                <div className="text-[12px] text-zinc-500">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center">
        <div className="mb-2 text-lg font-black text-white">Use DUM. Save money.</div>
        <p className="mb-4 text-sm text-zinc-500">Instant discounts at checkout, across every business.</p>
        <Link href="/discover" className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">
          Browse Businesses →
        </Link>
      </div>

      {/* Tiers */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Tiers</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIERS.map((t) => (
            <div key={t.name} className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 text-center">
              <div className="mb-1 text-lg font-black" style={{ color: t.color }}>{t.min === 0 ? "0" : t.min.toLocaleString()}+</div>
              <div className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: t.color }}>{t.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MARKET TAB — Coming Soon positioning screen
   ════════════════════════════════════════════════════════════════ */
function MarketComingSoonTab() {
  return (
    <div className="mx-auto max-w-lg space-y-6">

      {/* ── 1. Header + Hook ── */}
      <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.04] via-zinc-950 to-violet-500/[0.03] p-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-2xl font-black text-white sm:text-3xl">DUM Market</h2>
          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">
            Coming Soon
          </span>
        </div>
        <p className="mx-auto mt-4 max-w-sm text-lg font-semibold leading-snug text-zinc-300">
          You don&apos;t trade DUM yet.<br />
          <span className="text-emerald-400">You earn it first.</span>
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-zinc-500">
          DUM starts as a reward. It becomes a market when real usage, real demand, and real businesses back it — not before.
        </p>
      </div>

      {/* ── 2. What is the DUM Market ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">What is the DUM Market?</div>
        <p className="text-sm leading-relaxed text-zinc-400">
          A real exchange where DUM holders trade, transfer, and put their rewards to work.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          DUM is not a token-first project. It becomes tradable only after real commerce backs it. The price is set by supply and demand — not by us.
        </p>
      </div>

      {/* ── 3. Why a Market ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Why Build a Market?</div>
        <p className="mb-4 text-sm leading-relaxed text-zinc-400">
          Most rewards are closed. Airline miles, credit card points, in-game currency — locked to one platform, non-transferable, often worthless.
        </p>
        <div className="space-y-2">
          {[
            { old: "Airline miles expire", dum: "DUM is yours permanently on-chain" },
            { old: "Credit card points locked to one issuer", dum: "DUM works across every DUM Club business" },
            { old: "In-game currency has no real value", dum: "DUM becomes tradable between real users" },
          ].map((row) => (
            <div key={row.old} className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-900/40 px-4 py-3">
              <div className="text-[11px] text-zinc-600 line-through decoration-zinc-700">{row.old}</div>
              <div className="text-[11px] font-medium text-emerald-400/80">{row.dum}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-zinc-500">
          Open value. Transferable. Tradable between real users.
        </p>
      </div>

      {/* ── 4. How Value Flows ── */}
      <div className="rounded-2xl border border-emerald-400/10 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">How Value Flows</div>
        <p className="mb-4 text-sm text-zinc-400">
          Rewards come from real revenue, not inflation. Every transaction funds the pool.
        </p>
        {/* Transaction breakdown */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600">Example: $100 purchase</div>
          <div className="space-y-2">
            {[
              { label: "Customer pays", value: "$100", color: "text-white" },
              { label: "Business receives", value: "~$93", color: "text-white" },
              { label: "Platform fee", value: "~$7", color: "text-zinc-400" },
              { label: "Portion funds DUM rewards", value: "2–5%", color: "text-emerald-400" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-zinc-800/40 pb-2 last:border-0 last:pb-0">
                <span className="text-[12px] text-zinc-500">{row.label}</span>
                <span className={`font-mono text-sm font-bold ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Flow */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] px-3 py-3">
          {["Customer", "Platform", "Business", "Rewards", "Back to User"].map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-emerald-400">{step}</span>
              {i < 4 && <span className="text-zinc-700">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center text-[10px] text-zinc-600">
          Nothing is manufactured. Every DUM is earned.
        </p>
      </div>

      {/* ── 5. How We Get There (Mechanism) ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">How We Get There</div>
        <p className="mb-5 text-sm text-zinc-400">
          Markets are grown, not switched on. Each step causes the next.
        </p>
        <div className="space-y-3">
          {[
            { phase: "1", title: "Transactions create rewards", desc: "Every purchase generates DUM — funded by revenue, not printing.", cause: "More purchases → more DUM distributed" },
            { phase: "2", title: "Rewards create demand", desc: "Users earn DUM and spend it on discounts. Natural demand follows.", cause: "More users → more demand" },
            { phase: "3", title: "Spending creates circulation", desc: "DUM moves through businesses instead of sitting idle.", cause: "More spending → healthier velocity" },
            { phase: "4", title: "Activity builds value", desc: "More businesses, more users, more utility, more trust.", cause: "More activity → stronger network" },
            { phase: "5", title: "Liquidity is introduced", desc: "Treasury and user participation create depth for fair pricing.", cause: "Real depth → real prices" },
            { phase: "6", title: "Trading unlocks", desc: "Real supply, real demand, real stability. Then the market opens.", cause: "Fundamentals first" },
          ].map((step) => {
            const isActive = Number(step.phase) <= 3;
            return (
              <div key={step.phase} className="flex gap-4">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                  isActive
                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-500"
                }`}>
                  {step.phase}
                </div>
                <div className="flex-1">
                  <div className={`text-sm font-bold ${isActive ? "text-white" : "text-zinc-500"}`}>{step.title}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{step.desc}</div>
                  <div className="mt-1 text-[10px] font-medium text-emerald-400/50">{step.cause}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 6. How Transactions Create Stability ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">How Transactions Create Stability</div>
        <p className="mb-5 text-sm text-zinc-400">
          Every action feeds a reinforcing loop. More usage, more stability.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { action: "Purchases", result: "Generate rewards", icon: "🛒" },
            { action: "Rewards", result: "Distribute DUM", icon: "◆" },
            { action: "Spending DUM", result: "Creates demand", icon: "%" },
            { action: "Business adoption", result: "Creates real utility", icon: "🏪" },
          ].map((item) => (
            <div key={item.action} className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
              <div className="mb-2 text-base">{item.icon}</div>
              <div className="text-xs font-bold text-white">{item.action}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">{item.result}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] px-4 py-3">
          {["Purchases", "Rewards", "Spending", "Demand", "Liquidity", "Stability"].map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-emerald-400">{step}</span>
              {i < 5 && <span className="text-[10px] text-zinc-700">→</span>}
            </span>
          ))}
        </div>
      </div>

      {/* ── 7. Customer-First Market Model ── */}
      <div className="rounded-2xl border border-emerald-400/10 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Customer-First Market</div>
        <p className="mb-4 text-sm text-zinc-400">
          Built from customers, not wallets. Active users matter more than empty holders.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-zinc-800/60 bg-zinc-950/80 px-3 py-4">
          {["Customers", "Activity", "Demand", "Holders", "Market"].map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                i < 3
                  ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20"
                  : "bg-zinc-800 text-zinc-500 border border-zinc-700"
              }`}>
                {step}
              </span>
              {i < 4 && <span className="text-zinc-700">→</span>}
            </span>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-zinc-600">
          The sequence matters. Customers come first. Market comes last.
        </p>
      </div>

      {/* ── 8. When the Market Unlocks ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">When the Market Unlocks</div>
        <p className="mb-4 text-sm text-zinc-400">
          The market is a result of activity, not a starting feature.
        </p>
        <div className="space-y-2">
          {[
            "Active customers are consistently using DUM across businesses",
            "Multiple businesses accept and integrate DUM into their storefronts",
            "Transactions are recurring, not one-time",
            "A meaningful portion of users choose to hold DUM beyond immediate use",
          ].map((cond) => (
            <div key={cond} className="flex items-start gap-3 rounded-xl bg-zinc-900/40 px-4 py-3">
              <span className="mt-0.5 shrink-0 text-[10px] text-zinc-600">○</span>
              <span className="text-[12px] leading-relaxed text-zinc-400">{cond}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] text-zinc-600">
          No dates. No artificial deadlines. Fundamentals first.
        </p>
      </div>

      {/* ── 9. The Flywheel ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">The Flywheel</div>
        <div className="flex items-center justify-between rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-4 sm:px-4">
          {["Earn", "Use", "Demand", "Liquidity", "Trade"].map((step, i) => (
            <div key={step} className="flex items-center gap-1 sm:gap-2">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full border text-[10px] font-bold sm:h-10 sm:w-10 sm:text-[11px] ${
                i < 3
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400"
                  : "border-zinc-700 bg-zinc-800 text-zinc-500"
              }`}>
                {step.slice(0, 2)}
              </div>
              {i < 4 && <span className="text-[10px] text-zinc-700">→</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-zinc-600">
          Each step feeds the next. No step is skipped.
        </p>
      </div>

      {/* ── 10. Why It's Not Live Yet ── */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Why Not Live Yet?</div>
        <p className="text-sm font-semibold text-zinc-300">Markets without usage are unstable.</p>
        <p className="mt-3 text-sm text-zinc-500">
          We are building real demand first — not launching empty trading.
        </p>
        <div className="mt-4 space-y-2">
          {[
            { label: "Real users", desc: "People who use DUM Club to run businesses and buy services" },
            { label: "Real transactions", desc: "Purchases, discounts, and rewards flowing through the system daily" },
            { label: "Real value", desc: "DUM backed by utility across a growing ecosystem of businesses" },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-xl bg-zinc-900/40 px-4 py-3">
              <span className="mt-0.5 text-emerald-400/60">&#10003;</span>
              <div>
                <span className="text-xs font-bold text-white">{item.label}</span>
                <span className="ml-1.5 text-[11px] text-zinc-500">— {item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 11. Vision ── */}
      <div className="rounded-2xl border border-emerald-400/10 bg-gradient-to-r from-emerald-400/[0.03] to-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">The Vision</div>
        <div className="flex items-center justify-between gap-1">
          {[
            { label: "Reward System", active: true },
            { label: "Marketplace", active: true },
            { label: "Market", active: false },
            { label: "Economy", active: false },
          ].map((step, i) => (
            <div key={step.label} className="flex flex-1 flex-col items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${
                step.active
                  ? "bg-emerald-400/15 text-emerald-400 border border-emerald-400/30"
                  : "bg-zinc-800 text-zinc-600 border border-zinc-700 border-dashed"
              }`}>
                {step.active ? "✓" : i + 1}
              </div>
              <span className={`text-center text-[9px] font-bold leading-tight ${step.active ? "text-emerald-400" : "text-zinc-600"}`}>{step.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500">
          DUM is not a token looking for a use case. It is a use case becoming a token.
        </p>
      </div>

      {/* ── 12. CTA ── */}
      <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.05] to-zinc-950 p-8 text-center">
        <div className="mb-2 text-lg font-black text-white">The market starts with you.</div>
        <p className="mb-5 text-sm text-zinc-500">Every DUM Point you earn today brings the market closer to launch.</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/discover" className="flex flex-1 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300">
            Browse Businesses →
          </Link>
          <Link href="/build" className="flex flex-1 items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white">
            Create a Business
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   REFER TAB
   ════════════════════════════════════════════════════════════════ */
function ReferTab({ getToken }: { getToken: () => Promise<string | null> }) {
  const [referral, setReferral] = useState<{ code: string; clicks: number; signups: number; points_earned: number } | null>(null);
  const [loadingRef, setLoadingRef] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) { setLoadingRef(false); return; }
        const res = await fetch(`${API_BASE}/api/referrals/mine`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setReferral(await res.json());
        }
      } catch {} finally { setLoadingRef(false); }
    })();
  }, []);

  if (loadingRef) {
    return <div className="text-center text-sm text-zinc-500 py-12">Loading referral info...</div>;
  }

  const referralUrl = referral
    ? `${typeof window !== "undefined" ? window.location.origin : "https://dum-club.vercel.app"}?ref=${referral.code}`
    : "";

  return (
    <div className="space-y-6">
      {/* Referral link */}
      <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Your Referral Link</div>
        <p className="mt-2 text-sm text-zinc-400">Share your link. When someone signs up, you both earn DUM Points.</p>

        {referral && (
          <>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 truncate rounded-xl border border-zinc-700 bg-base px-3 py-2.5 font-mono text-sm text-zinc-300">
                {referralUrl}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(referralUrl).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
                className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                  copied
                    ? "bg-emerald-400/20 text-emerald-400 border border-emerald-400/30"
                    : "bg-emerald-400 text-black hover:bg-emerald-300"
                }`}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("Join me on DUM Club — build a business, earn rewards.\n\n")}&url=${encodeURIComponent(referralUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 py-2.5 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Share on X
              </a>
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: "Join DUM Club",
                      text: "Build a business, earn rewards on DUM Club",
                      url: referralUrl,
                    }).catch(() => {});
                  }
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-700 py-2.5 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                More options
              </button>
            </div>
          </>
        )}
      </div>

      {/* Stats */}
      {referral && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-center">
            <div className="text-2xl font-black text-white">{referral.clicks}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">Clicks</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-center">
            <div className="text-2xl font-black text-white">{referral.signups}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">Signups</div>
          </div>
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-4 text-center">
            <div className="text-2xl font-black text-emerald-400">{referral.points_earned}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-emerald-400/60">DUM Earned</div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">How It Works</div>
        <div className="space-y-3">
          {[
            { step: "1", text: "Share your link with friends or on social media" },
            { step: "2", text: "They sign up using your link" },
            { step: "3", text: "You earn 25 DUM Points, they get 10 welcome points" },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-[11px] font-bold text-emerald-400">
                {s.step}
              </span>
              <span className="text-sm text-zinc-300">{s.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MAIN HUB PAGE
   ════════════════════════════════════════════════════════════════ */
export default function HubPage() {
  const { user, login, getToken } = useAuth();
  const [balance, setBalance] = useState(0);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState<{ added: number; newBalance: number } | null>(null);
  const [tab, setTab] = useState<"points" | "claim" | "use" | "market" | "refer">("points");
  const [hubClaimable, setHubClaimable] = useState(0);

  useEffect(() => {
    const read = () => setBalance(Number(localStorage.getItem("dum_points") || "0"));
    read();
    window.addEventListener("dum-points-update", read);
    return () => window.removeEventListener("dum-points-update", read);
  }, []);

  // Fetch claimable amount for tab badge
  useEffect(() => {
    if (!user?.privyId) return;
    fetch(`${API_BASE}/api/dum/claimable/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => setHubClaimable(d.claimable || 0))
      .catch(() => {});
  }, [user?.privyId, tab]);

  // Detect successful purchase return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dum_purchase") === "success") {
      const balanceBefore = balance;
      const refreshBalance = async () => {
        if (!user?.privyId) return;
        try {
          const res = await fetch(`${API_BASE}/api/dum/balance/${user.privyId}`);
          if (res.ok) {
            const data = await res.json();
            const newBal = data.balance || 0;
            setBalance(newBal);
            localStorage.setItem("dum_points", String(newBal));
            window.dispatchEvent(new Event("dum-points-update"));
            const added = newBal - balanceBefore;
            if (added > 0) setPurchaseSuccess({ added, newBalance: newBal });
            else if (!purchaseSuccess) setPurchaseSuccess({ added: 0, newBalance: newBal });
          }
        } catch {}
      };
      // Set immediate receipt (amount fills in when balance refreshes)
      if (!purchaseSuccess) setPurchaseSuccess({ added: 0, newBalance: balance });
      setTimeout(refreshBalance, 1000);
      setTimeout(refreshBalance, 3000);
      setTimeout(refreshBalance, 7000);
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("dum_purchase");
      window.history.replaceState({}, "", cleanUrl.toString());
    }
  }, [user?.privyId]);

  const tier = getTier(balance);
  const next = getNextTier(balance);
  const progressPct = next ? Math.min((balance / next.min) * 100, 100) : 100;

  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-base px-4 text-white">
        <Starfield count={60} />
        <div className="relative z-10 max-w-md text-center">
          <div className="mb-4 text-4xl">◆</div>
          <h1 className="text-2xl font-black tracking-tight">DUM Hub</h1>
          <p className="mt-3 text-sm text-zinc-400">Sign in to view your points, claim rewards, and save at checkout.</p>
          <button onClick={() => login()} className="mt-6 w-full rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">
            Sign In to Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-base text-white">
      <Starfield count={60} />
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-16">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/60">DUM Hub · Digital Utility Market · Powered by Solana</div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">DUM Hub</h1>
          <p className="mt-2 text-sm text-zinc-500">Earn · Claim · Use · Trade</p>
        </div>

        {/* How DUM works — explainer strip */}
        <div className="mb-6 grid grid-cols-3 gap-2 text-center">
          {[
            { step: "1", label: "Earn", desc: "Get DUM Points from purchases and businesses" },
            { step: "2", label: "Claim", desc: "Claim eligible DUM to your Solana wallet" },
            { step: "3", label: "Use", desc: "Spend DUM for discounts and perks" },
          ].map((s) => (
            <div key={s.step} className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-2 py-3">
              <div className="text-[9px] font-bold text-emerald-400/50">{s.step}</div>
              <div className="text-xs font-bold text-white">{s.label}</div>
              <div className="mt-1 text-[9px] leading-tight text-zinc-600">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="mb-8 flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-1 max-w-lg mx-auto">
          {[
            { id: "points" as const, label: "Points", icon: "◆" },
            { id: "claim" as const, label: "Claim", icon: "⬇" },
            { id: "use" as const, label: "Use", icon: "%" },
            { id: "market" as const, label: "Market", icon: "📊" },
            { id: "refer" as const, label: "Refer", icon: "🔗" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-all duration-200 ${
                tab === t.id
                  ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 shadow-[0_0_12px_rgba(0,255,163,0.08)]"
                  : "text-zinc-500 border border-transparent hover:text-zinc-300"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
              {t.id === "claim" && hubClaimable > 0 && (
                <span className="ml-0.5 min-w-[16px] rounded-full bg-emerald-400/15 px-1 py-0.5 text-center text-[8px] font-bold leading-none text-emerald-400">
                  {hubClaimable > 99 ? "99+" : hubClaimable}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "points" && (
          <PointsTab
            balance={balance} tier={tier} next={next} progressPct={progressPct}
            user={user} getToken={getToken}
            purchasing={purchasing} setPurchasing={setPurchasing}
            purchaseError={purchaseError} setPurchaseError={setPurchaseError}
            purchaseSuccess={purchaseSuccess}
            hubClaimable={hubClaimable} onNavigateClaim={() => setTab("claim")}
          />
        )}
        {tab === "claim" && <ClaimTab balance={balance} onBalanceUpdate={setBalance} />}
        {tab === "use" && <UseTab />}
        {tab === "market" && <MarketComingSoonTab />}
        {tab === "refer" && <ReferTab getToken={getToken} />}

        {/* Bottom CTAs */}
        <p className="mt-8 text-center text-[11px] text-zinc-600">Earn when you sell. Earn when you buy.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Link href="/build" className="flex flex-1 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300">
            Start Selling →
          </Link>
          <Link href="/discover" className="flex flex-1 items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white">
            Browse the Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
