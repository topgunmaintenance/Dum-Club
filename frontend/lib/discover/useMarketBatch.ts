/**
 * Batched market snapshot fetcher — fixes the N+1 problem.
 *
 * Chunks project IDs into batches of 8 and fetches in parallel
 * per batch, sequential between batches. Gracefully handles
 * individual failures without blocking the rest.
 */

import { API_BASE } from "../apiBase";
import type { MarketSnapshot } from "./types";

const BATCH_SIZE = 8;

export async function loadMarketSnapshotsBatch(
  projectIds: string[],
): Promise<Record<string, MarketSnapshot>> {
  if (!projectIds.length) return {};

  const results: Record<string, MarketSnapshot> = {};

  // Chunk into batches
  for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
    const batch = projectIds.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async (projectId) => {
        const res = await fetch(`${API_BASE}/api/projects/${projectId}/market`, {
          cache: "no-store",
        });
        if (!res.ok) return { projectId, snapshot: null };
        const data = await res.json();
        return {
          projectId,
          snapshot: {
            price: Number(data?.price || 0),
            market_cap: Number(data?.market_cap || 0),
            volume_24h: Number(data?.volume_24h || 0),
          } as MarketSnapshot,
        };
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.snapshot) {
        results[result.value.projectId] = result.value.snapshot;
      }
    }
  }

  return results;
}
