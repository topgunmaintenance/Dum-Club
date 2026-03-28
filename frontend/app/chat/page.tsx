"use client";

import { useState, useRef, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "dum_ai_messages_used";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function getUsedMessages(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
}

function incrementUsedMessages(): number {
  const next = getUsedMessages() + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

function formatMessage(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`{3}[\w]*\n?([\s\S]*?)`{3}/g, '<pre class="code-block"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/^### (.*$)/gm, '<h3 class="msg-h3">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="msg-h2">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="msg-h1">$1</h1>')
    .replace(/^\d+\. (.*$)/gm, '<div class="msg-li numbered">$1</div>')
    .replace(/^[-*] (.*$)/gm, '<div class="msg-li">$1</div>')
    .replace(/\n\n/g, '<div class="msg-gap"></div>')
    .replace(/\n/g, "<br/>");
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedCount, setUsedCount] = useState(0);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const remaining = Math.max(0, FREE_MESSAGE_LIMIT - usedCount);
  const limitReached = remaining <= 0;

  useEffect(() => {
    setUsedCount(getUsedMessages());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;

    if (limitReached) {
      setShowLimitModal(true);
      return;
    }

    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    const newUsed = incrementUsedMessages();
    setUsedCount(newUsed);

    try {
      const res = await fetch(`${API}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          project_id: null,
          stream: true,
        }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const token = line.slice(6);
            if (token === "[DONE]") break;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + token };
              return updated;
            });
          }
        }
      }
    } catch (e) {
      setMessages((prev) => { const updated = [...prev]; updated[updated.length - 1] = { ...updated[updated.length - 1], content: "Something went wrong." }; return updated; });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const suggestions = ["How do I build a Solana program?","What is a crypto vault?","How does SOL staking work?","What makes DUM Club different?"];

  return (
    <>
      <style jsx global>{`
        .chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 120px);max-width:760px;margin:0 auto}
        .chat-header{padding:8px 0 20px;border-bottom:1px solid #1a2e1a;margin-bottom:16px;display:flex;align-items:flex-start;justify-content:space-between}
        .chat-header-left{display:flex;flex-direction:column}
        .chat-title{font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px}
        .chat-subtitle{font-size:13px;color:#52525b;margin-top:2px}
        .usage-badge{display:flex;align-items:center;gap:6px;background:#0a1a0a;border:1px solid #1a3a1a;border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600;color:#4ade80;white-space:nowrap;flex-shrink:0;margin-top:4px}
        .usage-badge.depleted{color:#fbbf24;border-color:#3a2a0a}
        .usage-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;flex-shrink:0}
        .usage-badge.depleted .usage-dot{background:#fbbf24}
        .messages{flex:1;overflow-y:auto;padding:4px 0;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin;scrollbar-color:#27272a transparent}
        .msg-row{display:flex;gap:10px;align-items:flex-start;animation:fadeUp 0.2s ease}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .msg-row.user{flex-direction:row-reverse}
        .avatar{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:2px}
        .avatar.ai{background:#16a34a;color:#fff}.avatar.usr{background:#27272a;color:#a1a1aa}
        .bubble{max-width:82%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.65}
        .bubble.ai{background:#111113;border:1px solid #1a2e1a;color:#e4e4e7;border-top-left-radius:4px}
        .bubble.user{background:#16a34a;color:#fff;border-top-right-radius:4px}
        .bubble strong{color:#fff}
        .code-block{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:12px 14px;margin:10px 0;font-family:'SF Mono','Fira Code',monospace;font-size:12.5px;color:#4ade80;overflow-x:auto;white-space:pre}
        .inline-code{background:#0a1a0a;color:#4ade80;padding:1px 6px;border-radius:4px;font-family:'SF Mono',monospace;font-size:12.5px}
        .msg-h1,.msg-h2,.msg-h3{color:#fff;font-weight:700;margin:10px 0 4px}
        .msg-h1{font-size:18px}.msg-h2{font-size:16px}.msg-h3{font-size:14px;color:#a1a1aa}
        .msg-li{padding-left:16px;position:relative;margin:3px 0;color:#d4d4d8}
        .msg-li::before{content:"•";position:absolute;left:4px;color:#16a34a}
        .msg-li.numbered::before{content:"→"}
        .msg-gap{height:8px}
        .cursor{display:inline-block;width:2px;height:14px;background:#4ade80;margin-left:2px;animation:blink 0.8s infinite;vertical-align:middle}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding-bottom:40px}
        .empty-icon{width:56px;height:56px;background:#0a1a0a;border:1px solid #1a3a1a;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px}
        .empty-label{font-size:15px;color:#52525b;text-align:center}
        .suggestions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:500px}
        .suggestion-btn{background:#111113;border:1px solid #1a2e1a;color:#a1a1aa;padding:8px 14px;border-radius:20px;font-size:12.5px;cursor:pointer;transition:all 0.15s}
        .suggestion-btn:hover{border-color:#16a34a;color:#4ade80;background:#0a1a0a}
        .input-area{padding:16px 0 4px;border-top:1px solid #1a2e1a}
        .input-row{display:flex;gap:8px;align-items:center;background:#111113;border:1px solid #1a2e1a;border-radius:14px;padding:6px 6px 6px 16px;transition:border-color 0.15s}
        .input-row:focus-within{border-color:#16a34a}
        .input-row.disabled{opacity:0.5;cursor:not-allowed}
        .chat-input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:14px;padding:6px 0}
        .chat-input::placeholder{color:#3f3f46}
        .send-btn{background:#16a34a;border:none;border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.15s;flex-shrink:0}
        .send-btn:hover:not(:disabled){background:#22c55e}
        .send-btn:disabled{opacity:0.4;cursor:not-allowed}
        .send-icon{color:#fff;font-size:16px}
        .thinking{display:flex;gap:4px;align-items:center;padding:4px 0}
        .dot{width:6px;height:6px;border-radius:50%;background:#16a34a;opacity:0.4;animation:pulse 1.2s infinite}
        .dot:nth-child(2){animation-delay:0.2s}.dot:nth-child(3){animation-delay:0.4s}
        @keyframes pulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
        .limit-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);padding:16px}
        .limit-modal{width:100%;max-width:400px;border-radius:20px;border:1px solid #1a3a1a;background:#0a0a0c;padding:36px 28px 28px;text-align:center;animation:fadeUp 0.25s ease}
        .limit-eyebrow{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#4ade80}
        .limit-title{margin-top:14px;font-size:20px;font-weight:900;color:#fff;line-height:1.3}
        .limit-desc{margin-top:12px;font-size:14px;line-height:1.7;color:#71717a}
        .limit-btn-primary{margin-top:20px;width:100%;padding:14px;border:none;border-radius:14px;background:#4ade80;color:#000;font-family:monospace;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;cursor:pointer;transition:background 0.15s}
        .limit-btn-primary:hover{background:#22c55e}
        .limit-btn-secondary{margin-top:10px;width:100%;padding:12px;border:1px solid #1a3a1a;border-radius:14px;background:transparent;color:#4ade80;font-family:monospace;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;cursor:pointer;transition:all 0.15s}
        .limit-btn-secondary:hover{background:#0a1a0a;border-color:#4ade80}
        .limit-btn-dismiss{margin-top:8px;width:100%;padding:8px;border:none;background:transparent;color:#3f3f46;font-size:13px;cursor:pointer;transition:color 0.15s}
        .limit-btn-dismiss:hover{color:#71717a}
        .limit-inline{margin-top:16px;border-radius:16px;border:1px solid #1a3a1a;background:#0a0a0c;padding:24px;text-align:center;animation:fadeUp 0.25s ease}
      `}</style>
      <div className="chat-wrap">
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="chat-title">DUM AI</div>
            <div className="chat-subtitle">Your AI learns your project — and helps you grow it.</div>
          </div>
          <div className={`usage-badge${limitReached ? " depleted" : ""}`}>
            <span className="usage-dot" />
            {limitReached ? "0 messages left" : `${remaining} message${remaining === 1 ? "" : "s"} left`}
          </div>
        </div>

        {/* Limit reached modal */}
        {showLimitModal && (
          <div className="limit-overlay" onClick={() => setShowLimitModal(false)}>
            <div className="limit-modal" onClick={(e) => e.stopPropagation()}>
              <div className="limit-eyebrow">You&apos;re building fast.</div>
              <h2 className="limit-title">You&apos;ve used your free AI messages.</h2>
              <p className="limit-desc">
                Upgrade for unlimited access, or hold this project&apos;s token to continue.
              </p>
              <button
                className="limit-btn-primary"
                onClick={() => { setShowLimitModal(false); window.location.href = "/upgrade"; }}
              >
                Upgrade
              </button>
              <button
                className="limit-btn-secondary"
                onClick={() => setShowLimitModal(false)}
              >
                Unlock with token
              </button>
              <button
                className="limit-btn-dismiss"
                onClick={() => setShowLimitModal(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⚡</div>
              <div className="empty-label">Ask anything about your project, Solana, or growth strategy</div>
              <div className="suggestions">
                {suggestions.map((s) => (
                  <button key={s} className="suggestion-btn" onClick={() => { setInput(s); inputRef.current?.focus(); }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={"msg-row" + (m.role === "user" ? " user" : "")}>
                <div className={"avatar " + (m.role === "user" ? "usr" : "ai")}>{m.role === "user" ? "U" : "AI"}</div>
                <div className={"bubble " + (m.role === "user" ? "user" : "ai")}>
                  {m.role === "assistant" ? (
                    <>{m.content ? <span dangerouslySetInnerHTML={{ __html: formatMessage(m.content) }} /> : <div className="thinking"><div className="dot" /><div className="dot" /><div className="dot" /></div>}{loading && i === messages.length - 1 && m.content && <span className="cursor" />}</>
                  ) : m.content}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Inline limit state when messages exhausted */}
        {limitReached && messages.length > 0 && !showLimitModal && (
          <div className="limit-inline">
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>You&apos;ve used your free AI messages.</div>
            <div style={{ fontSize: 12, color: "#71717a", marginTop: 6 }}>Upgrade or hold the token to keep going.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "center" }}>
              <button
                className="limit-btn-primary"
                style={{ width: "auto", padding: "10px 20px", marginTop: 0, fontSize: 11 }}
                onClick={() => (window.location.href = "/upgrade")}
              >
                Upgrade
              </button>
              <button
                className="limit-btn-secondary"
                style={{ width: "auto", padding: "10px 20px", marginTop: 0, fontSize: 11 }}
                onClick={() => setShowLimitModal(true)}
              >
                Unlock with token
              </button>
            </div>
          </div>
        )}

        <div className="input-area">
          <div className={`input-row${limitReached ? " disabled" : ""}`}>
            <input
              ref={inputRef}
              className="chat-input"
              placeholder={limitReached ? "Message limit reached — upgrade to continue" : "Ask about your project, Solana, growth..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={loading || limitReached}
            />
            <button className="send-btn" onClick={send} disabled={loading || !input.trim() || limitReached}><span className="send-icon">↑</span></button>
          </div>
        </div>
      </div>
    </>
  );
}
export const dynamic = "force-dynamic";
