/**
 * useProjects — loads projects + batched market data.
 *
 * Calls GET /api/projects/public on mount, then polls market
 * snapshots every 60s (visibility-aware — pauses when tab hidden).
 * 60s matches the LiveActivityTicker cadence so the marketplace
 * never has two staggered refresh waves competing for the same
 * Railway endpoints.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../apiBase";
import type { Project, MarketSnapshot } from "./types";
import { loadMarketSnapshotsBatch } from "./useMarketBatch";

const MARKET_POLL_INTERVAL = 60_000;
// Refresh the project list itself every 20s so a merchant
// flipping is_live (Go Live / End Stream) propagates to all
// open /discover tabs within a normal page-glance window. The
// market poll loop is a separate cadence — that one refreshes
// price/volume snapshots and runs at 60s.
const PROJECTS_POLL_INTERVAL = 20_000;

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

  // Market poll every 60s (visibility-aware)
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

  // Project-list refresh poll. Separate from the market poll
  // because the field we care about (is_live + viewer_count)
  // sits on the project row itself, not on the per-project
  // /market snapshot. Without this, /discover stayed stuck on
  // the initial-mount snapshot — a merchant going live mid-
  // session never appeared as live on already-open Discover
  // tabs (QA T3 finding).
  useEffect(() => {
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadProjects();
    }, PROJECTS_POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [loadProjects]);

  // Refresh on tab refocus too — visitors who switch tabs
  // back to Discover after a few minutes should see the
  // freshest live state without waiting for the next poll tick.
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisible() {
      if (document.visibilityState === "visible") loadProjects();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadProjects]);

  return { projects, marketByProject, loading, error, marketLoaded };
}
