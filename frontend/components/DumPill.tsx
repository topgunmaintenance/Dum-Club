"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/auth/AuthContext";

// Pages where the pill is hidden (already show points prominently)
const HIDDEN_PATHS = ["/build", "/dashboard", "/hub", "/project"];

export function DumPill() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [balance, setBalance] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Read balance from localStorage + listen for updates
  useEffect(() => {
    const read = () => {
      const pts = Number(localStorage.getItem("dum_points") || "0");
      setBalance(pts);
    };
    read();
    window.addEventListener("dum-points-update", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("dum-points-update", read);
      window.removeEventListener("storage", read);
    };
  }, []);

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
          <div className="mb-2 w-64 rounded-2xl border border-emerald-400/15 bg-zinc-950/95 p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5),0_0_16px_rgba(0,255,163,0.06)] backdrop-blur-md">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/70">
              DUM Points
            </div>
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{balance}</span>
              <span className="text-sm text-zinc-500">points</span>
            </div>

            <div className="space-y-2.5 border-t border-zinc-800 pt-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-emerald-400 text-xs">+2</span>
                <span className="text-[12px] text-zinc-400">Earn with every purchase</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-emerald-400 text-xs">10%</span>
                <span className="text-[12px] text-zinc-400">Off any offer with 10 points</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-emerald-400 text-xs">◆</span>
                <span className="text-[12px] text-zinc-400">Works at every DUM Club business</span>
              </div>
            </div>

            <Link
              href="/hub"
              onClick={() => setExpanded(false)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-2.5 text-[12px] font-bold text-emerald-400 transition hover:bg-emerald-400/10"
            >
              View DUM Hub →
            </Link>
          </div>
        )}

        {/* Collapsed pill */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-zinc-950/95 px-4 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.4),0_0_8px_rgba(0,255,163,0.04)] backdrop-blur-md transition-all duration-200 hover:border-emerald-400/40 hover:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_12px_rgba(0,255,163,0.08)]"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[12px] font-bold text-emerald-400">◆ {balance} DUM</span>
        </button>
      </div>
    </>
  );
}
