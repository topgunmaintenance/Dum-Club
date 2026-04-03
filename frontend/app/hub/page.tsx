"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  for (const t of TIERS) {
    if (pts < t.min) return t;
  }
  return null;
}

const REASON_LABELS: Record<string, string> = {
  purchase_reward: "Purchase reward",
  launch_bonus: "Business created",
  offer_created: "Offer added",
  discount_spend: "Discount used",
  stripe_purchase: "Points purchased",
  discount: "Discount applied",
};

function RecentActivity({ privyId }: { privyId?: string }) {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!privyId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/dum/transactions/${privyId}`)
      .then((r) => r.json())
      .then((d) => setTxns(d.transactions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [privyId]);

  if (!privyId) return null;

  return (
    <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        Recent Activity
      </div>
      {loading ? (
        <div className="py-4 text-center text-xs text-zinc-600">Loading...</div>
      ) : txns.length === 0 ? (
        <div className="py-4 text-center text-xs text-zinc-600">
          No activity yet. Earn DUM Points by creating businesses and making purchases.
        </div>
      ) : (
        <div className="space-y-2">
          {txns.slice(0, 10).map((tx) => {
            const isEarn = tx.amount > 0;
            const ago = tx.created_at ? formatTimeAgo(tx.created_at) : "";
            return (
              <div key={tx.id} className="flex items-center justify-between rounded-xl bg-zinc-900/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold ${isEarn ? "text-emerald-400" : "text-red-400"}`}>
                    {isEarn ? "+" : ""}{tx.amount}
                  </span>
                  <span className="text-[12px] text-zinc-400">
                    {REASON_LABELS[tx.reason] || tx.reason}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-600">{ago}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function HubPage() {
  const { user, login, getToken } = useAuth();
  const [balance, setBalance] = useState(0);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);

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
      // Refresh balance from backend after webhook processes
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
      // Poll a few times to catch webhook processing delay
      setTimeout(refreshBalance, 1000);
      setTimeout(refreshBalance, 3000);
      setTimeout(refreshBalance, 7000);
      // Clean URL
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
          <p className="mt-3 text-sm text-zinc-400">
            Sign in to view your DUM Points balance, earn rewards, and unlock discounts across DUM Club.
          </p>
          <button
            onClick={() => login()}
            className="mt-6 w-full rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300"
          >
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
        <div className="mb-10 text-center">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/60">
            DUM Hub · Powered by Solana
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Your DUM Points
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Earn rewards. Unlock discounts. Use them at any business on DUM Club.
          </p>
        </div>

        {/* ── SECTION 1: Balance ── */}
        <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">
                Balance
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-black text-white">{balance}</span>
                <span className="text-lg text-zinc-500">points</span>
              </div>
            </div>
            <div className="text-right">
              <div
                className="rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em]"
                style={{ borderColor: tier.color, color: tier.color }}
              >
                {tier.name}
              </div>
            </div>
          </div>

          {/* Tier progress */}
          {next && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-[10px]">
                <span className="text-zinc-500">Progress to {next.name}</span>
                <span className="font-mono text-zinc-400">{balance} / {next.min}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%`, background: next.color }}
                />
              </div>
            </div>
          )}
          {!next && (
            <div className="mt-4 text-[11px] text-emerald-400/70">
              ✓ Maximum tier reached
            </div>
          )}
        </div>

        {/* ── SECTION 2: How to Earn ── */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            How to Earn
          </div>
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
          <Link
            href="/discover"
            className="mt-5 flex w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-[12px] font-bold text-zinc-300 transition hover:border-emerald-400/20 hover:text-emerald-400"
          >
            Browse businesses to start earning →
          </Link>
        </div>

        {/* ── SECTION 2.5: Add Points ── */}
        <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">
            Add DUM Points
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { id: "tier_100", points: 100, price: "$10", bonus: null },
              { id: "tier_275", points: 275, price: "$25", bonus: "10% bonus", best: true },
              { id: "tier_600", points: 600, price: "$50", bonus: "20% bonus" },
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
                      body: JSON.stringify({
                        tier_id: t.id,
                        success_url: window.location.origin + "/hub",
                        cancel_url: window.location.origin + "/hub",
                      }),
                    });
                    if (!res.ok) {
                      const err = await res.json().catch(() => ({}));
                      setPurchaseError(err.detail || "Purchase failed");
                      setPurchasing(null);
                      return;
                    }
                    const data = await res.json();
                    if (data.checkout_url) {
                      window.location.href = data.checkout_url;
                    }
                  } catch {
                    setPurchaseError("Network error");
                    setPurchasing(null);
                  }
                }}
                disabled={!!purchasing}
                className={`relative rounded-xl border p-5 text-center transition hover:-translate-y-1 ${
                  t.best
                    ? "border-emerald-400/30 bg-emerald-400/[0.06] shadow-[0_0_16px_rgba(0,255,163,0.06)]"
                    : "border-zinc-800 bg-zinc-900/50"
                } ${purchasing === t.id ? "opacity-60" : ""}`}
              >
                {t.best && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-400 px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-black">
                    Best Value
                  </div>
                )}
                <div className="mb-1 text-2xl font-black text-white">{t.points}</div>
                <div className="mb-2 text-[11px] text-zinc-500">points</div>
                <div className="text-lg font-bold text-emerald-400">{t.price}</div>
                {t.bonus && (
                  <div className="mt-1 text-[10px] font-semibold text-emerald-400/70">{t.bonus}</div>
                )}
                <div className="mt-3 rounded-lg bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold text-emerald-400">
                  {purchasing === t.id ? "Processing..." : "Add Points"}
                </div>
              </button>
            ))}
          </div>
          {purchaseError && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-400">
              {purchaseError}
            </div>
          )}
          {purchaseSuccess && (
            <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-2 text-xs text-emerald-300">
              ✓ Points added successfully!
            </div>
          )}
          <p className="mt-3 text-[10px] text-zinc-600 text-center">
            Secure checkout via Stripe · Points added instantly after payment
          </p>
        </div>

        {/* ── SECTION 3: How to Spend ── */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            How to Spend
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                %
              </div>
              <div>
                <div className="text-sm font-bold text-white">10% off any offer</div>
                <div className="text-[12px] text-zinc-500">Use 10 DUM Points at checkout for an instant 10% discount on any offer, at any business.</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                🌐
              </div>
              <div>
                <div className="text-sm font-bold text-white">Works everywhere</div>
                <div className="text-[12px] text-zinc-500">DUM Points are not tied to one business. Earn at any storefront, spend at any storefront.</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                ⬆
              </div>
              <div>
                <div className="text-sm font-bold text-white">Higher tiers, more perks</div>
                <div className="text-[12px] text-zinc-500">As your points grow, you unlock higher tiers with priority placement, more AI access, and exclusive features.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <RecentActivity privyId={user?.privyId} />

        {/* ── Tiers overview ── */}
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Tiers
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIERS.map((t) => {
              const active = tier.name === t.name;
              return (
                <div
                  key={t.name}
                  className={`rounded-xl border p-4 text-center transition ${
                    active
                      ? "border-emerald-400/30 bg-emerald-400/[0.04]"
                      : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <div
                    className="mb-1 text-lg font-black"
                    style={{ color: active ? t.color : "#555" }}
                  >
                    {t.min === 0 ? "0" : t.min.toLocaleString()}+
                  </div>
                  <div
                    className="text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: active ? t.color : "#666" }}
                  >
                    {t.name}
                  </div>
                  {active && (
                    <div className="mt-1 text-[9px] text-emerald-400/60">Current</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Wallet Connection ── */}
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Solana Wallet
          </div>
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-sm font-medium text-emerald-400">Connected via Privy</span>
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            Your Solana wallet is automatically created and managed. DUM Points are tracked on-platform with Solana verification available.
          </p>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-700">
            <span>Powered by Solana</span>
            <span>·</span>
            <span>Stripe payments</span>
            <span>·</span>
            <span>SOL/USDC coming soon</span>
          </div>
        </div>

        {/* ── CTAs ── */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/build"
            className="flex flex-1 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
          >
            Start Selling →
          </Link>
          <Link
            href="/discover"
            className="flex flex-1 items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            Browse Businesses
          </Link>
        </div>
      </div>
    </div>
  );
}
