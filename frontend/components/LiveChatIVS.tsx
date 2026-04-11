"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "host" | "viewer";
  body: string;
  created_at: number;
}

interface LiveChatIVSProps {
  projectId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}

export function LiveChatIVS({ projectId, userId, userName, isHost }: LiveChatIVSProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function connect() {
      const wsProtocol = API_BASE.startsWith("https") ? "wss" : "ws";
      const wsHost = API_BASE.replace(/^https?:\/\//, "");
      const url = `${wsProtocol}://${wsHost}/api/auction-ws/events/${projectId}`;
      console.log("[live-chat] Connecting:", url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[live-chat] Connected");
        setConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "chat") {
            setMessages((prev) => [...prev.slice(-199), msg.data as ChatMessage]);
          } else if (msg.type === "viewer_count") {
            setViewerCount(msg.data.count);
          }
        } catch {}
      };

      ws.onclose = () => {
        console.log("[live-chat] Disconnected");
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect after 2s
        reconnectRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [projectId]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: "chat",
      sender_id: userId,
      sender_name: userName || (isHost ? "Host" : "Viewer"),
      sender_role: isHost ? "host" : "viewer",
      body,
    }));
    setInput("");
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden" style={{ height: 360 }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Live Chat</span>
          {connected && (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-600">
          <span>{viewerCount} watching</span>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-zinc-700">Say something...</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className="text-sm leading-relaxed">
            <span className={`mr-1.5 font-semibold ${
              msg.sender_role === "host" ? "text-red-400" : "text-zinc-400"
            }`}>
              {msg.sender_name}
              {msg.sender_role === "host" && (
                <span className="ml-1 text-[9px] uppercase tracking-wider text-red-500/60">host</span>
              )}
            </span>
            <span className="text-zinc-300">{msg.body}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="border-t border-zinc-800 p-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={userId ? "Say something..." : "Sign in to chat"}
            disabled={!userId || !connected}
            maxLength={300}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-emerald-400/40 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!userId || !connected || !input.trim()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
