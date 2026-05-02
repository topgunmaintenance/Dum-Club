"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "../../../lib/apiBase";

type EmbedProject = {
  id?: string;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  is_live?: boolean | null;
};

type Offer = { id?: string };

/**
 * /embed/[businessId] — minimal embed shell.
 *
 * Step 2 of the DUM Live Embed build: render only the bare facts of a
 * project (name, slug, live status, offer count) so the route works
 * end-to-end inside an iframe with zero DUM Club chrome (gated by
 * SiteChrome). No video, no checkout, no chat — those land in later
 * steps. The businessId param can be a slug or UUID; the projects
 * endpoint resolves both.
 */
export default function EmbedShellPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId;

  const [project, setProject] = useState<EmbedProject | null>(null);
  const [offerCount, setOfferCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/projects/${businessId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Failed to load project (${res.status})`);

        const data = await res.json();
        const p: EmbedProject = data?.project || data;
        if (cancelled) return;
        setProject(p);

        if (p?.id) {
          try {
            const offersRes = await fetch(`${API_BASE}/api/offers/${p.id}`, {
              cache: "no-store",
            });
            if (offersRes.ok) {
              const offers: Offer[] = await offersRes.json();
              if (!cancelled) {
                setOfferCount(Array.isArray(offers) ? offers.length : 0);
              }
            } else if (!cancelled) {
              setOfferCount(0);
            }
          } catch {
            if (!cancelled) setOfferCount(0);
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const displayName = project?.name || project?.title || "—";
  const displaySlug = project?.slug || businessId || "—";
  const liveLabel = project?.is_live ? "live" : "offline";

  return (
    <main className="min-h-screen bg-base text-[var(--color-text-primary)] px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {loading ? "Loading…" : displayName}
        </h1>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--color-text-muted)]">Business ID / slug</dt>
            <dd className="font-mono">{displaySlug}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Live status</dt>
            <dd>
              <span
                className={
                  project?.is_live
                    ? "text-emerald-400"
                    : "text-[var(--color-text-muted)]"
                }
              >
                {liveLabel}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Offers</dt>
            <dd>{offerCount}</dd>
          </div>
        </dl>

        <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
          Embed shell loaded
        </p>
      </div>
    </main>
  );
}
