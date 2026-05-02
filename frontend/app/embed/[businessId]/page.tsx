"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { API_BASE } from "../../../lib/apiBase";
import { useAuth } from "../../../lib/auth/AuthContext";
import { isIVSSession } from "../../../lib/liveProvider";
import { LiveChatIVS } from "../../../components/LiveChatIVS";

// IVSStageViewer pulls in amazon-ivs-web-broadcast which is browser-only.
// Mirror the dynamic-import pattern used by /project/[id] to keep SSR clean.
const IVSStageViewer = dynamic(
  () =>
    import("../../../components/IVSStageViewer").then((m) => ({
      default: m.IVSStageViewer,
    })),
  { ssr: false }
);

type EmbedProject = {
  id?: string;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  is_live?: boolean | null;
  live_provider?: string | null;
  ivs_stage_arn?: string | null;
};

type Offer = { id?: string };

type DebugEvent = {
  id: string;
  text: string;
};

/**
 * /embed/[businessId] — embed shell with live video + websocket wiring.
 *
 * Step 3 of the DUM Live Embed build. Adds the IVS video viewer and
 * the LiveChatIVS websocket wiring on top of the Step 2 metadata
 * shell. Still no checkout, no pinned product card, no SOL — those
 * land later. Designed to be iframed by a merchant site, so the page
 * runs without DUM Club chrome (gated by SiteChrome from Step 1).
 */
export default function EmbedShellPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = params?.businessId;

  const { user: authUser } = useAuth();
  const viewerUserId = authUser?.privyId || "";
  const viewerName = authUser?.email || "Viewer";

  const [project, setProject] = useState<EmbedProject | null>(null);
  const [offerCount, setOfferCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Event-wire diagnostics. Surfaced as visible debug text so we can
  // confirm the websocket pipeline is alive end-to-end before any
  // real UI (pinned card, checkout) is wired up in later steps.
  const [inventoryEventCount, setInventoryEventCount] = useState<number>(0);
  const [soldEventCount, setSoldEventCount] = useState<number>(0);
  const [lastEvents, setLastEvents] = useState<DebugEvent[]>([]);

  function pushEvent(text: string) {
    const ev: DebugEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
    };
    setLastEvents((prev) => [...prev.slice(-4), ev]);
  }

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
  const ivsActive = !!project && isIVSSession(project) && !!project.ivs_stage_arn;

  return (
    <main className="min-h-screen bg-base text-[var(--color-text-primary)] px-6 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {loading ? "Loading…" : displayName}
        </h1>

        {error && <p className="text-sm text-red-400">{error}</p>}

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

        {/* ── Live video area ───────────────────────────────────────
             IVSStageViewer when the project is on IVS Real-Time and
             has a stage ARN; static placeholder otherwise. The viewer
             component handles its own connecting / ended / error
             states, including the "Waiting for host video..." overlay
             when the stage is reachable but the host hasn't published
             yet, so we always render a video-shaped container here. */}
        <section aria-label="Live video">
          {project?.id && ivsActive ? (
            <IVSStageViewer projectId={project.id} userId={viewerUserId} />
          ) : (
            <div
              className="flex items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-black text-sm text-zinc-500"
              style={{ minHeight: 300, aspectRatio: "16/9" }}
            >
              {loading ? "Loading video…" : "Stream offline"}
            </div>
          )}
        </section>

        {/* ── LiveChatIVS — websocket wiring + basic chat display ──
             Drives the realtime event pipeline (viewer count, item
             updates, item sold). The component renders its own
             header containing the viewer count, which is the only
             surface the websocket exposes that count on. The
             onItemUpdate / onItemSold callbacks below feed the
             debug-event log rendered further down. */}
        {project?.id && isIVSSession(project) && (
          <section aria-label="Live chat">
            <LiveChatIVS
              projectId={project.id}
              userId={viewerUserId}
              userName={viewerName}
              isHost={false}
              onItemUpdate={(data) => {
                setInventoryEventCount((c) => c + 1);
                pushEvent(
                  `Inventory event received — offer ${data.offer_id} sold ${data.quantity_sold}${
                    data.sold_out ? " (sold out)" : ""
                  }`
                );
              }}
              onItemSold={(data) => {
                setSoldEventCount((c) => c + 1);
                pushEvent(
                  `Sold event received — ${data.title || "Item"} (offer ${data.offer_id})`
                );
              }}
            />
          </section>
        )}

        {/* ── Event-wire debug ─────────────────────────────────────
             Visible confirmation that onItemUpdate / onItemSold are
             firing, before the real product / checkout UI is wired
             up in later steps. */}
        <section
          aria-label="Event debug"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-xs"
        >
          <div className="mb-2 flex gap-4 text-[var(--color-text-muted)]">
            <span>Inventory events: {inventoryEventCount}</span>
            <span>Sold events: {soldEventCount}</span>
          </div>
          {lastEvents.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">No events yet</p>
          ) : (
            <ul className="space-y-1 font-mono">
              {lastEvents.map((ev) => (
                <li key={ev.id}>{ev.text}</li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
          Embed shell loaded
        </p>
      </div>
    </main>
  );
}
