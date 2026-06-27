"use client";

/**
 * GuestChat — lets an unauthenticated storefront visitor message the
 * merchant. Posts to POST /api/guest/conversations/:projectId/message.
 *
 * Abuse controls mirror the server: a hidden honeypot field ("hp") and a
 * min-time-on-page gate (elapsed_ms since the panel opened). The server is
 * the source of truth on rate-limiting / spam classification; this widget
 * just feeds it the signals.
 *
 * Positioned bottom-LEFT so it never overlaps AiSalesChat (bottom-right).
 */

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Sent = { sender: "guest" | "merchant"; body: string };

export function GuestChat({
  projectId,
  businessName,
}: {
  projectId: string;
  businessName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [hp, setHp] = useState(""); // honeypot — real users never see this
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const conversationId = useRef<string | null>(null);
  const openedAt = useRef<number>(0);

  function openPanel() {
    setOpen(true);
    setError(null);
    if (!openedAt.current) openedAt.current = Date.now();
  }

  // Let other surfaces (e.g. the storefront header's "Message" button)
  // open this panel without prop-drilling — they dispatch a window event.
  useEffect(() => {
    const handler = () => openPanel();
    window.addEventListener("dum:message-shop", handler);
    return () => window.removeEventListener("dum:message-shop", handler);
  }, []);

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    if (text.length > 2000) {
      setError("Message is too long (2000 characters max).");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/guest/conversations/${encodeURIComponent(projectId)}/message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            name: name.trim() || null,
            email: email.trim() || null,
            hp,
            elapsed_ms: openedAt.current ? Date.now() - openedAt.current : null,
            conversation_id: conversationId.current,
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 429) {
          setError("You've sent a few messages already. Please try again in a little while.");
        } else {
          const j = await res.json().catch(() => null);
          setError(j?.detail || "We couldn't send your message. Please try again.");
        }
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.conversation_id) conversationId.current = data.conversation_id;
      setSent((prev) => [...prev, { sender: "guest", body: text }]);
      setMessage("");
    } catch (err) {
      console.error("[guest-chat] send failed", err);
      setError("Network problem. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label={`Message ${businessName || "the shop"}`}
        className="fixed bottom-6 left-4 z-[80] flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/95 px-3.5 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-md transition-all duration-200 hover:scale-105 md:left-6"
      >
        <span className="text-base">💬</span>
        <span className="text-xs font-semibold text-zinc-200">Message the shop</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-4 z-[80] flex w-[calc(100vw-2rem)] max-w-[360px] flex-col rounded-2xl border border-zinc-800 bg-zinc-950/98 shadow-[0_16px_56px_rgba(0,0,0,0.55)] backdrop-blur-md md:left-6">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="text-sm font-bold text-zinc-100">
          Message {businessName || "the shop"}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-lg leading-none text-zinc-500 transition hover:text-zinc-200"
        >
          ×
        </button>
      </div>

      <div className="max-h-[40vh] overflow-y-auto px-4 py-3">
        {sent.length === 0 ? (
          <p className="text-xs leading-relaxed text-zinc-400">
            Send a question or request and the shop will get back to you.
            Leave your email if you'd like a reply.
          </p>
        ) : (
          <div className="space-y-2">
            {sent.map((m, i) => (
              <div
                key={i}
                className="ml-auto max-w-[85%] rounded-lg bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100"
              >
                {m.body}
              </div>
            ))}
            <p className="pt-1 text-[11px] text-zinc-500">
              Sent. The shop will see your message in their inbox.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-zinc-800 px-4 py-3">
        {/* Honeypot — visually hidden, off-screen, not announced. Bots fill
            it; real users never see it. */}
        <input
          type="text"
          name="website"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600"
          />
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your message"
          rows={3}
          maxLength={2000}
          className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-600"
        />
        {error && (
          <p role="alert" className="text-[11px] font-medium text-rose-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={send}
          disabled={sending || !message.trim()}
          className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? "Sending..." : "Send message"}
        </button>
      </div>
    </div>
  );
}
