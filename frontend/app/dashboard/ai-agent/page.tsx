// TODO: Phase 1 — owner-only. Staff access requires a business_members table (Phase 2).
"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../lib/auth/AuthContext";
import { API_BASE } from "../../../lib/apiBase";

type AgentState = {
  enabled: boolean;
  plan: string;
  status: string;
  config: any;
};

type Conversation = {
  id: string;
  channel: string;
  started_at: string;
  ended_at: string | null;
  customer_identifier: string | null;
  outcome: string | null;
  cost_cents: number;
};

const TABS = ["Identity", "Services", "Hours", "Tools", "Channels", "Conversations", "Embed"] as const;
type Tab = (typeof TABS)[number];

export default function AiAgentDashboard() {
  const { user, getToken } = useAuth();
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("Identity");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgent = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/ai/config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAgent({
          enabled: data.enabled,
          plan: data.plan,
          status: data.status,
          config: data.config || {},
        });
      }
    } catch {}
    setLoading(false);
  }, [getToken]);

  const fetchConversations = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/ai/conversations?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {}
  }, [getToken]);

  useEffect(() => {
    if (user) {
      fetchAgent();
      fetchConversations();
    }
  }, [user, fetchAgent, fetchConversations]);

  const updateConfig = (path: string, value: any) => {
    if (!agent) return;
    const config = JSON.parse(JSON.stringify(agent.config));
    const keys = path.split(".");
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    setAgent({ ...agent, config });
  };

  const saveConfig = async () => {
    if (!agent) return;
    const token = await getToken();
    if (!token) return;
    setSaving(true);
    setSaveMsg("");
    setErrors([]);
    try {
      const res = await fetch(`/api/ai/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ config: agent.config }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveMsg("Saved");
        setTimeout(() => setSaveMsg(""), 2000);
      } else if (res.status === 422 && data.errors) {
        setErrors(data.errors);
      } else {
        setSaveMsg("Error saving");
      }
    } catch {
      setSaveMsg("Error saving");
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060606] text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading AI Agent...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-[#060606] text-white p-8">
        <h1 className="text-2xl font-bold mb-4">AI Agent</h1>
        <p className="text-zinc-400">
          You need a merchant account to use the AI Agent.
        </p>
      </div>
    );
  }

  const c = agent.config;

  return (
    <div className="min-h-screen bg-[#060606] text-white p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">AI Agent</h1>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            agent.status === "active"
              ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700"
          }`}
        >
          {agent.enabled ? agent.status : "Disabled"}
        </span>
      </div>

      {!agent.enabled && (
        <div className="mb-6 p-4 rounded-lg bg-zinc-900 border border-zinc-800">
          <p className="text-zinc-400 text-sm">
            The AI Agent is not enabled for your business. Contact support to
            activate it.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto border-b border-zinc-800 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t whitespace-nowrap transition-colors ${
              activeTab === tab
                ? "bg-zinc-800 text-white border-b-2 border-emerald-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="mb-4 p-3 rounded bg-red-900/20 border border-red-800 text-sm">
          <p className="text-red-400 font-medium mb-1">Validation errors:</p>
          {errors.map((e, i) => (
            <p key={i} className="text-red-300">
              {e.path}: {e.message}
            </p>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div className="space-y-4">
        {activeTab === "Identity" && (
          <IdentityTab config={c} onChange={updateConfig} />
        )}
        {activeTab === "Services" && (
          <ServicesTab config={c} onChange={updateConfig} />
        )}
        {activeTab === "Hours" && (
          <HoursTab config={c} onChange={updateConfig} />
        )}
        {activeTab === "Tools" && (
          <ToolsTab config={c} onChange={updateConfig} />
        )}
        {activeTab === "Channels" && (
          <ChannelsTab config={c} onChange={updateConfig} />
        )}
        {activeTab === "Conversations" && (
          <ConversationsTab conversations={conversations} />
        )}
        {activeTab === "Embed" && <EmbedTab config={c} />}
      </div>

      {/* Save button */}
      {activeTab !== "Conversations" && activeTab !== "Embed" && (
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={saveConfig}
            disabled={saving}
            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-black font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Config"}
          </button>
          {saveMsg && (
            <span className={`text-sm ${saveMsg === "Saved" ? "text-emerald-400" : "text-red-400"}`}>
              {saveMsg}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab Components ──

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-zinc-400">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white text-sm focus:border-emerald-400 focus:outline-none"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`w-10 h-5 rounded-full transition-colors ${
          checked ? "bg-emerald-500" : "bg-zinc-700"
        }`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </div>
      <span className="text-sm text-zinc-300">{label}</span>
    </label>
  );
}

function IdentityTab({
  config,
  onChange,
}: {
  config: any;
  onChange: (path: string, value: any) => void;
}) {
  const id = config.identity || {};
  return (
    <div className="space-y-4">
      <Field
        label="Business Name"
        value={id.business_name || ""}
        onChange={(v) => onChange("identity.business_name", v)}
      />
      <Field
        label="Business Slug"
        value={id.business_slug || ""}
        onChange={(v) => onChange("identity.business_slug", v)}
        placeholder="acme-pizza"
      />
      <Field
        label="Owner Display Name"
        value={id.owner_display_name || ""}
        onChange={(v) => onChange("identity.owner_display_name", v)}
      />
      <label className="block">
        <span className="text-sm text-zinc-400">Voice Persona</span>
        <select
          value={id.voice_persona || "friendly"}
          onChange={(e) => onChange("identity.voice_persona", e.target.value)}
          className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white text-sm"
        >
          <option value="friendly">Friendly</option>
          <option value="professional">Professional</option>
          <option value="casual">Casual</option>
          <option value="concierge">Concierge</option>
        </select>
      </label>
      <Field
        label="Timezone"
        value={id.timezone || "America/New_York"}
        onChange={(v) => onChange("identity.timezone", v)}
      />
    </div>
  );
}

function ServicesTab({
  config,
  onChange,
}: {
  config: any;
  onChange: (path: string, value: any) => void;
}) {
  const services: any[] = config.scope?.services || [];

  const addService = () => {
    onChange("scope.services", [
      ...services,
      { id: `svc-${Date.now()}`, name: "", price_cents: 0 },
    ]);
  };

  const updateService = (idx: number, field: string, value: any) => {
    const updated = [...services];
    updated[idx] = { ...updated[idx], [field]: value };
    onChange("scope.services", updated);
  };

  const removeService = (idx: number) => {
    onChange("scope.services", services.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      {services.map((s, i) => (
        <div key={i} className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-zinc-400">Service {i + 1}</span>
            <button
              onClick={() => removeService(i)}
              className="text-red-400 text-sm hover:text-red-300"
            >
              Remove
            </button>
          </div>
          <Field
            label="Service ID"
            value={s.id || ""}
            onChange={(v) => updateService(i, "id", v)}
            placeholder="annual-inspection"
          />
          <Field
            label="Name"
            value={s.name || ""}
            onChange={(v) => updateService(i, "name", v)}
          />
          <Field
            label="Price (cents)"
            value={s.price_cents ?? 0}
            onChange={(v) => updateService(i, "price_cents", parseInt(v) || 0)}
            type="number"
          />
          <Field
            label="Description"
            value={s.description || ""}
            onChange={(v) => updateService(i, "description", v)}
          />
          <Field
            label="Duration (minutes)"
            value={s.duration_minutes ?? ""}
            onChange={(v) => updateService(i, "duration_minutes", parseInt(v) || 0)}
            type="number"
          />
        </div>
      ))}
      <button
        onClick={addService}
        className="px-4 py-2 border border-zinc-700 text-zinc-400 rounded hover:text-white hover:border-zinc-500 text-sm"
      >
        + Add Service
      </button>
    </div>
  );
}

function HoursTab({
  config,
  onChange,
}: {
  config: any;
  onChange: (path: string, value: any) => void;
}) {
  const hours = config.scope?.hours || {};
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  const updateDay = (day: string, field: string, value: any) => {
    const updated = { ...hours, [day]: { ...hours[day], [field]: value } };
    onChange("scope.hours", updated);
  };

  return (
    <div className="space-y-3">
      {days.map((day) => {
        const h = hours[day] || {};
        return (
          <div key={day} className="flex items-center gap-4">
            <span className="w-10 text-sm text-zinc-400 uppercase">{day}</span>
            <Toggle
              label=""
              checked={!h.closed}
              onChange={(open) => updateDay(day, "closed", !open)}
            />
            {!h.closed && (
              <>
                <input
                  type="text"
                  value={h.open || "09:00"}
                  onChange={(e) => updateDay(day, "open", e.target.value)}
                  className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-white"
                  placeholder="09:00"
                />
                <span className="text-zinc-500">·</span>
                <input
                  type="text"
                  value={h.close || "17:00"}
                  onChange={(e) => updateDay(day, "close", e.target.value)}
                  className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-white"
                  placeholder="17:00"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolsTab({
  config,
  onChange,
}: {
  config: any;
  onChange: (path: string, value: any) => void;
}) {
  const tools = config.tools || {};
  return (
    <div className="space-y-6">
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">Stripe Checkout Links</h3>
        <Toggle
          label="Enable"
          checked={tools.stripe_link?.enabled || false}
          onChange={(v) => onChange("tools.stripe_link.enabled", v)}
        />
      </div>
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">SMS</h3>
        <Toggle
          label="Enable"
          checked={tools.sms?.enabled || false}
          onChange={(v) => onChange("tools.sms.enabled", v)}
        />
        <Field
          label="Daily Send Cap"
          value={tools.sms?.daily_send_cap ?? 200}
          onChange={(v) => onChange("tools.sms.daily_send_cap", parseInt(v) || 200)}
          type="number"
        />
      </div>
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">Booking</h3>
        <Toggle
          label="Enable"
          checked={tools.booking?.enabled || false}
          onChange={(v) => onChange("tools.booking.enabled", v)}
        />
        <p className="text-xs text-zinc-500">
          Booking support ships in Phase 2. Enabling this will show the option but
          the tool will return a friendly "please call us" message.
        </p>
      </div>
    </div>
  );
}

function ChannelsTab({
  config,
  onChange,
}: {
  config: any;
  onChange: (path: string, value: any) => void;
}) {
  const ch = config.channels || {};
  return (
    <div className="space-y-6">
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">Web Chat</h3>
        <Toggle
          label="Enable"
          checked={ch.web?.enabled ?? true}
          onChange={(v) => onChange("channels.web.enabled", v)}
        />
        <Field
          label="Widget Color"
          value={ch.web?.widget_color || "#00FFA3"}
          onChange={(v) => onChange("channels.web.widget_color", v)}
        />
      </div>
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">SMS</h3>
        <Toggle
          label="Enable"
          checked={ch.sms?.enabled || false}
          onChange={(v) => onChange("channels.sms.enabled", v)}
        />
        <Toggle
          label="Auto-reply after hours"
          checked={ch.sms?.auto_reply_after_hours ?? true}
          onChange={(v) => onChange("channels.sms.auto_reply_after_hours", v)}
        />
      </div>
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg space-y-3">
        <h3 className="text-sm font-medium text-white">Voice</h3>
        <Toggle
          label="Enable"
          checked={ch.voice?.enabled || false}
          onChange={(v) => onChange("channels.voice.enabled", v)}
        />
        <Field
          label="Greeting"
          value={ch.voice?.greeting || ""}
          onChange={(v) => onChange("channels.voice.greeting", v)}
          placeholder="Hi, thanks for calling..."
        />
      </div>
    </div>
  );
}

function ConversationsTab({ conversations }: { conversations: Conversation[] }) {
  if (conversations.length === 0) {
    return <p className="text-zinc-500 text-sm">No conversations yet.</p>;
  }
  return (
    <div className="space-y-2">
      {conversations.map((c) => (
        <div
          key={c.id}
          className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between"
        >
          <div>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded ${
                c.channel === "voice"
                  ? "bg-blue-900/30 text-blue-400"
                  : c.channel === "sms"
                  ? "bg-amber-900/30 text-amber-400"
                  : "bg-emerald-900/30 text-emerald-400"
              }`}
            >
              {c.channel}
            </span>
            <span className="ml-3 text-sm text-zinc-300">
              {c.customer_identifier || "Unknown"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {c.outcome && (
              <span className="text-xs text-zinc-500">{c.outcome}</span>
            )}
            <span className="text-xs text-zinc-600">
              {new Date(c.started_at).toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmbedTab({ config }: { config: any }) {
  const slug = config.identity?.business_slug;
  if (!slug) {
    return (
      <p className="text-zinc-500 text-sm">
        Set a business slug in the Identity tab first.
      </p>
    );
  }

  const embedScript = `<script src="https://dum.club/ai/widget.js" data-business="${slug}"></script>`;
  const embedUrl = `https://dum.club/ai/embed/${slug}`;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-2">Embed Script</h3>
        <p className="text-xs text-zinc-500 mb-2">
          Paste this into your website&apos;s HTML to show a chat bubble.
        </p>
        <pre className="p-3 bg-zinc-900 border border-zinc-800 rounded text-xs text-emerald-400 overflow-x-auto">
          {embedScript}
        </pre>
      </div>
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-2">Direct Link / Iframe</h3>
        <pre className="p-3 bg-zinc-900 border border-zinc-800 rounded text-xs text-emerald-400 overflow-x-auto">
          {embedUrl}
        </pre>
      </div>
    </div>
  );
}
