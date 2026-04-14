"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { TIERS, getTier, getNextTier } from "../../lib/dumTiers";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL, Connection } from "@solana/web3.js";
import { Starfield } from "../../components/Starfield";

const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

const DUM_TREASURY = process.env.NEXT_PUBLIC_DUM_TREASURY_WALLET || "";

import { API_BASE } from "../../lib/apiBase";

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
/* ── Network Impact (lightweight, read-only) ── */
function NetworkImpact({ privyId }: { privyId?: string }) {
  const [data, setData] = useState<{
    verified_purchases: number;
    businesses_visited: number;
    businesses_discovered: number;
    referral_signups: number;
    activity_this_week: number;
  } | null>(null);

  useEffect(() => {
    if (!privyId) return;
    fetch(`${API_BASE}/api/dum/network-impact/${encodeURIComponent(privyId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setData(d); })
      .catch(() => {});
  }, [privyId]);

  if (!data) return null;
  const total = data.verified_purchases + data.businesses_visited + data.businesses_discovered + data.referral_signups;
  if (total === 0) return null;

  const stats = [
    { value: data.verified_purchases, label: "Purchases verified", show: data.verified_purchases > 0 },
    { value: data.businesses_visited, label: "Businesses visited", show: data.businesses_visited > 0 },
    { value: data.businesses_discovered, label: "Discovered for DUM Club", show: data.businesses_discovered > 0 },
    { value: data.referral_signups, label: "Referral signups", show: data.referral_signups > 0 },
  ].filter((s) => s.show);

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Your Impact</div>
      <div className={`grid gap-3 ${stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : stats.length === 3 ? "grid-cols-3" : stats.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3 text-center">
            <div className="text-xl font-black text-white">{s.value}</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>
      {data.activity_this_week > 0 && (
        <div className="mt-3 text-center text-[10px] text-zinc-600">
          {data.activity_this_week} transaction{data.activity_this_week === 1 ? "" : "s"} this week
        </div>
      )}
      <p className="mt-2 text-center text-[11px] text-zinc-600">Your purchases bring businesses into the DUM Club network.</p>
    </div>
  );
}

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

      {/* Network Impact */}
      <NetworkImpact privyId={user?.privyId} />

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

      {/* Buy Points (Stripe) — HIDDEN in Phase 0A.
          The full purchase flow is gated on a written legal review of
          selling a utility token to US consumers via Stripe (money
          transmission, stored-value-card rules, state-by-state prepaid
          card regulations, SEC investment-contract risk). See BACKLOG.md
          and Master Playbook Phase 3C. The UI panel below is a passive
          notice; the underlying /api/dum/purchase endpoint and the
          purchaseSuccess / purchaseError / purchasing state are still
          mounted so a future re-enable is one PR, not a rebuild. */}
      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">DUM Points</div>
        <p className="text-[13px] leading-relaxed text-zinc-400">
          Points are earned through purchases.{" "}
          <span className="text-zinc-500">Purchased top-ups coming soon.</span>
        </p>
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
  const [tab, setTab] = useState<"balance" | "claim" | "refer">("balance");
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
          <p className="mt-2 text-sm text-zinc-500">Balance · Claim · Refer</p>
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
            { id: "balance" as const, label: "Balance", icon: "◆" },
            { id: "claim" as const, label: "Claim", icon: "⬇" },
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
        {tab === "balance" && (
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
