"use client";

import { useState, useRef, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "user" | "assistant";
  content: string;
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);
    try {
      const res = await fetch(`${API}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: input, stream: true }),
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
        .chat-header{padding:8px 0 20px;border-bottom:1px solid #1f1f23;margin-bottom:16px}
        .chat-title{font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.5px}
        .chat-subtitle{font-size:13px;color:#52525b;margin-top:2px}
        .messages{flex:1;overflow-y:auto;padding:4px 0;display:flex;flex-direction:column;gap:16px;scrollbar-width:thin;scrollbar-color:#27272a transparent}
        .msg-row{display:flex;gap:10px;align-items:flex-start;animation:fadeUp 0.2s ease}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .msg-row.user{flex-direction:row-reverse}
        .avatar{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:2px}
        .avatar.ai{background:#7c3aed;color:#fff}.avatar.usr{background:#27272a;color:#a1a1aa}
        .bubble{max-width:82%;padding:12px 16px;border-radius:16px;font-size:14px;line-height:1.65}
        .bubble.ai{background:#111113;border:1px solid #1f1f23;color:#e4e4e7;border-top-left-radius:4px}
        .bubble.user{background:#7c3aed;color:#fff;border-top-right-radius:4px}
        .bubble strong{color:#fff}
        .code-block{background:#0a0a0c;border:1px solid #27272a;border-radius:8px;padding:12px 14px;margin:10px 0;font-family:'SF Mono','Fira Code',monospace;font-size:12.5px;color:#a78bfa;overflow-x:auto;white-space:pre}
        .inline-code{background:#1a1a1f;color:#a78bfa;padding:1px 6px;border-radius:4px;font-family:'SF Mono',monospace;font-size:12.5px}
        .msg-h1,.msg-h2,.msg-h3{color:#fff;font-weight:700;margin:10px 0 4px}
        .msg-h1{font-size:18px}.msg-h2{font-size:16px}.msg-h3{font-size:14px;color:#a1a1aa}
        .msg-li{padding-left:16px;position:relative;margin:3px 0;color:#d4d4d8}
        .msg-li::before{content:"•";position:absolute;left:4px;color:#7c3aed}
        .msg-li.numbered::before{content:"→"}
        .msg-gap{height:8px}
        .cursor{display:inline-block;width:2px;height:14px;background:#7c3aed;margin-left:2px;animation:blink 0.8s infinite;vertical-align:middle}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
        .empty-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding-bottom:40px}
        .empty-icon{width:56px;height:56px;background:#111113;border:1px solid #27272a;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px}
        .empty-label{font-size:15px;color:#52525b;text-align:center}
        .suggestions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:500px}
        .suggestion-btn{background:#111113;border:1px solid #27272a;color:#a1a1aa;padding:8px 14px;border-radius:20px;font-size:12.5px;cursor:pointer;transition:all 0.15s}
        .suggestion-btn:hover{border-color:#7c3aed;color:#c4b5fd;background:#1a1023}
        .input-area{padding:16px 0 4px;border-top:1px solid #1f1f23}
        .input-row{display:flex;gap:8px;align-items:center;background:#111113;border:1px solid #27272a;border-radius:14px;padding:6px 6px 6px 16px;transition:border-color 0.15s}
        .input-row:focus-within{border-color:#7c3aed}
        .chat-input{flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:14px;padding:6px 0}
        .chat-input::placeholder{color:#3f3f46}
        .send-btn{background:#7c3aed;border:none;border-radius:10px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background 0.15s;flex-shrink:0}
        .send-btn:hover:not(:disabled){background:#6d28d9}
        .send-btn:disabled{opacity:0.4;cursor:not-allowed}
        .send-icon{color:#fff;font-size:16px}
        .thinking{display:flex;gap:4px;align-items:center;padding:4px 0}
        .dot{width:6px;height:6px;border-radius:50%;background:#7c3aed;opacity:0.4;animation:pulse 1.2s infinite}
        .dot:nth-child(2){animation-delay:0.2s}.dot:nth-child(3){animation-delay:0.4s}
        @keyframes pulse{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
      `}</style>
      <div className="chat-wrap">
        <div className="chat-header">
          <div className="chat-title">AI Assistant</div>
          <div className="chat-subtitle">Powered by Llama 3 · Running locally on Ollama</div>
        </div>
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⚡</div>
              <div className="empty-label">Ask anything about Solana, DUM Club, or crypto</div>
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
        <div className="input-area">
          <div className="input-row">
            <input ref={inputRef} className="chat-input" placeholder="Ask about Solana, vaults, creators..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} disabled={loading} />
            <button className="send-btn" onClick={send} disabled={loading || !input.trim()}><span className="send-icon">↑</span></button>
          </div>
        </div>
      </div>
    </>
  );
}
export const dynamic = "force-dynamic";
