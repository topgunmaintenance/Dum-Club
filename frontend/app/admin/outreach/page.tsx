"use client";

/**
 * Admin Outreach dashboard.
 *
 * Entry point for the merchant outreach layer backed by
 * backend/api/routes/outreach.py.
 *
 * Admin-gated via the existing AdminRoute component (which reads
 * useAuth().isAdmin). Users who aren't admins never see this page.
 */

import { useCallback, useEffect, useState } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";
import { API_BASE } from "../../../lib/apiBase";

type Lead = {
  id: string;
  contact: string;
  business_name: string | null;
  source: string;
  status: string;
  last_contacted_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
};

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    new:          { label: "New",          className: "border-zinc-700 bg-zinc-900 text-zinc-400" },
    contacted:    { label: "Contacted",    className: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
    replied:      { label: "Replied",      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
    onboarded:    { label: "Onboarded",    className: "border-emerald-500/50 bg-emerald-500/20 text-emerald-300" },
    bounced:      { label: "Bounced",      className: "border-red-500/30 bg-red-500/10 text-red-400" },
    unsubscribed: { label: "Unsubscribed", className: "border-zinc-700 bg-zinc-900 text-zinc-600" },
  };
  const s = map[status] || map.new;
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${s.className}`}>
      {s.label}
    </span>
  );
}

function formatRelative(iso: string | null) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function AdminOutreachInner() {
  const { getToken } = useAuth();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Add-lead form
  const [businessName, setBusinessName] = useState("");
  const [contact, setContact] = useState("");
  const [source, setSource] = useState("manual");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  // Per-row action state (send / follow-up)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<Record<string, string>>({});

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken();
      return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init.headers || {}),
        },
      });
    },
    [getToken]
  );

  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    setListError(null);
    try {
      const res = await authedFetch("/api/outreach/leads?limit=200");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to load leads (${res.status})`);
      }
      const data = await res.json();
      setLeads(Array.isArray(data.leads) ? data.leads : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load leads";
      setListError(msg);
      setLeads([]);
    }
    setLoadingLeads(false);
  }, [authedFetch]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  async function addAndSend() {
    setFormError(null);
    setFormNotice(null);
    if (!contact.trim()) {
      setFormError("Contact email is required");
      return;
    }
    setSaving(true);
    try {
      // 1. Create (or fetch existing) lead
      const createRes = await authedFetch("/api/outreach/leads", {
        method: "POST",
        body: JSON.stringify({
          contact: contact.trim(),
          business_name: businessName.trim() || undefined,
          source: source.trim() || "manual",
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(err.detail || `Create failed (${createRes.status})`);
      }
      const createData = await createRes.json();
      const leadId = createData.lead?.id;
      if (!leadId) throw new Error("Backend returned no lead id");

      // 2. Send initial outreach
      const sendRes = await authedFetch(`/api/outreach/leads/${leadId}/send`, {
        method: "POST",
        body: JSON.stringify({ template_key: "initial" }),
      });
      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        throw new Error(sendData.detail || `Send failed (${sendRes.status})`);
      }
      if (sendData.sent === false) {
        setFormNotice(
          `Lead saved${createData.created === false ? " (already existed)" : ""}, but send failed: ${sendData.send_error || "unknown"}`
        );
      } else {
        setFormNotice(
          `✓ Outreach sent to ${contact.trim()}${createData.created === false ? " (existing lead)" : ""}`
        );
      }

      // Clear the form and refresh the list
      setBusinessName("");
      setContact("");
      setSource("manual");
      await loadLeads();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  async function sendFollowUp(lead: Lead) {
    setBusyLeadId(lead.id);
    setRowNotice((prev) => ({ ...prev, [lead.id]: "Sending..." }));
    try {
      const res = await authedFetch(`/api/outreach/leads/${lead.id}/follow-up`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowNotice((prev) => ({ ...prev, [lead.id]: data.detail || "Failed" }));
      } else if (data.sent === false) {
        setRowNotice((prev) => ({ ...prev, [lead.id]: `Send failed: ${data.send_error || "unknown"}` }));
      } else {
        setRowNotice((prev) => ({
          ...prev,
          [lead.id]: `✓ ${data.template_key?.replace("followup_", "") || "follow-up"} sent`,
        }));
        await loadLeads();
      }
    } catch (err) {
      setRowNotice((prev) => ({
        ...prev,
        [lead.id]: err instanceof Error ? err.message : "Failed",
      }));
    } finally {
      setBusyLeadId(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 pt-28 px-4 pb-16">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">Admin</div>
          <h1 className="text-2xl font-bold text-white">Merchant Outreach</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manually add leads, send cold outreach, and track follow-ups. All emails
            include a one-click unsubscribe link.
          </p>
        </header>

        {/* ── Add lead form ────────────────────────────────── */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Add a lead</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Business name</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Mario's Cafe"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Contact email *</label>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="owner@marioscafe.com"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-zinc-500">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-400/40"
              >
                <option value="manual">manual</option>
                <option value="import">import</option>
                <option value="referral">referral</option>
                <option value="event">event</option>
              </select>
            </div>
          </div>

          {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}
          {formNotice && <p className="mt-3 text-sm text-emerald-400">{formNotice}</p>}

          <button
            type="button"
            onClick={addAndSend}
            disabled={saving}
            className="mt-4 w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50 sm:w-auto sm:px-6"
          >
            {saving ? "Sending..." : "Add Lead + Send Outreach"}
          </button>
        </div>

        {/* ── Leads table ───────────────────────────────────── */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              Leads {leads.length > 0 && <span className="ml-1 text-zinc-600">({leads.length})</span>}
            </h2>
            <button
              type="button"
              onClick={loadLeads}
              className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500 transition hover:text-emerald-400"
            >
              Refresh
            </button>
          </div>

          {loadingLeads ? (
            <p className="py-6 text-center text-sm text-zinc-500">Loading...</p>
          ) : listError ? (
            <p className="py-6 text-center text-sm text-red-400">{listError}</p>
          ) : leads.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No leads yet. Add one above to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
                    <th className="pb-2 pr-3">Business</th>
                    <th className="pb-2 pr-3">Contact</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Last contact</th>
                    <th className="pb-2 pr-3">Source</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const note = rowNotice[lead.id];
                    const canFollowUp =
                      lead.status !== "unsubscribed" &&
                      lead.status !== "onboarded" &&
                      !!lead.last_contacted_at;
                    return (
                      <tr key={lead.id} className="border-b border-zinc-800/60">
                        <td className="py-3 pr-3 font-semibold text-white">
                          {lead.business_name || <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="py-3 pr-3 font-mono text-[12px] text-zinc-300">{lead.contact}</td>
                        <td className="py-3 pr-3">{statusBadge(lead.status)}</td>
                        <td className="py-3 pr-3 text-[12px] text-zinc-500">{formatRelative(lead.last_contacted_at)}</td>
                        <td className="py-3 pr-3 text-[12px] text-zinc-500">{lead.source}</td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            disabled={!canFollowUp || busyLeadId === lead.id}
                            onClick={() => sendFollowUp(lead)}
                            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-400 disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-300"
                          >
                            {busyLeadId === lead.id ? "..." : "Send Follow-up"}
                          </button>
                          {note && (
                            <div className="mt-1 text-[10px] text-zinc-500">{note}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminOutreachPage() {
  return (
    <AdminRoute>
      <AdminOutreachInner />
    </AdminRoute>
  );
}
