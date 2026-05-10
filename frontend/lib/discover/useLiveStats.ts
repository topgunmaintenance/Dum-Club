"use client";

/**
 * useLiveStats — small hook around GET /api/projects/live-stats.
 *
 * Backs the Discover TrustStrip with live platform numbers
 * (verified merchants, active offers, live projects). One-shot
 * fetch on mount; no polling — the trust strip doesn't need to
 * tick during a session, and any post-mount update would just
 * mutate text the user has already read.
 *
 * If the endpoint fails or returns zeros, callers should fall
 * back to non-numeric trust copy (CLAUDE.md §12 rule 2: no fake
 * numbers). The hook leaves it to the consumer to gate that
 * fallback rather than fabricating values here.
 */

import { useEffect, useState } from "react";
import { API_BASE } from "../apiBase";

export type LiveStats = {
  live_projects: number;
  active_offers: number;
  businesses: number;
  verified_merchants: number;
};

type State = {
  stats: LiveStats | null;
  loading: boolean;
  error: string | null;
};

export function useLiveStats(): State {
  const [state, setState] = useState<State>({
    stats: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/live-stats`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Partial<LiveStats>;
        if (cancelled) return;
        setState({
          stats: {
            live_projects: Number(data.live_projects ?? 0),
            active_offers: Number(data.active_offers ?? 0),
            businesses: Number(data.businesses ?? 0),
            verified_merchants: Number(data.verified_merchants ?? 0),
          },
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          stats: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
