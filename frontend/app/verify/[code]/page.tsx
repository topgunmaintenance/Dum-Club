"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { authFetch } from "../../../lib/authFetch";

import { API_BASE } from "../../../lib/apiBase";

export default function VerifyPage() {
  const params = useParams() as { code: string };
  const code = decodeURIComponent(params.code ?? "");
  const [booking, setBooking] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const res = await fetch(`${API_BASE}/api/verify/${encodeURIComponent(code)}`);
      if (!res.ok) {
        setError("Code not found");
        setLoading(false);
        return;
      }
      setBooking(await res.json());
      setLoading(false);
    }
    if (code) load();
  }, [code]);

  async function markComplete() {
    setMarking(true);
    const res = await authFetch(`${API_BASE}/api/verify/mark-used`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (res.ok) {
      setDone(true);
      setBooking((b) => (b ? { ...b, status: "completed" } : b));
    } else {
      const err = await res.json().catch(() => null);
      const detail = err?.detail;
      alert(typeof detail === "string" ? detail : "Failed to mark complete");
    }
    setMarking(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base text-zinc-500">
        Verifying code...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-base text-center">
        <div className="mb-4 text-5xl">❌</div>
        <div className="font-mono text-xl text-red-400">Invalid code</div>
        <div className="mt-2 text-zinc-500">This redemption code was not found.</div>
      </div>
    );
  }

  const isAlreadyUsed = booking?.status === "completed";
  const proj = booking?.projects as { name?: string; token_symbol?: string } | undefined;
  const slot = booking?.availability_slots as
    | { slot_date?: string; slot_time?: string }
    | undefined;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-base px-6 text-white">
      <div className="w-full max-w-sm">
        <div
          className={`mb-6 rounded-2xl border p-6 text-center ${
            done || isAlreadyUsed
              ? "border-zinc-700 bg-zinc-950"
              : "border-emerald-400/30 bg-emerald-400/5"
          }`}
        >
          <div className="mb-3 text-5xl">{done || isAlreadyUsed ? "✓" : "🎟️"}</div>
          <div
            className={`font-mono text-xl font-black ${
              done || isAlreadyUsed ? "text-zinc-500" : "text-emerald-400"
            }`}
          >
            {done || isAlreadyUsed ? "REDEEMED" : "VALID"}
          </div>
          <div className="mt-1 font-mono text-2xl font-black tracking-widest text-white">
            {code}
          </div>
        </div>

        <div className="mb-6 space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Project</span>
            <span className="font-semibold text-white">{proj?.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Customer</span>
            <span className="text-white">
              {(booking?.customer_name as string) || "Anonymous"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Date</span>
            <span className="text-white">{slot?.slot_date}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Time</span>
            <span className="text-white">
              {String(slot?.slot_time ?? "").slice(0, 5)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Token</span>
            <span className="font-mono text-emerald-400">
              {String(booking?.token_amount ?? "")} ${proj?.token_symbol}
            </span>
          </div>
          {booking?.notes && (
            <div className="rounded-lg border border-zinc-800 bg-base px-3 py-2 text-xs text-zinc-400">
              {String(booking.notes)}
            </div>
          )}
        </div>

        {isAlreadyUsed || done ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 py-4 text-center font-mono text-sm text-zinc-500">
            Service already completed
          </div>
        ) : (
          <button
            type="button"
            onClick={markComplete}
            disabled={marking}
            className="w-full rounded-xl bg-emerald-500 py-4 font-mono text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {marking ? "Marking..." : "Mark service complete ✓"}
          </button>
        )}
      </div>
    </div>
  );
}
