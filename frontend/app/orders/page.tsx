"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Order {
  id: string;
  offer_id: string;
  project_id: string;
  amount_paid_usd: number;
  status: string;
  created_at: string;
  updated_at: string;
  offers?: { title: string; offer_type: string; price_usd: number } | null;
}

function statusBadge(status: string) {
  if (status === "fulfilled" || status === "delivered") return { label: "Fulfilled", cls: "border-emerald-400/30 text-emerald-400 bg-emerald-400/10" };
  if (status === "paid") return { label: "Paid", cls: "border-sky-400/30 text-sky-400 bg-sky-400/10" };
  if (status === "pending_payment") return { label: "Awaiting Payment", cls: "border-amber-400/30 text-amber-400 bg-amber-400/10" };
  return { label: status, cls: "border-zinc-700 text-zinc-500 bg-zinc-900" };
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
    <div className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/dashboard"
          className="mb-8 inline-flex rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
        >
          ← Dashboard
        </Link>

        <div className="mb-2 text-xs uppercase tracking-[0.35em] text-zinc-600">
          Purchases
        </div>
        <h1 className="font-mono text-3xl font-bold text-white sm:text-4xl">
          My Orders
        </h1>

        {loading ? (
          <div className="mt-8 rounded-2xl border border-zinc-900 bg-zinc-950 p-8 text-center text-zinc-500">
            Loading orders...
          </div>
        ) : !user ? (
          <div className="mt-8 rounded-2xl border border-zinc-900 bg-zinc-950 p-8 text-center text-zinc-500">
            Sign in to view your orders.
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 p-10 text-center">
            <div className="text-2xl mb-3 opacity-30">📦</div>
            <p className="text-sm font-medium text-zinc-500">No purchases yet</p>
            <p className="text-xs text-zinc-600 mt-1">When you buy an offer, it will appear here.</p>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {orders.map((order) => {
              const badge = statusBadge(order.status);
              return (
                <div key={order.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-white truncate">
                        {order.offers?.title || "Offer"}
                      </h3>
                      <div className="mt-1 text-xs text-zinc-600">
                        {new Date(order.created_at).toLocaleDateString(undefined, {
                          year: "numeric", month: "short", day: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-lg font-bold text-white">
                        ${Number(order.amount_paid_usd).toFixed(2)}
                      </div>
                      <span className={`inline-block mt-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      href={`/project/${order.project_id}`}
                      className="text-xs text-zinc-600 transition hover:text-emerald-400"
                    >
                      View project →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
