"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

import { API_BASE } from "../../lib/apiBase";

const FREE_MESSAGE_LIMIT = 5;
const STORAGE_KEY = "dum_ai_messages_used";
const CONVOS_KEY = "dum_ai_conversations";

/* ── Types ─────────────────────────────────────────── */
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

/* ── Persistence helpers ───────────────────────────── */
function getUsedMessages(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
}

function incrementUsedMessages(): number {
  const next = getUsedMessages() + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CONVOS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveConversations(convos: Conversation[]) {
  localStorage.setItem(CONVOS_KEY, JSON.stringify(convos));
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function titleFromMessage(msg: string): string {
  const clean = msg.replace(/\n/g, " ").trim();
  return clean.length > 40 ? clean.slice(0, 40) + "..." : clean;
}

/* ── Markdown formatter ────────────────────────────── */
function formatMessage(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`{3}[\w]*\n?([\s\S]*?)`{3}/g, '<pre class="dc-code-block"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="dc-inline-code">$1</code>')
    .replace(/^### (.*$)/gm, '<h3 class="dc-h3">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="dc-h2">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="dc-h1">$1</h1>')
    .replace(/^\d+\. (.*$)/gm, '<div class="dc-li dc-numbered">$1</div>')
    .replace(/^[-*] (.*$)/gm, '<div class="dc-li">$1</div>')
    .replace(/\n\n/g, '<div class="dc-gap"></div>')
    .replace(/\n/g, "<br/>");
}

/* ── Component ─────────────────────────────────────── */
function ChatPageInner() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [usedCount, setUsedCount] = useState(0);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatMode, setChatMode] = useState<"general" | "project">("general");
  const [currentProject, setCurrentProject] = useState<{ id: string; name: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();

  const remaining = Math.max(0, FREE_MESSAGE_LIMIT - usedCount);
  const limitReached = remaining <= 0;

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  /* ── Init ────────────────────────────────────────── */
  useEffect(() => {
    setUsedCount(getUsedMessages());
    const saved = loadConversations();
    setConversations(saved);
    if (saved.length > 0) setActiveId(saved[0].id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ── Load project from URL params ───────────────── */
  useEffect(() => {
    const projectId = searchParams.get("project_id");
    if (!projectId) {
      setCurrentProject(null);
      setChatMode("general");
      return;
    }
    setChatMode("project");
    fetch(`${API_BASE}/api/projects/${projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setCurrentProject({ id: data.id, name: data.name || data.title || "Untitled Project" });
        }
      })
      .catch(() => setCurrentProject(null));
  }, [searchParams]);

  /* ── Auto-resize textarea ────────────────────────── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  /* ── Conversation helpers ────────────────────────── */
  const persist = useCallback((convos: Conversation[]) => {
    setConversations(convos);
    saveConversations(convos);
  }, []);

  function newChat() {
    const c: Conversation = { id: makeId(), title: "New chat", messages: [], createdAt: Date.now() };
    const next = [c, ...conversations];
    persist(next);
    setActiveId(c.id);
    setSidebarOpen(false);
    setInput("");
  }

  function selectChat(id: string) {
    setActiveId(id);
    setSidebarOpen(false);
  }

  function deleteChat(id: string) {
    const next = conversations.filter((c) => c.id !== id);
    persist(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
  }

  /* ── Send message ────────────────────────────────── */
  const sendRef = useRef<(override?: string) => void>(() => {});

  async function send(overrideMessage?: string) {
    const msg = overrideMessage ?? input;
    if (!msg.trim() || loading) return;

    if (limitReached) {
      setShowLimitModal(true);
      return;
    }

    let convo = active;
    let convos = [...conversations];

    // Auto-create conversation on first message
    if (!convo) {
      convo = { id: makeId(), title: titleFromMessage(msg), messages: [], createdAt: Date.now() };
      convos = [convo, ...convos];
      setActiveId(convo.id);
    }

    // Title from first user message
    if (convo.messages.length === 0) {
      convo = { ...convo, title: titleFromMessage(msg) };
    }

    const userMsg: Message = { role: "user", content: msg };
    const assistantMsg: Message = { role: "assistant", content: "" };
    convo = { ...convo, messages: [...convo.messages, userMsg, assistantMsg] };
    convos = convos.map((c) => (c.id === convo!.id ? convo! : c));
    persist(convos);

    setInput("");
    setLoading(true);

    const newUsed = incrementUsedMessages();
    setUsedCount(newUsed);

    try {
      const res = await fetch(`${API_BASE}/api/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, project_id: currentProject?.id ?? null, stream: true }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
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
            full += token;
            const snapshot = full;
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== convo!.id) return c;
                const msgs = [...c.messages];
                msgs[msgs.length - 1] = { role: "assistant", content: snapshot };
                return { ...c, messages: msgs };
              })
            );
          }
        }
      }
      // Final save
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== convo!.id) return c;
          const msgs = [...c.messages];
          msgs[msgs.length - 1] = { role: "assistant", content: full };
          return { ...c, messages: msgs };
        });
        saveConversations(updated);
        return updated;
      });
    } catch {
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id !== convo!.id) return c;
          const msgs = [...c.messages];
          msgs[msgs.length - 1] = { role: "assistant", content: "Something went wrong." };
          return { ...c, messages: msgs };
        });
        saveConversations(updated);
        return updated;
      });
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  sendRef.current = send;

  const suggestions: { label: string; prompt: string }[] = [
    {
      label: "Growth Plan",
      prompt: "Create a detailed growth strategy for my project. Include user acquisition channels, community building tactics, key milestones for the first 90 days, and metrics to track progress.",
    },
    {
      label: "Rewards Strategy",
      prompt: "Design a DUM Points rewards strategy for my business. Cover how to attract customers, encourage repeat purchases, structure offer tiers, and use loyalty rewards to grow long-term value.",
    },
    {
      label: "Launch Strategy",
      prompt: "Build a step-by-step launch plan for my project. Include pre-launch hype tactics, launch day execution, post-launch momentum strategies, and a timeline with key deliverables.",
    },
    {
      label: "Monetization",
      prompt: "Outline a monetization strategy for my project. Include revenue streams, pricing models, fee structures, and how to balance free and premium features for sustainable growth.",
    },
    {
      label: "Marketing Ideas",
      prompt: "Generate creative marketing ideas for my project. Include social media campaigns, influencer strategies, community engagement tactics, and low-budget high-impact approaches.",
    },
  ];

  function sendPrompt(prompt: string) {
    setInput(prompt);
    // Use a microtask so state updates before send() reads input
    setTimeout(() => {
      sendRef.current(prompt);
    }, 0);
  }

  /* ── Render ──────────────────────────────────────── */
  return (
    <>
      <style jsx global>{`
        /* ── Layout ──────────────────────────────── */
        .dc-page{display:flex;height:calc(100vh - 92px);overflow:hidden;background:#08071A}
        @media(max-width:1023px){.dc-page{height:calc(100vh - 72px)}}

        /* ── Sidebar ─────────────────────────────── */
        .dc-sidebar{width:280px;flex-shrink:0;display:flex;flex-direction:column;background:#0a0a1a;border-right:1px solid #1a1a2e;transition:transform 0.25s ease}
        @media(max-width:1023px){.dc-sidebar{position:fixed;top:0;left:0;bottom:0;z-index:40;transform:translateX(-100%)}.dc-sidebar.open{transform:translateX(0)}}
        .dc-sb-header{padding:20px 16px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a2e}
        .dc-sb-title{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.25em;color:#52525b}
        .dc-new-btn{display:flex;align-items:center;gap:6px;background:#12102a;border:1px solid #2d2557;color:#a78bfa;padding:7px 12px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit}
        .dc-new-btn:hover{background:#1a1540;border-color:#a78bfa}
        .dc-convos{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;scrollbar-color:#1a1a1a transparent}
        .dc-convo-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:all 0.12s;border:1px solid transparent;font-size:13px;color:#71717a;min-height:40px}
        .dc-convo-item:hover{background:#111;color:#a1a1aa}
        .dc-convo-item.active{background:#14102a;border-color:#2d2557;color:#e4e4e7}
        .dc-convo-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .dc-convo-delete{opacity:0;color:#52525b;cursor:pointer;padding:2px 4px;font-size:14px;transition:all 0.12s;flex-shrink:0;background:none;border:none;font-family:inherit}
        .dc-convo-item:hover .dc-convo-delete{opacity:1}
        .dc-convo-delete:hover{color:#ef4444}
        .dc-sb-footer{padding:12px 16px;border-top:1px solid #1a1a2e}
        .dc-usage-bar{height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden}
        .dc-usage-fill{height:100%;background:#a78bfa;border-radius:2px;transition:width 0.3s ease}
        .dc-usage-fill.warn{background:#fbbf24}
        .dc-usage-label{margin-top:8px;font-size:11px;color:#52525b;display:flex;justify-content:space-between}
        .dc-usage-count{color:#a78bfa;font-weight:600}
        .dc-usage-count.warn{color:#fbbf24}

        /* ── Overlay ─────────────────────────────── */
        .dc-overlay{display:none}
        @media(max-width:1023px){.dc-overlay{display:block;position:fixed;inset:0;z-index:39;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)}}

        /* ── Main area ───────────────────────────── */
        .dc-main{flex:1;display:flex;flex-direction:column;min-width:0}
        .dc-topbar{padding:14px 20px;border-bottom:1px solid #111;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}
        .dc-topbar-left{display:flex;align-items:center;gap:12px}
        .dc-topbar-right{display:flex;align-items:center;gap:10px}
        .dc-menu-btn{display:none;background:none;border:1px solid #1a1a1a;color:#71717a;width:36px;height:36px;border-radius:10px;align-items:center;justify-content:center;cursor:pointer;font-size:16px;transition:all 0.12s;font-family:inherit}
        .dc-menu-btn:hover{border-color:#333;color:#a1a1aa}
        @media(max-width:1023px){.dc-menu-btn{display:flex}}
        .dc-context{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px}
        .dc-context-dot{width:8px;height:8px;border-radius:50%;background:#a78bfa;flex-shrink:0}
        .dc-context-label{font-size:13px;font-weight:600;color:#e4e4e7;letter-spacing:-0.01em;width:100%;margin-left:16px}
        .dc-context-sub{font-size:11px;color:#71717a;margin-left:16px}
        .dc-project-tag{font-size:10px;color:#52525b;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:2px 10px;margin-left:8px;white-space:nowrap;transition:all 0.15s}
        .dc-project-tag.active{color:#a78bfa;border-color:#2d2557;background:#14102a}
        .dc-badge{display:flex;align-items:center;gap:6px;background:#12102a;border:1px solid #2d2557;border-radius:20px;padding:5px 12px;font-size:11px;font-weight:600;color:#a78bfa;white-space:nowrap;flex-shrink:0}
        .dc-badge.warn{color:#fbbf24;border-color:#3a2a0a;background:#1a1508}
        .dc-sol-balance{display:flex;align-items:center;gap:6px;background:#0a0a1a;border:1px solid #1a1a3a;border-radius:20px;padding:5px 12px;white-space:nowrap}
        .dc-sol-icon{font-size:13px;color:#9945FF}
        .dc-sol-amount{font-size:11px;font-weight:600;color:#c4b5fd}

        /* ── Mobile header ───────────────────────── */
        @media(max-width:640px){
          .dc-topbar{flex-direction:column;align-items:stretch;padding:10px 14px;gap:0;overflow:visible}
          .dc-topbar-left{gap:8px}
          .dc-topbar-right{display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;padding-top:8px;margin-top:8px;border-top:1px solid #111}
          .dc-menu-btn{width:30px;height:30px;min-width:30px;border-radius:8px;font-size:13px}
          .dc-context{flex-wrap:nowrap;gap:6px;min-width:0;flex:1}
          .dc-context-dot{width:6px;height:6px;flex-shrink:0}
          .dc-context-label{font-size:12px;margin-left:0;width:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .dc-context-sub{display:none}
          .dc-project-tag{margin-left:0;font-size:9px;padding:3px 8px;border-radius:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
          .dc-sol-balance{padding:3px 8px;border-radius:14px;flex-shrink:0}
          .dc-sol-icon{font-size:10px}
          .dc-sol-amount{font-size:9px}
          .dc-badge{padding:3px 8px;font-size:9px;border-radius:14px;flex-shrink:0}
        }

        /* ── Mode toggle ─────────────────────────── */
        .dc-mode-bar{display:flex;align-items:center;gap:4px;padding:8px 20px;border-bottom:1px solid #0e0e0e;flex-shrink:0}
        .dc-mode-btn{background:none;border:1px solid transparent;color:#3f3f46;padding:6px 14px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;font-family:inherit;letter-spacing:-0.01em}
        .dc-mode-btn:hover{color:#71717a}
        .dc-mode-btn.active{background:#14102a;border-color:#2d2557;color:#a78bfa}
        @media(max-width:640px){.dc-mode-bar{padding:5px 12px;gap:2px}.dc-mode-btn{padding:4px 10px;font-size:10px;border-radius:8px}}

        /* ── Messages ────────────────────────────── */
        .dc-messages{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#1a1a1a transparent}
        .dc-msg-list{max-width:760px;margin:0 auto;padding:28px 20px 20px;display:flex;flex-direction:column;gap:6px}
        .dc-msg{display:flex;gap:14px;padding:22px 0;animation:dc-fadeUp 0.2s ease}
        .dc-msg + .dc-msg{border-top:1px solid #141428}
        @keyframes dc-fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .dc-msg-avatar{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0;margin-top:2px}
        .dc-msg-avatar.ai{background:#14102a;border:1px solid #2d2557;color:#a78bfa}
        .dc-msg-avatar.user{background:#18181b;border:1px solid #27272a;color:#a1a1aa}
        .dc-msg-body{flex:1;min-width:0}
        .dc-msg-name{font-size:12px;font-weight:700;margin-bottom:4px;letter-spacing:0.01em}
        .dc-msg-name.ai{color:#a78bfa}
        .dc-msg-name.user{color:#71717a}
        .dc-msg-content{font-size:14.5px;line-height:1.72;color:#d4d4d8;word-wrap:break-word;overflow-wrap:break-word}
        .dc-msg-content strong{color:#fff;font-weight:600}
        .dc-code-block{background:#0a0a0a;border:1px solid #1a1a1a;border-radius:10px;padding:14px 16px;margin:12px 0;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;font-size:12.5px;color:#4ade80;overflow-x:auto;white-space:pre}
        .dc-inline-code{background:#111;color:#4ade80;padding:2px 7px;border-radius:5px;font-family:'SF Mono','Fira Code',monospace;font-size:12.5px}
        .dc-h1,.dc-h2,.dc-h3{color:#fff;font-weight:700;margin:12px 0 4px}
        .dc-h1{font-size:18px}.dc-h2{font-size:16px}.dc-h3{font-size:14px;color:#a1a1aa}
        .dc-li{padding-left:18px;position:relative;margin:4px 0;color:#d4d4d8}
        .dc-li::before{content:"•";position:absolute;left:4px;color:#16a34a}
        .dc-li.dc-numbered::before{content:"→";color:#4ade80}
        .dc-gap{height:10px}
        .dc-cursor{display:inline-block;width:2px;height:15px;background:#4ade80;margin-left:2px;animation:dc-blink 0.8s infinite;vertical-align:middle}
        @keyframes dc-blink{0%,100%{opacity:1}50%{opacity:0}}
        .dc-thinking{display:flex;gap:8px;align-items:center;padding:6px 0}
        .dc-thinking-label{font-size:12px;color:#3f3f46;font-weight:500;letter-spacing:0.01em}
        .dc-dot{width:5px;height:5px;border-radius:50%;background:#4ade80;opacity:0.3;animation:dc-pulse 1.4s ease-in-out infinite}
        .dc-dot:nth-child(2){animation-delay:0.2s}.dc-dot:nth-child(3){animation-delay:0.4s}
        @keyframes dc-pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
        .dc-msg-content .dc-streaming{animation:dc-textReveal 0.3s ease}
        @keyframes dc-textReveal{from{opacity:0.6}to{opacity:1}}
        @media(max-width:640px){
          .dc-msg-list{padding:16px 14px 10px}
          .dc-msg{gap:10px;padding:14px 0}
          .dc-msg-avatar{width:28px;height:28px;font-size:11px;border-radius:8px}
          .dc-msg-content{font-size:13.5px;line-height:1.65}
          .dc-code-block{padding:10px 12px;font-size:11.5px;border-radius:8px}
        }

        /* ── Empty state ─────────────────────────── */
        .dc-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px 80px}
        .dc-empty-icon{width:56px;height:56px;background:#12102a;border:1px solid #2d2557;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:24px}
        .dc-empty-title{font-size:24px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-bottom:10px}
        .dc-empty-sub{font-size:14px;color:#52525b;text-align:center;max-width:420px;line-height:1.7;margin-bottom:32px}
        .dc-empty-sub-full{display:inline}
        .dc-empty-sub-short{display:none}
        .dc-suggestions{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:440px;width:100%}
        .dc-sug-btn{background:#0c0a1a;border:1px solid #1e1a35;color:#71717a;padding:12px 14px;border-radius:12px;font-size:13px;cursor:pointer;transition:all 0.15s;text-align:left;line-height:1.4;font-family:inherit}
        .dc-sug-btn:hover{border-color:#2d2557;color:#a78bfa;background:#14102a}
        @media(max-width:640px){
          .dc-empty{padding:20px 16px 32px}
          .dc-empty-icon{width:40px;height:40px;font-size:18px;margin-bottom:12px;border-radius:10px}
          .dc-empty-title{font-size:18px;margin-bottom:4px}
          .dc-empty-sub{font-size:12px;line-height:1.5;margin-bottom:16px;max-width:280px}
          .dc-empty-sub-full{display:none}
          .dc-empty-sub-short{display:inline}
          .dc-suggestions{grid-template-columns:1fr 1fr 1fr;gap:5px;max-width:360px}
          .dc-sug-btn{padding:7px 6px;font-size:11px;border-radius:8px;text-align:center;line-height:1.2}
        }

        /* ── Input ───────────────────────────────── */
        .dc-input-wrap{flex-shrink:0;padding:0 20px 20px}
        .dc-input-inner{max-width:760px;margin:0 auto}
        .dc-input-box{display:flex;gap:10px;align-items:flex-end;background:#0c0a1a;border:1px solid #1e1a35;border-radius:16px;padding:12px 12px 12px 18px;transition:border-color 0.15s}
        .dc-input-box:focus-within{border-color:#7B61FF}
        .dc-input-box.disabled{opacity:0.45;cursor:not-allowed}
        .dc-textarea{flex:1;background:transparent;border:none;outline:none;color:#e4e4e7;font-size:14.5px;padding:4px 0;resize:none;line-height:1.5;font-family:inherit;min-height:24px;max-height:160px}
        .dc-textarea::placeholder{color:#333}
        .dc-send{background:#7B61FF;border:none;border-radius:12px;width:38px;height:38px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.15s;flex-shrink:0;color:#fff;font-size:17px}
        .dc-send:hover:not(:disabled){background:#8b73ff;transform:scale(1.04)}
        .dc-send:disabled{opacity:0.3;cursor:not-allowed}
        .dc-input-hint{font-size:11px;color:#27272a;text-align:center;margin-top:8px}
        @media(max-width:640px){
          .dc-input-wrap{padding:0 10px 10px}
          .dc-input-box{border-radius:12px;padding:7px 7px 7px 12px;gap:6px}
          .dc-textarea{font-size:14px;min-height:22px}
          .dc-send{width:32px;height:32px;border-radius:9px;font-size:14px}
          .dc-input-hint{font-size:10px;margin-top:4px}
        }

        /* ── Limit inline ────────────────────────── */
        .dc-limit-inline{max-width:760px;margin:0 auto 12px;border-radius:14px;border:1px solid #1a3a1a;background:#080f08;padding:20px 24px;text-align:center;animation:dc-fadeUp 0.25s ease}
        .dc-limit-inline-title{font-size:14px;font-weight:700;color:#fff}
        .dc-limit-inline-sub{font-size:12px;color:#52525b;margin-top:4px}
        .dc-limit-inline-btns{display:flex;gap:8px;justify-content:center;margin-top:14px}

        @media(max-width:640px){.dc-limit-inline{padding:14px 16px;border-radius:12px}.dc-limit-inline-title{font-size:13px}.dc-limit-inline-sub{font-size:11px}}

        /* ── Limit modal ─────────────────────────── */
        .dc-modal-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);padding:16px}
        .dc-modal{width:100%;max-width:400px;border-radius:20px;border:1px solid #1a3a1a;background:#0a0a0a;padding:40px 28px 28px;text-align:center;animation:dc-fadeUp 0.25s ease}
        .dc-modal-eyebrow{font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#4ade80}
        .dc-modal-title{margin-top:14px;font-size:20px;font-weight:900;color:#fff;line-height:1.3}
        .dc-modal-desc{margin-top:12px;font-size:14px;line-height:1.7;color:#52525b}
        .dc-btn-primary{width:100%;padding:14px;border:none;border-radius:14px;background:#4ade80;color:#000;font-family:monospace;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;cursor:pointer;transition:all 0.15s}
        .dc-btn-primary:hover{background:#22c55e}
        .dc-btn-secondary{width:100%;padding:12px;border:1px solid #1a3a1a;border-radius:14px;background:transparent;color:#4ade80;font-family:monospace;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;cursor:pointer;transition:all 0.15s}
        .dc-btn-secondary:hover{background:#0a1a0a;border-color:#4ade80}
        .dc-btn-dismiss{width:100%;padding:8px;border:none;background:transparent;color:#3f3f46;font-size:13px;cursor:pointer;transition:color 0.15s;font-family:inherit}
        .dc-btn-dismiss:hover{color:#71717a}
      `}</style>

      <div className="dc-page" style={{ position: "relative" }}>
        <Starfield count={40} />
        {/* ── Sidebar ──────────────────────────────── */}
        <aside className={`dc-sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="dc-sb-header">
            <span className="dc-sb-title">Chats</span>
            <button className="dc-new-btn" onClick={newChat}>+ New</button>
          </div>

          <div className="dc-convos">
            {conversations.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 12, color: "#27272a" }}>
                No conversations yet
              </div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`dc-convo-item${c.id === activeId ? " active" : ""}`}
                  onClick={() => selectChat(c.id)}
                >
                  <span style={{ fontSize: 14, flexShrink: 0, opacity: 0.5 }}>&#x2609;</span>
                  <span className="dc-convo-title">{c.title}</span>
                  <button
                    className="dc-convo-delete"
                    onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                    title="Delete chat"
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="dc-sb-footer">
            <div className="dc-usage-bar">
              <div
                className={`dc-usage-fill${remaining <= 1 ? " warn" : ""}`}
                style={{ width: `${(remaining / FREE_MESSAGE_LIMIT) * 100}%` }}
              />
            </div>
            <div className="dc-usage-label">
              <span>Free messages</span>
              <span className={`dc-usage-count${remaining <= 1 ? " warn" : ""}`}>
                {remaining}/{FREE_MESSAGE_LIMIT}
              </span>
            </div>
          </div>
        </aside>

        {/* ── Mobile sidebar overlay ───────────────── */}
        {sidebarOpen && <div className="dc-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* ── Main chat area ───────────────────────── */}
        <main className="dc-main">
          {/* Top bar */}
          <div className="dc-topbar">
            <div className="dc-topbar-left">
              <button className="dc-menu-btn" onClick={() => setSidebarOpen(true)}>&#9776;</button>
              <div className="dc-context">
                <span className="dc-context-dot" />
                <span className="dc-context-label">DUM AI — Powered by Claude</span>
                <span className="dc-context-sub">Built to help you grow your business</span>
              </div>
            </div>
            <div className="dc-topbar-right">
              <span className={`dc-project-tag${currentProject ? " active" : ""}`}>
                {currentProject ? `Working on: ${currentProject.name}` : "No project selected"}
              </span>
              <div className={`dc-badge${limitReached ? " warn" : ""}`}>
                {limitReached ? "0 messages left" : `${remaining} left`}
              </div>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="dc-mode-bar">
            <button
              className={`dc-mode-btn${chatMode === "general" ? " active" : ""}`}
              onClick={() => setChatMode("general")}
            >
              General Chat
            </button>
            <button
              className={`dc-mode-btn${chatMode === "project" ? " active" : ""}`}
              onClick={() => setChatMode("project")}
            >
              Project Mode
            </button>
          </div>

          {/* Messages area */}
          <div className="dc-messages">
            {messages.length === 0 ? (
              <div className="dc-empty">
                <div className="dc-empty-icon">&#x26A1;</div>
                <div className="dc-empty-title">What does your business need?</div>
                <div className="dc-empty-sub">
                  <span className="dc-empty-sub-full">DUM AI is your business co-pilot &mdash; powered by Claude. It understands offers, pricing, growth strategy, and marketing so you can sell smarter and grow faster.</span>
                  <span className="dc-empty-sub-short">DUM AI helps with selling strategy, growth, pricing, and marketing.</span>
                </div>
                <div className="dc-suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      className="dc-sug-btn"
                      onClick={() => sendPrompt(s.prompt)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dc-msg-list">
                {messages.map((m, i) => (
                  <div key={i} className="dc-msg">
                    <div className={`dc-msg-avatar ${m.role === "user" ? "user" : "ai"}`}>
                      {m.role === "user" ? "U" : "D"}
                    </div>
                    <div className="dc-msg-body">
                      <div className={`dc-msg-name ${m.role === "user" ? "user" : "ai"}`}>
                        {m.role === "user" ? "You" : "DUM AI"}
                      </div>
                      <div className="dc-msg-content">
                        {m.role === "assistant" ? (
                          <>
                            {m.content ? (
                              <span className={loading && i === messages.length - 1 ? "dc-streaming" : ""} dangerouslySetInnerHTML={{ __html: formatMessage(m.content) }} />
                            ) : (
                              <div className="dc-thinking">
                                <span className="dc-thinking-label">Thinking</span>
                                <div className="dc-dot" />
                                <div className="dc-dot" />
                                <div className="dc-dot" />
                              </div>
                            )}
                            {loading && i === messages.length - 1 && m.content && (
                              <span className="dc-cursor" />
                            )}
                          </>
                        ) : (
                          m.content
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Inline limit banner */}
          {limitReached && messages.length > 0 && !showLimitModal && (
            <div className="dc-input-wrap">
              <div className="dc-limit-inline">
                <div className="dc-limit-inline-title">You&apos;ve used your free AI messages.</div>
                <div className="dc-limit-inline-sub">Upgrade or purchase an offer to keep going.</div>
                <div className="dc-limit-inline-btns">
                  <button
                    className="dc-btn-primary"
                    style={{ width: "auto", padding: "10px 24px", fontSize: 11 }}
                    onClick={() => (window.location.href = "/upgrade")}
                  >
                    Upgrade
                  </button>
                  <button
                    className="dc-btn-secondary"
                    style={{ width: "auto", padding: "10px 24px", fontSize: 11 }}
                    onClick={() => setShowLimitModal(true)}
                  >
                    Learn more
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="dc-input-wrap">
            <div className="dc-input-inner">
              <div className={`dc-input-box${limitReached ? " disabled" : ""}`}>
                <textarea
                  ref={textareaRef}
                  className="dc-textarea"
                  placeholder={limitReached ? "Message limit reached — upgrade to continue" : "Message DUM AI..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                  }}
                  disabled={loading || limitReached}
                  rows={1}
                />
                <button className="dc-send" onClick={() => send()} disabled={loading || !input.trim() || limitReached}>
                  &#x2191;
                </button>
              </div>
              <div className="dc-input-hint">
                DUM AI can make mistakes. Verify important info.
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* ── Limit modal ──────────────────────────── */}
      {showLimitModal && (
        <div className="dc-modal-overlay" onClick={() => setShowLimitModal(false)}>
          <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dc-modal-eyebrow">You&apos;re building fast.</div>
            <h2 className="dc-modal-title">You&apos;ve used your free AI messages.</h2>
            <p className="dc-modal-desc">
              Upgrade your merchant tier for unlimited AI access.
            </p>
            <button
              className="dc-btn-primary"
              style={{ marginTop: 20 }}
              onClick={() => { setShowLimitModal(false); window.location.href = "/upgrade"; }}
            >
              Upgrade
            </button>
            <button
              className="dc-btn-dismiss"
              style={{ marginTop: 10 }}
              onClick={() => setShowLimitModal(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ background: "#050505", minHeight: "100vh" }} />}>
      <ChatPageInner />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
