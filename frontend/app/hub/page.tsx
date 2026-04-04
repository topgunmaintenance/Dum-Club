"use client";

import { useEffect, useMemo, useState } from "react";
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
};

/* ════════════════════════════════════════════════════════════════
   POINTS TAB
   ════════════════════════════════════════════════════════════════ */
function PointsTab({
  balance, tier, next, progressPct, user, getToken,
  purchasing, setPurchasing, purchaseError, setPurchaseError, purchaseSuccess,
}: any) {
  return (
    <>
      {/* Balance */}
      <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Balance</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black text-white">{balance}</span>
              <span className="text-lg text-zinc-500">points</span>
            </div>
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
            { icon: "🏪", points: "+25", label: "Every business you create" },
            { icon: "📦", points: "+5", label: "Every offer you add to your storefront" },
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

      {/* Add Points (Stripe) */}
      <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">Add DUM Points</div>
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
              className={`relative rounded-xl border p-5 text-center transition hover:-translate-y-1 ${t.best ? "border-emerald-400/30 bg-emerald-400/[0.06] shadow-[0_0_16px_rgba(0,255,163,0.06)]" : "border-zinc-800 bg-zinc-900/50"} ${purchasing === t.id ? "opacity-60" : ""}`}
            >
              {t.best && <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-400 px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-black">Best Value</div>}
              <div className="mb-1 text-2xl font-black text-white">{t.points}</div>
              <div className="mb-2 text-[11px] text-zinc-500">points</div>
              <div className="text-lg font-bold text-emerald-400">{t.price}</div>
              {t.bonus && <div className="mt-1 text-[10px] font-semibold text-emerald-400/70">{t.bonus}</div>}
              <div className="mt-3 rounded-lg bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold text-emerald-400">
                {purchasing === t.id ? "Processing..." : "Add Points"}
              </div>
            </button>
          ))}
        </div>
        {purchaseError && <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">{purchaseError}</div>}
        {purchaseSuccess && <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-2 text-xs text-emerald-300">✓ Points added successfully!</div>}
        <p className="mt-3 text-center text-[10px] text-zinc-600">Secure checkout via Stripe · Points added instantly after payment</p>
      </div>

      {/* How to Spend */}
      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">How to Spend</div>
        <div className="space-y-4">
          {[
            { icon: "%", title: "10% off any offer", desc: "Use 10 DUM Points at checkout for an instant 10% discount on any offer, at any business." },
            { icon: "🌐", title: "Works everywhere", desc: "DUM Points are not tied to one business. Earn at any storefront, spend at any storefront." },
            { icon: "⬆", title: "Higher tiers, more perks", desc: "As your points grow, you unlock higher tiers with priority placement, more AI access, and exclusive features." },
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

      {/* Recent Activity */}
      <RecentActivity />

      {/* Tiers */}
      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Tiers</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIERS.map((t) => {
            const active = tier.name === t.name;
            return (
              <div key={t.name} className={`rounded-xl border p-4 text-center transition ${active ? "border-emerald-400/30 bg-emerald-400/[0.04]" : "border-zinc-800 bg-zinc-900/30"}`}>
                <div className="mb-1 text-lg font-black" style={{ color: active ? t.color : "#555" }}>{t.min === 0 ? "0" : t.min.toLocaleString()}+</div>
                <div className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: active ? t.color : "#666" }}>{t.name}</div>
                {active && <div className="mt-1 text-[9px] text-emerald-400/60">Current</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   RECENT ACTIVITY (shared)
   ════════════════════════════════════════════════════════════════ */
function RecentActivity() {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "earned" | "spent" | "swaps">("all");
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
    if (filter === "earned") return tx.amount > 0 && tx.reason !== "swap_buy";
    if (filter === "spent") return tx.amount < 0;
    if (filter === "swaps") return tx.reason === "swap_buy" || tx.reason === "swap_sell";
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
            { id: "swaps" as const, label: "Swaps" },
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
              {tx.reason === "swap_buy" && tx.reference_id && tx.reference_id.length > 30 && (
                <a
                  href={`https://explorer.solana.com/tx/${tx.reference_id}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[9px] text-emerald-400/50 transition hover:text-emerald-400"
                >
                  View on Solana Explorer → <span className="font-mono text-zinc-700">{tx.reference_id.slice(0, 8)}...{tx.reference_id.slice(-4)}</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SWAP TAB
   ════════════════════════════════════════════════════════════════ */
function SwapTab({ balance, onBalanceUpdate }: { balance: number; onBalanceUpdate: (b: number) => void }) {
  const { wallets: privyWallets, createWallet } = useSolanaWallets();
  const privyWallet = privyWallets[0] || null;
  const walletAddress = privyWallet?.address || null;
  const { getToken } = useAuth();
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [solRate] = useState(1000);
  const [swapState, setSwapState] = useState<"idle" | "signing" | "verifying" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapResult, setSwapResult] = useState<{ dum: number; sol: number; sig: string } | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  // Auto-create wallet if user is logged in but has no wallet
  useEffect(() => {
    if (user && !privyWallet) {
      createWallet().catch(() => {});
    }
  }, [user, privyWallet]);

  // Fetch SOL balance using RPC directly
  useEffect(() => {
    if (!walletAddress) { setSolBalance(null); return; }
    const conn = new Connection(SOLANA_RPC);
    conn.getBalance(new PublicKey(walletAddress)).then((b) => setSolBalance(b / LAMPORTS_PER_SOL)).catch(() => setSolBalance(null));
  }, [walletAddress]);

  const MIN_SOL = 0.01;
  const MAX_SOL = 5;

  const numAmount = Number(amount) || 0;
  const dumAmount = numAmount * solRate;

  // Validation helpers
  const isBelowMin = numAmount > 0 && numAmount < MIN_SOL;
  const isAboveMax = numAmount > MAX_SOL;
  const isInsufficientSol = solBalance !== null && numAmount > solBalance;
  const canSwap = numAmount >= MIN_SOL && numAmount <= MAX_SOL && !isInsufficientSol && !!walletAddress && swapState === "idle";

  async function handleSwap() {
    if (!walletAddress || !privyWallet || !canSwap) return;

    if (!DUM_TREASURY) {
      setSwapError("Treasury wallet not configured. Contact support.");
      setSwapState("error");
      return;
    }

    setSwapState("signing");
    setSwapError(null);
    setSwapResult(null);

    try {
      // 1. Build SOL transfer transaction
      const conn = new Connection(SOLANA_RPC);
      const fromPubkey = new PublicKey(walletAddress);
      const treasury = new PublicKey(DUM_TREASURY);
      const lamports = Math.floor(numAmount * LAMPORTS_PER_SOL);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey: treasury,
          lamports,
        })
      );
      tx.feePayer = fromPubkey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

      // 2. Send via Privy embedded wallet
      //    Privy wallets use sendTransaction (signs + sends internally)
      //    signTransaction throws "Recovery method not supported" on embedded wallets
      console.log("[swap] sending transaction via Privy wallet...");
      let sig: string;
      try {
        const txSig = await privyWallet.sendTransaction(tx, conn);
        sig = typeof txSig === "string" ? txSig : (txSig as any)?.signature || String(txSig);
        console.log("[swap] transaction sent, sig:", sig);
      } catch (sendErr: any) {
        console.error("[swap] sendTransaction error:", sendErr);
        throw new Error(sendErr?.message || "Wallet transaction failed. Please try again.");
      }
      setSwapState("verifying");

      // 3. Wait for confirmation
      await conn.confirmTransaction(sig, "confirmed");

      // 4. Send signature to backend for verification + DUM award
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/dum/swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          sol_amount: numAmount,
          tx_signature: sig,
          wallet_address: walletAddress,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Swap failed (${res.status})`);
      }

      const data = await res.json();

      // 5. Update balance everywhere
      const newBal = data.new_balance || balance + (data.dum_received || 0);
      localStorage.setItem("dum_points", String(newBal));
      window.dispatchEvent(new Event("dum-points-update"));
      onBalanceUpdate(newBal);

      setSwapResult({ dum: data.dum_received, sol: numAmount, sig });
      setSwapState("success");
      setAmount("");
    } catch (err: any) {
      console.error("[swap] error:", err);
      const msg = err?.message || "Swap failed";
      // User rejected = not an error, just reset
      if (msg.includes("User rejected") || msg.includes("cancelled") || msg.includes("user denied") || msg.includes("User denied")) {
        setSwapState("idle");
        return;
      }
      // Privy-specific errors — make user-friendly
      const friendlyMsg = msg.includes("Recovery method")
        ? "Wallet transaction failed. Please try again."
        : msg.includes("blockhash")
        ? "Solana network is busy. Please try again in a moment."
        : msg.includes("insufficient")
        ? "Insufficient SOL balance for this transaction."
        : msg.includes("CORS") || msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("ERR_FAILED")
        ? "Could not reach the server. Please try again."
        : msg.includes("timeout") || msg.includes("Timeout")
        ? "Request timed out. Please try again."
        : msg;
      setSwapError(friendlyMsg);
      setSwapState("error");
    } finally {
      // Safety net: if state is still signing/verifying after 60s, force reset
      setTimeout(() => {
        setSwapState((s) => (s === "signing" || s === "verifying") ? "error" : s);
        setSwapError((e) => e || "Swap timed out. Please try again.");
      }, 60000);
    }
  }

  const dumMint = process.env.NEXT_PUBLIC_DUM_MINT || process.env.NEXT_PUBLIC_DUM_MINT_ADDRESS || "";
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : "";

  return (
    <div className="mx-auto max-w-md">
      {/* ── Success panel (replaces form after swap) ── */}
      {swapState === "success" && swapResult ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.06] to-zinc-950 p-6 text-center">
            <div className="mb-3 text-3xl">✓</div>
            <div className="text-xl font-black text-white">DUM Added</div>
            <div className="mt-2 flex items-baseline justify-center gap-2">
              <span className="text-3xl font-black text-emerald-400">+{swapResult.dum.toLocaleString()}</span>
              <span className="text-sm text-zinc-400">DUM Points</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              from {swapResult.sol} SOL · verified on Solana
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-[10px] font-bold text-emerald-400">
              ✓ Balance updated instantly
            </div>
            {walletAddress && (
              <div className="mt-3 text-[10px] text-zinc-600">
                Wallet: <span className="font-mono text-zinc-400">{shortWallet}</span>
              </div>
            )}
          </div>

          {/* On-chain proof with copy buttons */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-3">On-chain proof</div>
            {swapResult.sig && (
              <div className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-4 py-3">
                <a
                  href={`https://explorer.solana.com/tx/${swapResult.sig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 transition hover:opacity-80"
                >
                  <div className="text-[12px] font-semibold text-white">Transaction</div>
                  <div className="mt-0.5 font-mono text-[9px] text-zinc-600">{swapResult.sig.slice(0, 12)}...{swapResult.sig.slice(-8)}</div>
                </a>
                <button onClick={() => copyToClipboard(swapResult.sig, "tx")} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-zinc-400 transition hover:border-emerald-400/30 hover:text-emerald-400">
                  {copied === "tx" ? "✓" : "Copy"}
                </button>
                <a href={`https://explorer.solana.com/tx/${swapResult.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-emerald-400/70 transition hover:text-emerald-400">
                  View →
                </a>
              </div>
            )}
            {dumMint && (
              <div className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-4 py-3">
                <a
                  href={`https://explorer.solana.com/address/${dumMint}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 transition hover:opacity-80"
                >
                  <div className="text-[12px] font-semibold text-white">DUM Token</div>
                  <div className="mt-0.5 font-mono text-[9px] text-zinc-600">{dumMint.slice(0, 12)}...{dumMint.slice(-8)}</div>
                </a>
                <button onClick={() => copyToClipboard(dumMint, "mint")} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-zinc-400 transition hover:border-emerald-400/30 hover:text-emerald-400">
                  {copied === "mint" ? "✓" : "Copy"}
                </button>
                <a href={`https://explorer.solana.com/address/${dumMint}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-emerald-400/70 transition hover:text-emerald-400">
                  View →
                </a>
              </div>
            )}
            {walletAddress && (
              <div className="flex items-center gap-2 rounded-xl bg-zinc-900/50 px-4 py-3">
                <a
                  href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 transition hover:opacity-80"
                >
                  <div className="text-[12px] font-semibold text-white">Wallet</div>
                  <div className="mt-0.5 font-mono text-[9px] text-zinc-600">{shortWallet}</div>
                </a>
                <button onClick={() => copyToClipboard(walletAddress, "wallet")} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-zinc-400 transition hover:border-emerald-400/30 hover:text-emerald-400">
                  {copied === "wallet" ? "✓" : "Copy"}
                </button>
                <a href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[9px] text-emerald-400/70 transition hover:text-emerald-400">
                  View →
                </a>
              </div>
            )}
          </div>

          <button
            onClick={() => { setSwapState("idle"); setSwapResult(null); setCopied(null); }}
            className="w-full rounded-xl border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-emerald-400/30 hover:text-white"
          >
            Add more DUM
          </button>
        </div>
      ) : (
        <>
          {/* ── Swap form ── */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Add DUM Points</div>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/60">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                {!walletAddress ? "Setting up wallet..." : "● Wallet ready"}
              </div>
            </div>

            {/* You Pay */}
            <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.15em] text-zinc-600">You pay</div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="any"
                  disabled={swapState !== "idle"}
                  className="flex-1 bg-transparent text-2xl font-bold text-white outline-none placeholder-zinc-700 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-300">SOL</div>
              </div>
              {solBalance !== null && (
                <div className="mt-2 text-[10px] text-zinc-600">{solBalance.toFixed(4)} SOL available</div>
              )}
            </div>

            {/* Arrow */}
            <div className="flex justify-center -my-1.5 relative z-10">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-emerald-400">↓</div>
            </div>

            {/* You Receive */}
            <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <div className="mb-2 text-[10px] uppercase tracking-[0.15em] text-zinc-600">You receive</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-2xl font-bold text-emerald-400">
                  {numAmount > 0 ? dumAmount.toLocaleString() : "0"}
                </div>
                <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-300">DUM</div>
              </div>
              <div className="mt-2 text-[10px] text-zinc-600">Current balance: {balance.toLocaleString()} DUM</div>
            </div>

            {/* Rate */}
            <div className="mt-4 flex items-center justify-between text-[10px] text-zinc-600">
              <span>1 SOL = {solRate.toLocaleString()} DUM</span>
              <span>Min {MIN_SOL} · Max {MAX_SOL} SOL</span>
            </div>

            {/* Validation */}
            {isBelowMin && <div className="mt-2 text-[10px] text-amber-400/80">Minimum is {MIN_SOL} SOL</div>}
            {isAboveMax && <div className="mt-2 text-[10px] text-amber-400/80">Maximum is {MAX_SOL} SOL per swap</div>}
            {isInsufficientSol && <div className="mt-2 text-[10px] text-red-400/80">Insufficient balance ({solBalance?.toFixed(4)} SOL available)</div>}

            {/* Swap button */}
            <button
              onClick={handleSwap}
              disabled={!canSwap}
              className="mt-4 w-full rounded-xl bg-emerald-400 px-6 py-4 text-sm font-bold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {swapState === "signing" ? "Swapping..." :
               swapState === "verifying" ? "Confirming on-chain..." :
               !walletAddress ? "Create wallet to swap" :
               isInsufficientSol ? "Insufficient SOL" :
               numAmount > 0 ? `Add ${dumAmount.toLocaleString()} DUM` : "Enter amount"}
            </button>

            {/* Error */}
            {swapState === "error" && swapError && (
              <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400">
                {swapError}
                <button onClick={() => setSwapState("idle")} className="ml-2 text-red-300 underline">Try again</button>
              </div>
            )}

            <div className="mt-3 text-center text-[10px] text-zinc-700">
              Powered by Solana · Verified on-chain · ~$0.001 fee
            </div>
          </div>

          {/* Single info row — no duplicate cards */}
          <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">⚡</span> Instant</span>
            <span className="text-zinc-800">·</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">🔒</span> Verified on-chain</span>
            <span className="text-zinc-800">·</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">◆</span> Solana SPL</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MARKET TAB
   ════════════════════════════════════════════════════════════════ */
function MarketTab() {
  const [market, setMarket] = useState<any>(null);
  const [swaps, setSwaps] = useState<any[]>([]);
  const [liveStats, setLiveStats] = useState<any>(null);
  const [chartRange, setChartRange] = useState<"24h" | "7d" | "30d">("7d");
  const [chartData, setChartData] = useState<{ time: string; volume: number; cumulative: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/dum/market`).then(r => r.json()).then(setMarket).catch(() => {});
    fetch(`${API_BASE}/api/dum/recent-swaps`).then(r => r.json()).then(d => setSwaps(d.swaps || [])).catch(() => {});
    fetch(`${API_BASE}/api/projects/live-stats`).then(r => r.json()).then(setLiveStats).catch(() => {});
  }, []);

  // Fetch chart data when range changes
  useEffect(() => {
    setChartLoading(true);
    fetch(`${API_BASE}/api/dum/price-history?range=${chartRange}`)
      .then(r => r.json())
      .then(d => setChartData(d.points || []))
      .catch(() => setChartData([]))
      .finally(() => setChartLoading(false));
  }, [chartRange]);

  // Calculate chart bar heights from real data
  const maxVol = Math.max(...chartData.map(p => p.cumulative), 1);
  const rangeLabels = { "24h": "24 hours ago", "7d": "7 days ago", "30d": "30 days ago" };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Price hero */}
      <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-400/10 text-2xl font-black text-emerald-400">◆</div>
          <div>
            <div className="text-xl font-black text-white">DUM</div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">Digital Utility Market</div>
          </div>
        </div>

        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-black text-white">${market?.price_usd?.toFixed(4) || "0.0100"}</span>
          <span className="text-sm font-bold text-emerald-400">platform rate</span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-zinc-800 pt-4">
          <div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Total Value</div>
            <div className="mt-1 font-mono text-sm font-bold text-white">${market?.market_cap_usd?.toLocaleString() || "—"}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">24h Activity</div>
            <div className="mt-1 font-mono text-sm font-bold text-emerald-400">{market?.volume_24h?.toLocaleString() || "0"} DUM</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Total Supply</div>
            <div className="mt-1 font-mono text-sm font-bold text-white">{market?.total_supply?.toLocaleString() || "—"}</div>
          </div>
        </div>
        {liveStats && (
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-zinc-800/50 pt-3">
            <div>
              <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Live Businesses</div>
              <div className="mt-1 font-mono text-sm font-bold text-white">{liveStats.live_projects || 0}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Active Offers</div>
              <div className="mt-1 font-mono text-sm font-bold text-white">{liveStats.active_offers || 0}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-[0.15em] text-zinc-600">Verified</div>
              <div className="mt-1 font-mono text-sm font-bold text-emerald-400">{liveStats.businesses || 0}</div>
            </div>
          </div>
        )}
      </div>

      {/* Activity Chart — real data */}
      <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">DUM Activity</div>
          <div className="flex gap-1">
            {(["24h", "7d", "30d"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setChartRange(r)}
                className={`rounded-md border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] transition ${
                  chartRange === r
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-emerald-400/20 hover:text-emerald-400"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {chartLoading ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">Loading...</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-zinc-600">No activity data for this range.</div>
        ) : (
          <>
            <div className="flex h-32 items-end gap-[2px]">
              {chartData.map((point, i) => {
                const h = maxVol > 0 ? Math.max((point.cumulative / maxVol) * 100, 2) : 2;
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-gradient-to-t from-emerald-400/30 to-emerald-400/5 transition-all duration-300"
                    style={{ height: `${h}%` }}
                    title={`${point.volume} DUM · ${new Date(point.time).toLocaleDateString()}`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-zinc-700">
              <span>{rangeLabels[chartRange]}</span>
              <span>Now</span>
            </div>
          </>
        )}
      </div>

      {/* DUM info */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center">
          <div className="text-lg">🔗</div>
          <div className="mt-2 text-sm font-bold text-white">Solana SPL</div>
          <div className="mt-1 text-[10px] text-zinc-600">Built on Solana blockchain</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center">
          <div className="text-lg">💳</div>
          <div className="mt-2 text-sm font-bold text-white">Stripe + SOL</div>
          <div className="mt-1 text-[10px] text-zinc-600">Add points with card or crypto</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center">
          <div className="text-lg">🏪</div>
          <div className="mt-2 text-sm font-bold text-white">Real utility</div>
          <div className="mt-1 text-[10px] text-zinc-600">Discounts at every business</div>
        </div>
      </div>

      {/* Recent platform activity */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Recent Swaps</div>
        {swaps.length === 0 ? (
          <div className="py-4 text-center text-xs text-zinc-600">No activity yet.</div>
        ) : (
          <div className="space-y-2">
            {swaps.slice(0, 10).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl bg-zinc-900/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold ${s.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {s.amount > 0 ? "+" : ""}{s.amount} DUM
                  </span>
                  <span className="text-[12px] text-zinc-400">{REASON_LABELS[s.reason] || s.reason}</span>
                </div>
                <span className="text-[10px] text-zinc-600">{s.created_at ? formatTimeAgo(s.created_at) : ""}</span>
              </div>
            ))}
          </div>
        )}
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
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [tab, setTab] = useState<"points" | "swap" | "market">("points");

  useEffect(() => {
    const read = () => setBalance(Number(localStorage.getItem("dum_points") || "0"));
    read();
    window.addEventListener("dum-points-update", read);
    return () => window.removeEventListener("dum-points-update", read);
  }, []);

  // Detect successful purchase return from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dum_purchase") === "success") {
      setPurchaseSuccess(true);
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
          }
        } catch {}
      };
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
          <p className="mt-3 text-sm text-zinc-400">Sign in to view your DUM Points, swap tokens, and unlock discounts across DUM Club.</p>
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
          <p className="mt-2 text-sm text-zinc-500">Points · Swap · Market</p>
        </div>

        {/* Tab bar */}
        <div className="mb-8 flex items-center justify-center gap-1 rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-1 max-w-sm mx-auto">
          {[
            { id: "points" as const, label: "Points", icon: "◆" },
            { id: "swap" as const, label: "Swap", icon: "⇄" },
            { id: "market" as const, label: "Market", icon: "📊" },
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
          />
        )}
        {tab === "swap" && <SwapTab balance={balance} onBalanceUpdate={setBalance} />}
        {tab === "market" && <MarketTab />}

        {/* Bottom CTAs */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/build" className="flex flex-1 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300">
            Start Selling →
          </Link>
          <Link href="/discover" className="flex flex-1 items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white">
            Browse Businesses
          </Link>
        </div>
      </div>
    </div>
  );
}
