"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth/AuthContext";
import { API_BASE } from "../lib/apiBase";

// Pages where the pill is hidden (already show points prominently)
const HIDDEN_PATHS = ["/dashboard", "/hub", "/project"];

export function DumPill() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [balance, setBalance] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Fetch balance from API (single source of truth), then listen for updates
  useEffect(() => {
    const read = () => {
      const pts = Number(localStorage.getItem("dum_points") || "0");
      setBalance(pts);
    };

    // Try backend first, same as Navbar
    async function loadBalance() {
      const privyId = user?.privyId;
      if (privyId) {
        try {
          const res = await fetch(`${API_BASE}/api/dum/balance/${encodeURIComponent(privyId)}`);
          if (res.ok) {
            const data = await res.json();
            const val = data.balance ?? 0;
            setBalance(val);
            localStorage.setItem("dum_points", String(val));
            return;
          }
        } catch {}
      }
      // Fallback: localStorage (no hardcoded default)
      read();
    }
    loadBalance();

    window.addEventListener("dum-points-update", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("dum-points-update", read);
      window.removeEventListener("storage", read);
    };
  }, [user]);

  // Hide for logged-out users
  if (!user) return null;

  // Hide on specific pages
  if (HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  return (
    <>
      {/* Backdrop when expanded */}
      {expanded && (
        <div
          className="fixed inset-0 z-[90]"
          onClick={() => setExpanded(false)}
        />
      )}

      {/* bottom-24 on mobile clears the fixed BottomTabNav (h-16 + safe area);
          drops to bottom-4 on lg where there's no bottom nav. */}
      <div className="fixed bottom-24 right-4 z-[100] lg:bottom-4">
        {/* Expanded panel */}
        {expanded && (
          <div className="mb-2 w-64 rounded-2xl border border-default bg-surface-card p-5 shadow-[0_16px_48px_rgba(11,18,32,0.18)] backdrop-blur-md">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-mint-text">
                DUM Points
              </span>
              <span className="rounded-full bg-mint-card px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.15em] text-mint-text">
                Beta
              </span>
            </div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-primary">{balance}</span>
              <span className="text-sm text-secondary">points</span>
            </div>
            {/* Human conversion line — Phase 0A. The whole point of this
                pill is to make the unit obvious to a non-crypto user. */}
            <div className="mb-3 text-[11px] leading-snug text-secondary">
              1 DUM = $0.10 · use for discounts at participating businesses
            </div>

            <div className="space-y-2.5 border-t border-default pt-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-mint-text text-xs">+2</span>
                <span className="text-[12px] text-primary">Earn with every purchase</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-mint-text text-xs">10%</span>
                <span className="text-[12px] text-primary">Off any offer with 10 points</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-secondary text-xs">◆</span>
                <span className="text-[12px] text-secondary">Soon: spend across every DUM Club business</span>
              </div>
            </div>

            {/* Beta status — earning is live, but cross-business redemption is
                a Phase 2 feature (CLAUDE.md §5), so be clear it's not usable
                elsewhere yet. */}
            <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[11px] leading-snug text-secondary">
              Beta: you&apos;re earning points now. Spending them at other businesses is coming soon.
            </p>

            <Link
              href="/hub"
              onClick={() => setExpanded(false)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-default bg-mint-card px-4 py-2.5 text-[12px] font-bold text-mint-text transition hover:bg-mint-fill hover:text-white"
            >
              View DUM Hub →
            </Link>
          </div>
        )}

        {/* Collapsed pill — native title attribute gives a hover tooltip
            without needing JS or a new dependency. */}
        <button
          onClick={() => setExpanded(!expanded)}
          title="DUM Points (beta) · 1 DUM = $0.10 · spending across businesses is coming soon"
          aria-label={`${balance} DUM Points, beta · 1 DUM = $0.10 · spending across businesses is coming soon`}
          className="flex items-center gap-2 rounded-full border border-default bg-surface-card px-4 py-2.5 shadow-[0_8px_24px_rgba(11,18,32,0.12)] backdrop-blur-md transition-all duration-200 hover:border-mint-text hover:shadow-[0_8px_32px_rgba(11,18,32,0.18)]"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-fill opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-mint-fill" />
          </span>
          <span className="font-mono text-[12px] font-bold text-mint-text">◆ {balance} DUM</span>
          <span className="rounded-full bg-mint-card px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-mint-text">
            Beta
          </span>
        </button>
      </div>
    </>
  );
}
