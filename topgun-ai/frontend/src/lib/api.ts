// Topgun AI — frontend API client.
//
// Thin fetch wrapper around the FastAPI backend. Server components call
// this directly so the data shows up server-rendered. If the backend is
// unreachable, callers can fall back to ``demoData`` so the UI always
// has something meaningful to render.

import type {
  DocumentListResponse,
  InsightsResponse,
  QueryResponse,
  RecentQuery,
  SystemStatusResponse,
} from "./types";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Topgun API ${path} failed: ${res.status} ${res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  baseUrl: BASE_URL,

  async health(): Promise<{ status: string; version: string }> {
    return request("/api/health");
  },

  async listDocuments(): Promise<DocumentListResponse> {
    return request("/api/documents");
  },

  async insights(): Promise<InsightsResponse> {
    return request("/api/insights");
  },

  async systemStatus(): Promise<SystemStatusResponse> {
    return request("/api/system/status");
  },

  async recentQueries(limit = 5): Promise<RecentQuery[]> {
    return request(`/api/query/recent?limit=${limit}`);
  },

  async ask(question: string): Promise<QueryResponse> {
    return request("/api/query", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
  },
};

// ---------------------------------------------------------------------
// Safe wrappers for server components: never crash the page if the
// backend is offline; fall back to the bundled demo data instead.
// ---------------------------------------------------------------------
import { demoData } from "./demoData";

export async function safeListDocuments(): Promise<DocumentListResponse> {
  try {
    return await api.listDocuments();
  } catch {
    return demoData.documentList;
  }
}

export async function safeInsights(): Promise<InsightsResponse> {
  try {
    return await api.insights();
  } catch {
    return demoData.insights;
  }
}

export async function safeSystemStatus(): Promise<SystemStatusResponse> {
  try {
    return await api.systemStatus();
  } catch {
    return demoData.systemStatus;
  }
}

export async function safeRecentQueries(limit = 5): Promise<RecentQuery[]> {
  try {
    return await api.recentQueries(limit);
  } catch {
    return demoData.recentQueries.slice(0, limit);
  }
}
