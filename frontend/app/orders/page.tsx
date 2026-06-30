"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../lib/auth/AuthContext";

import { API_BASE } from "../../lib/apiBase";
import { Card } from "../../components/ui/Card";

interface Order {
  id: string;
  offer_id: string;
  project_id: string;
  amount_paid_usd: number;
  status: string;
  created_at: string;
  updated_at: string;
  tracking_number?: string | null;
  shipping_address?: {
    name?: string | null; line1?: string | null; line2?: string | null;
    city?: string | null; state?: string | null; postal_code?: string | null;
  } | null;
  offers?: { title: string; offer_type: string; price_usd: number } | null;
}

// Chip styling maps to the handoff status palette: PAID / fulfilled read
// mint (emerald-on-pale-mint), the abandoned-checkout state reads amber
// (#E08A2B on #FCEFD9), and the rest stay neutral. UI-only; no schema
// change — these are the EXISTING order.status values from the API.
function statusBadge(status: string) {
  if (status === "fulfilled" || status === "delivered") return { label: "Fulfilled", cls: "bg-mint-card text-mint-text border-mint-card-border" };
  if (status === "refunded") return { label: "Refunded", cls: "bg-surface-muted text-secondary border-default" };
  if (status === "partially_refunded") return { label: "Partially refunded", cls: "bg-surface-muted text-secondary border-default" };
  if (status === "paid") return { label: "Paid", cls: "bg-mint-card text-mint-text border-mint-card-border" };
  // "Checkout not completed" is more honest than "Awaiting Payment" —
  // these rows are the buyer's abandoned/expired Stripe Checkout
  // sessions, not unpaid completed orders in flight. Amber pill (the
  // right "neutral attention" tone).
  if (status === "pending_payment") return { label: "Checkout not completed", cls: "bg-dum-amber-bg text-dum-amber border-transparent" };
  return { label: status, cls: "bg-surface-muted text-secondary border-default" };
}

export default function OrdersPage() {
  const { user, getToken } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/checkout/orders/buyer`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setOrders(Array.isArray(data) ? data : []);
      } catch {
        setOrders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  return (
    <div className="min-h-screen bg-surface-page px-4 py-10 text-primary sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/dashboard"
          className="mb-8 inline-flex h-9 w-9 items-center justify-center rounded-full border border-default bg-surface-card text-secondary transition hover:bg-surface-muted hover:text-primary"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>

        <div className="mb-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
          Purchases{orders.length > 0 ? ` · ${orders.length}` : ""}
        </div>
        <h1 className="font-mono text-3xl font-bold text-primary sm:text-4xl">
          My Orders
        </h1>

        {loading ? (
          <Card padding="lg" className="mt-8 text-center text-secondary">
            Loading orders...
          </Card>
        ) : !user ? (
          <Card padding="lg" className="mt-8 text-center text-secondary">
            Sign in to view your orders.
          </Card>
        ) : orders.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-default p-10 text-center">
            <div className="text-2xl mb-3 opacity-30">📦</div>
            <p className="text-sm font-medium text-secondary">No purchases yet</p>
            <p className="text-xs text-muted mt-1">When you buy an offer, it will appear here.</p>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {orders.map((order) => {
              const badge = statusBadge(order.status);
              return (
                <Card key={order.id} padding="none" className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-primary truncate">
                        {order.offers?.title || "Offer"}
                      </h3>
                      <div className="mt-1 text-xs text-muted">
                        {new Date(order.created_at).toLocaleDateString(undefined, {
                          year: "numeric", month: "short", day: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-lg font-bold text-primary">
                        ${Number(order.amount_paid_usd).toFixed(2)}
                      </div>
                      <span className={`mt-1 inline-block rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  {(order.shipping_address || order.tracking_number) && (
                    <div className="mt-3 rounded-xl border border-default bg-surface-page px-3 py-2 text-[11px] text-secondary">
                      {order.shipping_address && (
                        <div>
                          <span className="font-semibold text-primary">Ship to: </span>
                          {[
                            order.shipping_address.name,
                            order.shipping_address.line1,
                            order.shipping_address.line2,
                            [order.shipping_address.city, order.shipping_address.state, order.shipping_address.postal_code]
                              .filter(Boolean)
                              .join(", "),
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                      {order.tracking_number && (
                        <div className="mt-0.5">
                          <span className="font-semibold text-primary">Tracking: </span>
                          <span className="font-mono">{order.tracking_number}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/project/${order.project_id}`}
                      className="text-xs text-muted transition hover:text-mint-text"
                    >
                      View project
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
