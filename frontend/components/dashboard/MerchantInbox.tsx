"use client";

/**
 * MerchantInbox — dashboard panel listing guest-chat conversations for the
 * merchant's storefront(s) and letting them reply. Backed by:
 *   GET  /api/guest/conversations/:projectId
 *   GET  /api/guest/conversations/:projectId/:conversationId/messages
 *   POST /api/guest/conversations/:projectId/:conversationId/reply
 *
 * Display name is hardcoded "Guest Customer" server-side; this UI just
 * renders what the API returns.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../lib/apiBase";

type ProjectLite = { id: string | number; name: string };
type Conversation = {
  id: string;
  status: string;
  guest_email: string | null;
  last_message_at: string | null;
  display_name: string;
};
type Message = { id: string; sender: "guest" | "merchant"; body: string; created_at: string };

export function MerchantInbox({
  projects,
  getToken,
}: {
  projects: ProjectLite[];
  getToken: () => Promise<string | null>;
}) {
  const [projectId, setProjectId] = useState<string>(
    projects[0] ? String(projects[0].id) : "",
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const loadConversations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/guest/conversations/${encodeURIComponent(projectId)}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError("Couldn't load messages. Please try again.");
        setConversations([]);
        return;
      }
      setConversations(await res.json());
    } catch (err) {
      console.error("[inbox] load conversations failed", err);
      setError("Couldn't load messages. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [projectId, authHeaders]);

  useEffect(() => {
    loadConversations();
    setActiveId(null);
    setMessages([]);
  }, [loadConversations]);

  async function openConversation(convId: string) {
    setActiveId(convId);
    setMessages([]);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/guest/conversations/${encodeURIComponent(projectId)}/${encodeURIComponent(convId)}/messages`,
        { headers: await authHeaders() },
      );
      if (!res.ok) {
        setError("Couldn't open that conversation. Please try again.");
        return;
      }
      setMessages(await res.json());
    } catch (err) {
      console.error("[inbox] load messages failed", err);
      setError("Couldn't open that conversation. Please try again.");
    }
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/guest/conversations/${encodeURIComponent(projectId)}/${encodeURIComponent(activeId)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ message: text }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || "Couldn't send your reply. Please try again.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, sender: "merchant", body: text, created_at: new Date().toISOString() },
      ]);
      setReply("");
      loadConversations();
    } catch (err) {
      console.error("[inbox] reply failed", err);
      setError("Network problem. Please try again.");
    } finally {
      setSending(false);
    }
  }

  if (projects.length === 0) return null;

  return (
    <div className="rounded-2xl border border-default bg-surface-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.28em] text-secondary">Messages</div>
        {projects.length > 1 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-default bg-surface-muted px-2 py-1 text-xs text-primary"
          >
            {projects.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs font-medium text-rose-300">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Conversation list */}
        <div className="space-y-2">
          {loading ? (
            <div className="text-xs text-muted">Loading...</div>
          ) : conversations.length === 0 ? (
            <div className="text-xs text-muted">No messages yet.</div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  activeId === c.id
                    ? "border-brand-teal/40 bg-brand-teal-soft/30"
                    : "border-default bg-surface-muted hover:border-strong"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-primary">{c.display_name}</span>
                  {c.status === "spam" && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
                      Spam
                    </span>
                  )}
                </div>
                {c.guest_email && (
                  <div className="mt-0.5 truncate text-[11px] text-muted">{c.guest_email}</div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Thread + reply */}
        <div className="rounded-xl border border-default bg-surface-muted p-3">
          {!activeId ? (
            <div className="text-xs text-muted">Pick a conversation to read and reply.</div>
          ) : (
            <>
              <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                      m.sender === "merchant"
                        ? "ml-auto bg-brand-teal-soft/40 text-primary"
                        : "bg-surface-card text-secondary"
                    }`}
                  >
                    {m.body}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendReply();
                  }}
                  placeholder="Write a reply"
                  maxLength={2000}
                  className="min-w-0 flex-1 rounded-lg border border-default bg-surface-card px-2.5 py-1.5 text-xs text-primary placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-bold text-black transition hover:bg-brand-teal-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? "..." : "Reply"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
