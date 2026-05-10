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

      <div className="fixed bottom-4 right-4 z-[100]">
        {/* Expanded panel */}
        {expanded && (
          <div className="mb-2 w-64 rounded-2xl border border-default bg-surface-card p-5 shadow-[0_16px_48px_rgba(11,18,32,0.18)] backdrop-blur-md">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
              DUM Points
            </div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-brand-navy">{balance}</span>
              <span className="text-sm text-secondary">points</span>
            </div>
            {/* Human conversion line — Phase 0A. The whole point of this
                pill is to make the unit obvious to a non-crypto user. */}
            <div className="mb-3 text-[11px] leading-snug text-secondary">
              1 DUM = $0.10 · use for discounts at participating businesses
            </div>

            <div className="space-y-2.5 border-t border-default pt-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-brand-teal text-xs">+2</span>
                <span className="text-[12px] text-primary">Earn with every purchase</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-brand-teal text-xs">10%</span>
                <span className="text-[12px] text-primary">Off any offer with 10 points</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-brand-teal text-xs">◆</span>
                <span className="text-[12px] text-primary">Works at every DUM Club business</span>
              </div>
            </div>

            <Link
              href="/hub"
              onClick={() => setExpanded(false)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-default bg-brand-teal-soft px-4 py-2.5 text-[12px] font-bold text-brand-teal transition hover:bg-brand-teal hover:text-white"
            >
              View DUM Hub →
            </Link>
          </div>
        )}

        {/* Collapsed pill — native title attribute gives a hover tooltip
            without needing JS or a new dependency. */}
        <button
          onClick={() => setExpanded(!expanded)}
          title="1 DUM = $0.10 · use for discounts at participating businesses"
          aria-label={`${balance} DUM Points · 1 DUM = $0.10 · use for discounts at participating businesses`}
          className="flex items-center gap-2 rounded-full border border-default bg-surface-card px-4 py-2.5 shadow-[0_8px_24px_rgba(11,18,32,0.12)] backdrop-blur-md transition-all duration-200 hover:border-brand-teal hover:shadow-[0_8px_32px_rgba(11,18,32,0.18)]"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
          </span>
          <span className="text-[12px] font-bold text-brand-teal">◆ {balance} DUM</span>
        </button>
      </div>
    </>
  );
}
