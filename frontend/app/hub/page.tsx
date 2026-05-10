"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { TIERS, getTier, getNextTier } from "../../lib/dumTiers";

import dynamic from "next/dynamic";

// Solana code-split (Phase 14, CLAUDE.md §12 Rule 3): the on-chain
// claim UI lives in ./SolanaAdvanced and only ships to the browser
// when the user actually opens the claim tab. Keeps @privy-io/
// react-auth/solana + @solana/web3.js out of the default /hub
// bundle. ssr: false because the SDK initialises against window.
const SolanaAdvanced = dynamic(
  () => import("./SolanaAdvanced").then((m) => m.SolanaAdvanced),
  { ssr: false, loading: () => null },
);

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
  swap_buy: "Advanced · on-chain claim",
  swap_sell: "Advanced · on-chain swap",
  demo_swap: "Advanced · demo swap",
  claim: "Advanced · on-chain claim",
  referral_bonus: "Referral reward",
  referral_welcome: "Welcome bonus",
};

// Transaction reasons that are power-user-only (on-chain / wallet flows).
// Hidden from RecentActivity by default; surfaced when the Advanced toggle
// is expanded. Kept in one place so any new on-chain reason gets gated
// automatically if it's added here.
const ADVANCED_REASONS = new Set(["claim", "swap_buy", "swap_sell", "demo_swap"]);

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
    <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Your Impact</div>
      <div className={`grid gap-3 ${stats.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : stats.length === 3 ? "grid-cols-3" : stats.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-default bg-surface-muted p-3 text-center">
            <div className="text-xl font-black text-white">{s.value}</div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-secondary">{s.label}</div>
          </div>
        ))}
      </div>
      {data.activity_this_week > 0 && (
        <div className="mt-3 text-center text-[10px] text-muted">
          {data.activity_this_week} transaction{data.activity_this_week === 1 ? "" : "s"} this week
        </div>
      )}
      <p className="mt-2 text-center text-[11px] text-muted">Your purchases bring businesses into the DUM Club network.</p>
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
      <div className="mb-6 rounded-2xl border border-default bg-gradient-to-r from-brand-teal-soft to-surface-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal/60">Your DUM Balance</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl font-black text-white">{displayBalance.toLocaleString()}</span>
              <span className="text-lg text-secondary">points</span>
              {deltaAccent !== null && deltaAccent > 0 && (
                <span className="animate-pulse font-mono text-sm font-bold text-sky-400">+{deltaAccent.toLocaleString()}</span>
              )}
            </div>
            <div className="mt-1 text-[10px] text-muted">
              Worth ${(displayBalance * 0.1).toFixed(2)} in discounts at participating merchants · 1 DUM = $0.10
            </div>
            {hubClaimable > 0 && (
              <button onClick={onNavigateClaim} className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-brand-teal transition hover:text-brand-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />
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
              <span className="text-secondary">Progress to {next.name}</span>
              <span className="font-mono text-secondary">{balance} / {next.min}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: next.color }} />
            </div>
          </div>
        )}
      </div>

      {/* Network Impact */}
      <NetworkImpact privyId={user?.privyId} />

      {/* How to Earn */}
      <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">How to Earn</div>
        <div className="space-y-3">
          {[
            { icon: "🛒", points: "+2", label: "Every purchase you make" },
            { icon: "🏪", points: "+25", label: "Every storefront you launch" },
            { icon: "📦", points: "+5", label: "Every product or service you list" },
            { icon: "🔁", points: "+2", label: "When customers buy from your business" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-4">
              <span className="text-lg">{item.icon}</span>
              <span className="w-10 text-right font-mono text-sm font-bold text-brand-teal">{item.points}</span>
              <span className="text-sm text-secondary">{item.label}</span>
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
      <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">DUM Points</div>
        <p className="text-[13px] leading-relaxed text-secondary">
          Points are earned through purchases.{" "}
          <span className="text-secondary">Purchased top-ups coming soon.</span>
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
    <div className="mb-6 rounded-2xl border border-default bg-surface-card p-5">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Purchase History</div>
      <div className="space-y-2">
        {purchases.map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold text-sky-400">+{p.amount}</span>
              <span className="text-[11px] text-secondary">Purchased via Stripe</span>
            </div>
            <span className="text-[10px] text-muted">{p.created_at ? formatTimeAgo(p.created_at) : ""}</span>
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
  // Phase 0A: on-chain / wallet-flavored rows are hidden by default. Power
  // users can expand the Advanced toggle at the bottom of the list to see
  // claim/swap history + the View-on-Explorer links. Data is untouched;
  // this is purely a rendering filter.
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  // First filter by the row filter (all/earned/spent/purchased).
  const byRowFilter = txns.filter((tx) => {
    if (filter === "earned") return tx.amount > 0 && !["swap_buy", "stripe_purchase", "demo_swap"].includes(tx.reason);
    if (filter === "spent") return tx.amount < 0;
    if (filter === "purchased") return ["swap_buy", "stripe_purchase", "demo_swap"].includes(tx.reason);
    return true;
  });

  // Then gate advanced (on-chain / wallet) reasons behind the toggle.
  // Default view = merchant-credit semantics only. Advanced toggle brings
  // the wallet / claim / explorer surface back.
  const visible = byRowFilter.filter((tx) => showAdvanced || !ADVANCED_REASONS.has(tx.reason));
  const hiddenAdvancedCount = byRowFilter.length - visible.length;

  return (
    <div className="mb-6 rounded-2xl border border-default bg-surface-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Activity</div>
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
                  ? "bg-brand-teal-soft text-brand-teal"
                  : "text-muted hover:text-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="py-4 text-center text-xs text-muted">Loading...</div>
      ) : visible.length === 0 && hiddenAdvancedCount === 0 ? (
        <div className="py-4 text-center text-xs text-muted">
          {filter === "all" ? "No activity yet. Earn DUM Points by creating businesses and making purchases." : `No ${filter} activity yet.`}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.slice(0, 15).map((tx) => (
            <div key={tx.id} className="rounded-xl bg-surface-muted px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold ${tx.amount > 0 ? "text-brand-teal" : "text-state-live"}`}>
                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                  </span>
                  <div>
                    <span className="text-[12px] text-primary">{REASON_LABELS[tx.reason] || tx.reason}</span>
                    <span className="ml-2 rounded-full bg-brand-teal/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-brand-teal/50">confirmed</span>
                  </div>
                </div>
                <span className="text-[10px] text-muted">{tx.created_at ? formatTimeAgo(tx.created_at) : ""}</span>
              </div>
              {/* Explorer link only renders when Advanced is expanded.
                  Since the row itself is advanced-gated, this is belt-and-
                  suspenders — if showAdvanced is false, the row won't
                  render at all and this block never runs. */}
              {showAdvanced && (tx.reason === "swap_buy" || tx.reason === "claim") && tx.reference_id && tx.reference_id.length > 30 && (
                <a
                  href={`https://explorer.solana.com/tx/${tx.reference_id}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[9px] text-brand-teal/50 transition hover:text-brand-teal"
                >
                  View on Explorer → <span className="font-mono text-muted">{tx.reference_id.slice(0, 8)}...{tx.reference_id.slice(-4)}</span>
                </a>
              )}
              {tx.reason === "stripe_purchase" && (
                <div className="mt-1 text-[9px] text-sky-400/50">💳 Stripe purchase · Instant</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Advanced toggle — reveals on-chain / wallet / claim / swap rows.
          Phase 0A: hidden by default. Phase 3A may redesign this once the
          full /hub consumer rewrite ships. */}
      {hiddenAdvancedCount > 0 && !showAdvanced && (
        <button
          type="button"
          onClick={() => setShowAdvanced(true)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-default bg-surface-muted px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted transition hover:border-default hover:text-secondary"
        >
          <span>Advanced</span>
          <span>▸</span>
          <span className="font-mono text-muted">{hiddenAdvancedCount}</span>
        </button>
      )}
      {showAdvanced && (
        <button
          type="button"
          onClick={() => setShowAdvanced(false)}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-default bg-surface-muted px-3 py-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted transition hover:border-default hover:text-secondary"
        >
          <span>Hide advanced</span>
          <span>▾</span>
        </button>
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
    return <div className="text-center text-sm text-secondary py-12">Loading referral info...</div>;
  }

  const referralUrl = referral
    ? `${typeof window !== "undefined" ? window.location.origin : "https://dum-club.vercel.app"}?ref=${referral.code}`
    : "";

  return (
    <div className="space-y-6">
      {/* Referral link */}
      <div className="rounded-2xl border border-default bg-gradient-to-r from-brand-teal-soft to-surface-card p-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal/60">Your Referral Link</div>
        <p className="mt-2 text-sm text-secondary">Share your link. When someone signs up, you both earn DUM Points.</p>

        {referral && (
          <>
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 truncate rounded-xl border border-default bg-surface-page px-3 py-2.5 font-mono text-sm text-primary">
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
                    ? "bg-brand-teal-soft text-brand-teal border border-default"
                    : "bg-brand-teal text-black hover:bg-brand-teal-hover"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-default py-2.5 text-xs font-semibold text-primary transition hover:border-strong hover:text-primary"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-default py-2.5 text-xs font-semibold text-primary transition hover:border-strong hover:text-primary"
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
          <div className="rounded-xl border border-default bg-surface-card p-4 text-center">
            <div className="text-2xl font-black text-white">{referral.clicks}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-secondary">Clicks</div>
          </div>
          <div className="rounded-xl border border-default bg-surface-card p-4 text-center">
            <div className="text-2xl font-black text-white">{referral.signups}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-secondary">Signups</div>
          </div>
          <div className="rounded-xl border border-default bg-brand-teal/5 p-4 text-center">
            <div className="text-2xl font-black text-brand-teal">{referral.points_earned}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-brand-teal/60">DUM Earned</div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-2xl border border-default bg-surface-card p-5">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">How It Works</div>
        <div className="space-y-3">
          {[
            { step: "1", text: "Share your link with friends or on social media" },
            { step: "2", text: "They sign up using your link" },
            { step: "3", text: "You earn 25 DUM Points, they get 10 welcome points" },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-teal-soft text-[11px] font-bold text-brand-teal">
                {s.step}
              </span>
              <span className="text-sm text-primary">{s.text}</span>
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
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-surface-page px-4 text-white">
        <div className="relative z-10 max-w-md text-center">
          <div className="mb-4 text-4xl">◆</div>
          <h1 className="text-2xl font-black tracking-tight">DUM Hub</h1>
          <p className="mt-3 text-sm text-secondary">Sign in to view your points, claim rewards, and save at checkout.</p>
          <button onClick={() => login()} className="mt-6 w-full rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover">
            Sign In to Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-surface-page text-primary">
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-16">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-brand-teal/60">DUM Hub · Your Local Rewards Balance</div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">DUM Hub</h1>
          <p className="mt-2 text-sm text-secondary">Earn at one merchant, spend at another</p>
        </div>

        {/* How DUM works — explainer strip */}
        <div className="mb-6 grid grid-cols-3 gap-2 text-center">
          {[
            { step: "1", label: "Earn", desc: "Get DUM Points from purchases and businesses" },
            { step: "2", label: "Spend", desc: "Use your balance for discounts at participating merchants" },
            { step: "3", label: "Return", desc: "Every shop on the network accepts your points" },
          ].map((s) => (
            <div key={s.step} className="rounded-xl border border-default bg-surface-card px-2 py-3">
              <div className="text-[9px] font-bold text-brand-teal/50">{s.step}</div>
              <div className="text-xs font-bold text-white">{s.label}</div>
              <div className="mt-1 text-[9px] leading-tight text-muted">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="mb-8 flex items-center gap-1 overflow-x-auto rounded-xl border border-default bg-surface-card p-1 max-w-lg mx-auto">
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
                  ? "bg-brand-teal-soft text-brand-teal border border-default"
                  : "text-secondary border border-transparent hover:text-primary"
              }`}
            >
              <span>{t.icon}</span>
              {t.label}
              {t.id === "claim" && hubClaimable > 0 && (
                <span className="ml-0.5 min-w-[16px] rounded-full bg-brand-teal-soft px-1 py-0.5 text-center text-[8px] font-bold leading-none text-brand-teal">
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
        {tab === "claim" && <SolanaAdvanced balance={balance} onBalanceUpdate={setBalance} />}
        {tab === "refer" && <ReferTab getToken={getToken} />}

        {/* Bottom CTAs */}
        <p className="mt-8 text-center text-[11px] text-muted">Earn when you sell. Earn when you buy.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Link href="/build" className="flex flex-1 items-center justify-center rounded-xl bg-brand-teal px-6 py-3.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover">
            Start Selling →
          </Link>
          <Link href="/discover" className="flex flex-1 items-center justify-center rounded-xl border border-default px-6 py-3.5 text-sm text-primary transition hover:border-strong hover:text-primary">
            Browse the Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
