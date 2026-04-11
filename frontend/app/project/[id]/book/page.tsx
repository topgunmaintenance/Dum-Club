"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import QRCode from "react-qr-code";

import { API_BASE } from "../../../../lib/apiBase";

type Slot = {
  id: string;
  slot_date: string;
  slot_time: string;
};

type BookingSuccess = {
  booking: { id: string; customer_name?: string | null; slot_id: string };
  redemption_code: string;
  qr_data: string;
};

export default function BookPage() {
  const { id } = useParams() as { id: string };
  const { publicKey } = useWallet();

  const [project, setProject] = useState<Record<string, unknown> | null>(null);
  const [serviceProfile, setServiceProfile] = useState<Record<string, unknown> | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState<BookingSuccess | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  useEffect(() => {
    async function load() {
      const [projRes, profileRes, slotsRes] = await Promise.all([
        fetch(`${API_BASE}/api/projects/${id}`),
        fetch(`${API_BASE}/api/projects/${id}/service-profile`),
        fetch(`${API_BASE}/api/projects/${id}/availability`),
      ]);
      if (projRes.ok) {
        const d = await projRes.json();
        setProject((d?.project as Record<string, unknown>) || d);
      }
      if (profileRes.ok) setServiceProfile(await profileRes.json());
      if (slotsRes.ok) setSlots(await slotsRes.json());
    }
    load();
  }, [id]);

  const uniqueDates = useMemo(() => {
    return Array.from(new Set(slots.map((s) => s.slot_date))).sort();
  }, [slots]);

  const slotsForDate = useMemo(() => {
    return slots.filter((s) => s.slot_date === selectedDate);
  }, [slots, selectedDate]);

  const projectName = (project?.name as string) || (project?.title as string) || "Project";
  const tokenSymbol = (project?.token_symbol as string) || "TOKEN";

  async function handleBook() {
    if (!selectedSlot || !publicKey) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects/${id}/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: selectedSlot.id,
          customer_wallet: publicKey.toBase58(),
          customer_email: customerEmail || undefined,
          customer_name: customerName || undefined,
          token_amount: 1,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(
          typeof err?.detail === "string" ? err.detail : "Booking failed"
        );
      }
      setBooking(await res.json());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Booking failed";
      alert(message);
    } finally {
      setLoading(false);
    }
  }

  if (booking) {
    return (
      <div className="min-h-screen bg-base text-white">
        <div className="mx-auto max-w-lg px-6 py-16 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-400/10 text-4xl">
            ✓
          </div>
          <h1 className="mb-2 font-mono text-3xl font-black text-white">
            Booking confirmed
          </h1>
          <p className="mb-8 text-zinc-400">
            Show this code to {projectName} to redeem your service.
          </p>

          <div className="mb-6 flex justify-center rounded-2xl border border-zinc-800 bg-white p-6">
            <QRCode value={booking.qr_data} size={180} />
          </div>

          <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-emerald-400">
              Redemption code
            </div>
            <div className="mb-3 font-mono text-2xl font-black tracking-[0.15em] text-white">
              {booking.redemption_code}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(
                  `My booking code for ${projectName}: ${booking.redemption_code}\nVerify at: ${booking.qr_data}`
                );
                setCopyFlash(true);
                setTimeout(() => setCopyFlash(false), 2000);
              }}
              className={`rounded-lg px-4 py-2 font-mono text-xs font-bold transition ${
                copyFlash
                  ? "bg-emerald-400 text-black"
                  : "border border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10"
              }`}
            >
              {copyFlash ? "Copied ✓" : "Share ↗"}
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="font-mono text-[10px] text-zinc-600">Date</div>
                <div className="text-white">{selectedSlot?.slot_date}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-zinc-600">Time</div>
                <div className="text-white">{selectedSlot?.slot_time}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-zinc-600">Service</div>
                <div className="text-white">{projectName}</div>
              </div>
              <div>
                <div className="font-mono text-[10px] text-zinc-600">Duration</div>
                <div className="text-white">
                  {(serviceProfile?.duration_minutes as number) || 60} min
                </div>
              </div>
            </div>
          </div>

          <Link
            href={`/project/${id}`}
            className="mt-6 inline-block rounded-xl border border-zinc-800 px-6 py-3 font-mono text-sm text-zinc-400 hover:text-white"
          >
            ← Back to project
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base text-white">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href={`/project/${id}`}
          className="mb-8 inline-flex items-center gap-2 font-mono text-xs text-zinc-500 hover:text-zinc-300"
        >
          ← Back to {projectName}
        </Link>

        <div className="mb-8">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            Book service
          </div>
          <h1 className="font-mono text-3xl font-black text-white">{projectName}</h1>
          {serviceProfile?.service_description && (
            <p className="mt-2 text-zinc-400">
              {String(serviceProfile.service_description)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {Boolean(serviceProfile?.duration_minutes) && (
              <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-500">
                {String(serviceProfile?.duration_minutes)} min
              </span>
            )}
            {serviceProfile?.service_type && (
              <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-500 capitalize">
                {String(serviceProfile.service_type)}
              </span>
            )}
            {serviceProfile?.location && (
              <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-500">
                📍 {String(serviceProfile.location)}
              </span>
            )}
          </div>
        </div>

        {!publicKey ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
            <div className="mb-3 text-3xl">🔒</div>
            <p className="text-zinc-400">Connect your wallet to book this service</p>
          </div>
        ) : slots.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
            <div className="mb-3 text-3xl">📅</div>
            <p className="text-zinc-400">No available slots right now.</p>
            <p className="mt-2 text-sm text-zinc-600">
              Check back soon or contact the creator.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                Step 1 — Select date
              </div>
              <div className="flex flex-wrap gap-2">
                {uniqueDates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setSelectedDate(d);
                      setSelectedSlot(null);
                    }}
                    className={`rounded-xl border px-4 py-2 font-mono text-sm transition ${
                      selectedDate === d
                        ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                        : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    {new Date(d + "T00:00:00").toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </button>
                ))}
              </div>
            </div>

            {selectedDate && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                <div className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Step 2 — Select time
                </div>
                <div className="flex flex-wrap gap-2">
                  {slotsForDate.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                      className={`rounded-xl border px-4 py-2 font-mono text-sm transition ${
                        selectedSlot?.id === slot.id
                          ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
                          : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {String(slot.slot_time).slice(0, 5)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedSlot && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                <div className="mb-4 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Step 3 — Your details
                </div>
                <div className="space-y-3">
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-xl border border-zinc-800 bg-base px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                  <input
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Email (optional — for confirmation)"
                    type="email"
                    className="w-full rounded-xl border border-zinc-800 bg-base px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any notes for the service provider..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-zinc-800 bg-base px-4 py-3 text-white outline-none focus:border-emerald-400"
                  />
                </div>

                <div className="mt-4 rounded-xl border border-zinc-800 bg-base p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Date</span>
                    <span className="text-white">{selectedDate}</span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Time</span>
                    <span className="text-white">
                      {String(selectedSlot.slot_time).slice(0, 5)}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between">
                    <span className="text-zinc-500">Cost</span>
                    <span className="font-mono text-emerald-400">
                      1 ${tokenSymbol}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleBook}
                  disabled={loading || !customerName.trim()}
                  className="mt-4 w-full rounded-xl bg-emerald-500 py-4 font-mono text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {loading
                    ? "Confirming..."
                    : `Confirm booking — 1 $${tokenSymbol}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
