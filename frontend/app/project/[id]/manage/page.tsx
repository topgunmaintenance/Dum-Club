"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabase/client";
import { authFetch } from "../../../../lib/authFetch";

import { API_BASE } from "../../../../lib/apiBase";

const TIMES = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];

function slotTimeToHHMM(t: string) {
  const s = String(t);
  const parts = s.split(":");
  return `${parts[0] ?? "00"}:${parts[1] ?? "00"}`;
}

export default function ManagePage() {
  const { id } = useParams() as { id: string };
  const [project, setProject] = useState<Record<string, unknown> | null>(null);
  const [bookings, setBookings] = useState<Record<string, unknown>[]>([]);
  const [serviceProfile, setServiceProfile] = useState<Record<string, unknown>>({
    service_type: "remote",
    duration_minutes: 60,
    buffer_minutes: 15,
    price_per_token: 1,
    service_description: "",
    location: "",
    timezone: "America/New_York",
  });
  const [saving, setSaving] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState<{ date: string; time: string }[]>([]);
  const [bookedKeys, setBookedKeys] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"settings" | "availability" | "bookings">("bookings");

  const next14Days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i + 1);
    return d.toISOString().split("T")[0]!;
  });

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [projRes, profileRes, bookRes, availRes] = await Promise.all([
      fetch(`${API_BASE}/api/projects/${id}`),
      fetch(`${API_BASE}/api/projects/${id}/service-profile`),
      authFetch(`${API_BASE}/api/projects/${id}/bookings`),
      authFetch(`${API_BASE}/api/projects/${id}/availability`),
    ]);

    if (projRes.ok) {
      const d = await projRes.json();
      setProject((d?.project as Record<string, unknown>) || d);
    }
    if (profileRes.ok) {
      const p = await profileRes.json();
      if (p) setServiceProfile(p);
    }
    if (bookRes.ok) setBookings(await bookRes.json());

    if (availRes.ok) {
      const slots = (await availRes.json()) as {
        slot_date: string;
        slot_time: string;
        is_booked?: boolean;
      }[];
      const booked = new Set<string>();
      const next: { date: string; time: string }[] = [];
      for (const s of slots) {
        const t = slotTimeToHHMM(s.slot_time);
        const key = `${s.slot_date}-${t}`;
        next.push({ date: s.slot_date, time: t });
        if (s.is_booked) booked.add(key);
      }
      setSelectedSlots(next);
      setBookedKeys(booked);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveServiceProfile() {
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    await authFetch(`${API_BASE}/api/projects/${id}/service-profile`, {
      method: "POST",
      body: JSON.stringify(serviceProfile),
    });
    setSaving(false);
    alert("Service profile saved!");
  }

  async function saveAvailability() {
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }

    await authFetch(`${API_BASE}/api/projects/${id}/availability`, {
      method: "POST",
      body: JSON.stringify({
        slots: selectedSlots.map((s) => ({
          slot_date: s.date,
          slot_time: `${s.time}:00`,
        })),
      }),
    });
    setSaving(false);
    alert("Availability saved!");
    await load();
  }

  function toggleSlot(date: string, time: string) {
    const key = `${date}-${time}`;
    if (bookedKeys.has(key)) return;
    setSelectedSlots((prev) => {
      const exists = prev.find((s) => s.date === date && s.time === time);
      if (exists) return prev.filter((s) => !(s.date === date && s.time === time));
      return [...prev, { date, time }];
    });
  }

  const isSelected = (date: string, time: string) =>
    selectedSlots.some((s) => s.date === date && s.time === time);

  const projectName =
    (project?.name as string) || (project?.title as string) || "Project";

  return (
    <div className="min-h-screen bg-base text-white">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <Link
          href={`/project/${id}`}
          className="mb-6 inline-flex items-center gap-2 font-mono text-xs text-zinc-500 hover:text-zinc-300"
        >
          ← {projectName}
        </Link>

        <h1 className="mb-2 font-mono text-3xl font-black">Manage bookings</h1>
        <p className="mb-8 text-zinc-500">
          Set your availability, service details, and view incoming bookings.
        </p>

        <div className="mb-8 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
          {(["bookings", "availability", "settings"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-2.5 font-mono text-xs uppercase tracking-widest transition ${
                tab === t
                  ? "bg-emerald-400 font-bold text-black"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "bookings" && (
          <div className="space-y-3">
            {bookings.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center">
                <div className="mb-3 text-4xl">📅</div>
                <p className="text-zinc-400">No bookings yet.</p>
                <p className="mt-2 text-sm text-zinc-600">
                  Set your availability so customers can book.
                </p>
              </div>
            ) : (
              bookings.map((b) => {
                const slot = b.availability_slots as
                  | { slot_date?: string; slot_time?: string }
                  | undefined;
                return (
                  <div
                    key={String(b.id)}
                    className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-white">
                          {(b.customer_name as string) || "Anonymous"}
                        </div>
                        <div className="mt-1 font-mono text-sm text-zinc-400">
                          {slot?.slot_date} at{" "}
                          {String(slot?.slot_time ?? "").slice(0, 5)}
                        </div>
                        {b.customer_email && (
                          <div className="mt-1 text-xs text-zinc-600">
                            {String(b.customer_email)}
                          </div>
                        )}
                        {b.notes && (
                          <div className="mt-2 rounded-lg border border-zinc-800 bg-base px-3 py-2 text-xs text-zinc-400">
                            {String(b.notes)}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <span
                          className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase ${
                            b.status === "completed"
                              ? "bg-zinc-800 text-zinc-500"
                              : "bg-emerald-400/10 text-emerald-400"
                          }`}
                        >
                          {String(b.status)}
                        </span>
                        <div className="mt-2 font-mono text-xs text-zinc-600">
                          {String(b.redemption_code)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "availability" && (
          <div>
            <p className="mb-4 text-sm text-zinc-500">
              Click time slots to mark yourself as available. Customers can then book these times.
              Booked slots stay locked until the appointment completes.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="w-16 py-2 font-mono text-[10px] text-zinc-600" />
                    {next14Days.slice(0, 7).map((d) => (
                      <th key={d} className="px-1 py-2 font-mono text-[10px] text-zinc-500">
                        {new Date(d + "T00:00:00").toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "numeric",
                          day: "numeric",
                        })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TIMES.map((time) => (
                    <tr key={time}>
                      <td className="py-1 pr-2 font-mono text-[10px] text-zinc-600">{time}</td>
                      {next14Days.slice(0, 7).map((date) => {
                        const key = `${date}-${time}`;
                        const booked = bookedKeys.has(key);
                        return (
                          <td key={date} className="px-1 py-1">
                            <button
                              type="button"
                              disabled={booked}
                              onClick={() => toggleSlot(date, time)}
                              title={booked ? "Booked" : undefined}
                              className={`h-8 w-full rounded transition ${
                                booked
                                  ? "cursor-not-allowed border border-zinc-700 bg-zinc-800"
                                  : isSelected(date, time)
                                    ? "border border-emerald-400/60 bg-emerald-400/30"
                                    : "border border-zinc-800 bg-zinc-950 hover:border-zinc-700"
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={saveAvailability}
              disabled={saving || selectedSlots.length === 0}
              className="mt-6 rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black disabled:opacity-50"
            >
              {saving ? "Saving..." : `Save ${selectedSlots.length} slots`}
            </button>
          </div>
        )}

        {tab === "settings" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Service type
                </label>
                <select
                  value={String(serviceProfile.service_type ?? "remote")}
                  onChange={(e) =>
                    setServiceProfile((p) => ({ ...p, service_type: e.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none"
                >
                  <option value="remote">Remote / Online</option>
                  <option value="local">Local / In-person</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  value={Number(serviceProfile.duration_minutes ?? 60)}
                  onChange={(e) =>
                    setServiceProfile((p) => ({
                      ...p,
                      duration_minutes: Number(e.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Location (if local)
                </label>
                <input
                  value={String(serviceProfile.location ?? "")}
                  onChange={(e) =>
                    setServiceProfile((p) => ({ ...p, location: e.target.value }))
                  }
                  placeholder="City, State"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none"
                />
              </div>
              <div>
                <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  Timezone
                </label>
                <select
                  value={String(serviceProfile.timezone ?? "America/New_York")}
                  onChange={(e) =>
                    setServiceProfile((p) => ({ ...p, timezone: e.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none"
                >
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-2 block font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                Service description
              </label>
              <textarea
                value={String(serviceProfile.service_description ?? "")}
                onChange={(e) =>
                  setServiceProfile((p) => ({
                    ...p,
                    service_description: e.target.value,
                  }))
                }
                placeholder="What exactly do customers get when they book?"
                rows={4}
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none"
              />
            </div>
            <button
              type="button"
              onClick={saveServiceProfile}
              disabled={saving}
              className="rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
