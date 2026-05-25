"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

// Deterministic accent color from business name
const ACCENT_COLORS = [
  { bg: "bg-orange-400/15", text: "text-orange-400", border: "border-orange-400/20", hex: "#fb923c" },
  { bg: "bg-sky-400/15", text: "text-sky-400", border: "border-sky-400/20", hex: "#38bdf8" },
  { bg: "bg-violet-400/15", text: "text-violet-400", border: "border-violet-400/20", hex: "#a78bfa" },
  { bg: "bg-rose-400/15", text: "text-rose-400", border: "border-rose-400/20", hex: "#fb7185" },
  { bg: "bg-emerald-400/15", text: "text-emerald-400", border: "border-emerald-400/20", hex: "#34d399" },
  { bg: "bg-amber-400/15", text: "text-amber-400", border: "border-amber-400/20", hex: "#fbbf24" },
  { bg: "bg-cyan-400/15", text: "text-cyan-400", border: "border-cyan-400/20", hex: "#22d3ee" },
  { bg: "bg-pink-400/15", text: "text-pink-400", border: "border-pink-400/20", hex: "#f472b6" },
];

function getAccentFromName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

function getMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return "AI";
}

type Message = { role: "user" | "assistant"; content: string };
type OfferRef = { title: string; price_usd: number };

export function AiSalesChat({
  projectId,
  businessName,
  onScrollToOffer,
}: {
  projectId: string;
  businessName: string;
  onScrollToOffer?: (offerTitle: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<OfferRef[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  const accent = getAccentFromName(businessName);
  const monogram = getMonogram(businessName);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/ai/project-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          message: text,
          session_id: sessionIdRef.current,
          history: messages.slice(-8),
        }),
      });

      if (!res.ok) throw new Error("Failed");
      const data = await res.json();

      setMessages((prev) => [...prev, { role: "assistant", content: data.answer }]);
      if (data.offers?.length) setOffers(data.offers);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Having trouble right now. Try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  }

  // Parse offer references in AI response. detect "$XX" or offer titles
  function renderResponse(text: string) {
    if (!offers.length) return <span>{text}</span>;

    // Find offer titles mentioned in the text
    const parts: (string | { offer: OfferRef })[] = [];
    let remaining = text;

    for (const offer of offers) {
      const idx = remaining.toLowerCase().indexOf(offer.title.toLowerCase());
      if (idx !== -1) {
        if (idx > 0) parts.push(remaining.slice(0, idx));
        parts.push({ offer });
        remaining = remaining.slice(idx + offer.title.length);
      }
    }
    if (remaining) parts.push(remaining);

    if (parts.length <= 1) return <span>{text}</span>;

    return (
      <>
        {parts.map((p, i) =>
          typeof p === "string" ? (
            <span key={i}>{p}</span>
          ) : (
            <button
              key={i}
              onClick={() => onScrollToOffer?.(p.offer.title)}
              className={`inline font-semibold underline decoration-dotted underline-offset-2 transition hover:opacity-80 ${accent.text}`}
            >
              {p.offer.title}
            </button>
          )
        )}
      </>
    );
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed bottom-20 right-4 z-[80] flex items-center gap-2.5 rounded-full border md:bottom-6 md:right-6 ${accent.border} bg-zinc-950/95 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-[0_8px_40px_rgba(0,0,0,0.6)]`}
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${accent.bg} text-[11px] font-black ${accent.text} border ${accent.border}`}>
            {monogram}
          </span>
          <span className="text-[12px] font-semibold text-zinc-300">Ask {businessName.split(" ")[0]}</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-[80] flex w-[calc(100vw-2rem)] max-w-[380px] flex-col rounded-2xl border border-zinc-800 bg-zinc-950/98 shadow-[0_16px_64px_rgba(0,0,0,0.6)] backdrop-blur-md md:bottom-6 md:right-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${accent.bg} text-[10px] font-black ${accent.text} border ${accent.border}`}>
                {monogram}
              </span>
              <div>
                <div className="text-[12px] font-bold text-white">{businessName}</div>
                <div className="text-[9px] text-zinc-500">AI Assistant</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-zinc-500 transition hover:text-zinc-300">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" style={{ maxHeight: "360px", minHeight: "200px" }}>
            {messages.length === 0 && !loading && (
              <div className="py-4 text-center">
                <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${accent.bg} text-sm font-black ${accent.text} border ${accent.border}`}>
                  {monogram}
                </div>
                <div className="text-sm font-semibold text-zinc-300">How can I help?</div>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {[
                    "What do you offer?",
                    "Which should I pick?",
                    "What's most popular?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className={`rounded-full border ${accent.border} ${accent.bg} px-3 py-1.5 text-[11px] font-medium ${accent.text} transition hover:opacity-80`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "gap-2"}`}>
                {msg.role === "assistant" && (
                  <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${accent.bg} text-[7px] font-bold ${accent.text}`}>
                    {monogram}
                  </span>
                )}
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-br-sm bg-zinc-800 text-zinc-200"
                    : "rounded-bl-sm border border-zinc-800/60 bg-zinc-900/80 text-zinc-300"
                }`}>
                  {msg.role === "assistant" ? renderResponse(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2">
                <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${accent.bg} text-[7px] font-bold ${accent.text}`}>
                  {monogram}
                </span>
                <div className="rounded-xl rounded-bl-sm border border-zinc-800/60 bg-zinc-900/80 px-3 py-2">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" style={{ animationDelay: "0.15s" }} />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" style={{ animationDelay: "0.3s" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} className="border-t border-zinc-800 px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={loading}
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-[13px] text-white placeholder-zinc-600 outline-none transition focus:border-zinc-600 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-30 ${accent.bg} ${accent.text} border ${accent.border}`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 8.5l6-6v4h7v4h-7v4z" /></svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
