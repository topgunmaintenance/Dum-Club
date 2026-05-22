/**
 * useProjects — loads projects + market data for /discover in a SINGLE
 * request via GET /api/projects/discover.
 *
 * Replaces the old fan-out (GET /public + N x /{id}/market). The browser
 * now makes one request that returns each project with an embedded
 * market_summary, which we map into marketByProject keyed by id. One
 * visibility-aware poll (20s) keeps is_live + price fresh; the endpoint
 * is HTTP-cached 30s so the poll is cheap.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../apiBase";
import type { Project, MarketSnapshot } from "./types";

const POLL_INTERVAL = 20_000;
const PAGE_SIZE = 24;

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // How many items the feed currently shows. "Load more" bumps this; the
  // poll re-fetches the whole visible window so freshness is preserved.
  const limitRef = useRef(PAGE_SIZE);

  const loadDiscover = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setError("");
      const res = await fetch(
        `${API_BASE}/api/projects/discover?limit=${limitRef.current}&offset=0`,
        { cache: "no-store" },
      );

      // Deploy-safety fallback: if the consolidated endpoint isn't live
      // yet (e.g. frontend deployed before the backend during a rollout),
      // fall back to the still-present GET /public so /discover never
      // hard-breaks. Cards render without price chips until the backend
      // catches up, then the next poll self-heals.
      if (res.status === 404 || res.status === 405) {
        const pub = await fetch(`${API_BASE}/api/projects/public`, { cache: "no-store" });
        if (!pub.ok) throw new Error(`Failed to load listings: ${pub.status}`);
        const pdata = await pub.json();
        const plist: Project[] = Array.isArray(pdata?.projects)
          ? pdata.projects
          : Array.isArray(pdata)
            ? pdata
            : [];
        setProjects(plist);
        setMarketByProject({});
        setHasMore(false);
        return;
      }

      if (!res.ok) throw new Error(`Failed to load listings: ${res.status}`);
      const data = await res.json();
      const list: Project[] = Array.isArray(data?.projects) ? data.projects : [];

      const markets: Record<string, MarketSnapshot> = {};
      for (const p of list) {
        const m = (p as { market_summary?: MarketSnapshot | null }).market_summary;
        if (p.id && m) {
          markets[p.id] = {
            price: Number(m.price || 0),
            market_cap: Number(m.market_cap || 0),
            volume_24h: Number(m.volume_24h || 0),
          } as MarketSnapshot;
        }
      }

      setProjects(list);
      setMarketByProject(markets);
      setHasMore(Boolean(data?.has_more));
    } catch (err) {
      console.error("DISCOVER LOAD ERROR:", err);
      if (!opts?.silent) {
        setError("We couldn't load listings. Refresh to try again.");
        setProjects([]);
      }
    } finally {
      setMarketLoaded(true);
    }
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    limitRef.current += PAGE_SIZE;
    await loadDiscover({ silent: true });
    setLoadingMore(false);
  }, [loadDiscover]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadDiscover();
      if (cancelled) return;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDiscover]);

  // Single visibility-aware poll keeps is_live + price fresh. One request
  // per tick now that projects + market come from the same endpoint.
  useEffect(() => {
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadDiscover({ silent: true });
    }, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [loadDiscover]);

  // Refresh on tab refocus so visitors returning after a few minutes see
  // the freshest live state without waiting for the next poll tick.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisible() {
      if (document.visibilityState === "visible") loadDiscover({ silent: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadDiscover]);

  return { projects, marketByProject, loading, error, marketLoaded, hasMore, loadMore, loadingMore };
}
