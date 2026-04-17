/**
 * useProjects — loads projects + batched market data.
 *
 * Calls GET /api/projects/public on mount, then polls market
 * snapshots every 45s (visibility-aware — pauses when tab hidden).
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../apiBase";
import type { Project, MarketSnapshot } from "./types";
import { loadMarketSnapshotsBatch } from "./useMarketBatch";

const MARKET_POLL_INTERVAL = 45_000;

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [marketLoaded, setMarketLoaded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/projects/public`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load projects: ${res.status}`);
      const data = await res.json();
      const publicProjects: Project[] = Array.isArray(data?.projects)
        ? data.projects
        : Array.isArray(data)
          ? data
          : [];
      setProjects(publicProjects);
      return publicProjects;
    } catch (err) {
      console.error("DISCOVER LOAD ERROR:", err);
      setError("We couldn't load listings. Refresh to try again.");
      setProjects([]);
      return [];
    }
  }, []);

  const loadMarkets = useCallback(async (projs: Project[]) => {
    const ids = projs.map((p) => p.id).filter(Boolean);
    if (!ids.length) {
      setMarketByProject({});
      setMarketLoaded(true);
      return;
    }
    try {
      const snapshots = await loadMarketSnapshotsBatch(ids);
      setMarketByProject(snapshots);
    } catch (err) {
      console.error("DISCOVER MARKET ERROR:", err);
    } finally {
      setMarketLoaded(true);
    }
  }, []);

  // Initial load: projects → then market batch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const projs = await loadProjects();
      if (cancelled) return;
      await loadMarkets(projs);
      if (cancelled) return;
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadProjects, loadMarkets]);

  // Market poll every 45s (visibility-aware)
  useEffect(() => {
    if (!projects.length) return;
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadMarkets(projects);
    }, MARKET_POLL_INTERVAL);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [projects, loadMarkets]);

  return { projects, marketByProject, loading, error, marketLoaded };
}
