"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

// Dev-only debug log — silenced in production so the demo recording
// console stays clean. NODE_ENV is inlined by Next.js's DefinePlugin
// at build time.
const __debug = process.env.NODE_ENV === "development";

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "host" | "viewer";
  body: string;
  created_at: number;
}

interface ItemUpdateEvent {
  offer_id: string;
  quantity_sold: number;
  quantity_available: number;
  unlimited_inventory: boolean;
  sold_out: boolean;
}

interface LiveChatIVSProps {
  projectId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  onItemUpdate?: (data: ItemUpdateEvent) => void;
  onItemSold?: (data: { offer_id: string; title: string }) => void;
  // Audit #4 Phase 1 (Q2) — surface the existing viewer count
  // up to the parent live banner without opening a second
  // WebSocket connection. Optional callback; existing call
  // sites work unchanged.
  onViewerCountChange?: (count: number) => void;
}

export function LiveChatIVS({ projectId, userId, userName, isHost, onItemUpdate, onItemSold, onViewerCountChange }: LiveChatIVSProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    __debug && console.log("[live-chat] MOUNTED — host:", isHost, "project:", projectId, "user:", userId);

    function connect() {
      const wsProtocol = API_BASE.startsWith("https") ? "wss" : "ws";
      const wsHost = API_BASE.replace(/^https?:\/\//, "");
      const url = `${wsProtocol}://${wsHost}/api/auction-ws/events/${projectId}`;
      __debug && console.log("[live-chat] Connecting:", url);

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        __debug && console.log("[live-chat] Connected");
        setConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "chat") {
            setMessages((prev) => [...prev.slice(-199), msg.data as ChatMessage]);
          } else if (msg.type === "viewer_count") {
            setViewerCount(msg.data.count);
            onViewerCountChange?.(msg.data.count);
          } else if (msg.type === "item_updated" && onItemUpdate) {
            __debug && console.log("[live-chat] Item updated:", msg.data);
            onItemUpdate(msg.data as ItemUpdateEvent);
          } else if (msg.type === "item_sold" && onItemSold) {
            __debug && console.log("[live-chat] Item sold:", msg.data);
            onItemSold(msg.data);
            // Show sold announcement in chat
            setMessages((prev) => [...prev.slice(-199), {
              id: `sold-${Date.now()}`,
              sender_id: "system",
              sender_name: "DUM Club",
              sender_role: "host" as const,
              body: `${msg.data.title || "Item"} just sold! 🎉`,
              created_at: Date.now() / 1000,
            }]);
          }
        } catch {}
      };

      ws.onclose = () => {
        __debug && console.log("[live-chat] Disconnected");
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

  __debug && console.log("[live-chat] RENDERING — host:", isHost, "connected:", connected, "messages:", messages.length);

  return (
    <div
      style={{
        minHeight: 400,
        border: "2px solid #ef4444",
        borderRadius: 16,
        background: "#0a0a0a",
        position: "relative",
        zIndex: 10,
        opacity: 1,
        overflow: "visible",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #27272a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>LIVE CHAT</span>
          {connected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />}
        </div>
        <span style={{ fontSize: 11, color: "#71717a" }}>{viewerCount} watching</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px", minHeight: 200 }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center" }}>
            <p style={{ fontSize: 12, color: "#3f3f46" }}>Say something...</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} style={{ fontSize: 14, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600, color: msg.sender_role === "host" ? "#f87171" : "#a1a1aa", marginRight: 6 }}>
              {msg.sender_name}
              {msg.sender_role === "host" && <span style={{ fontSize: 9, color: "#ef444480", marginLeft: 4 }}>HOST</span>}
            </span>
            <span style={{ color: "#d4d4d8" }}>{msg.body}</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} style={{ borderTop: "1px solid #27272a", padding: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={userId ? "Say something..." : "Sign in to chat"}
            disabled={!userId || !connected}
            maxLength={300}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 8,
              border: "1px solid #27272a",
              background: "#18181b",
              padding: "10px 12px",
              fontSize: 14,
              color: "#fff",
              outline: "none",
              opacity: (!userId || !connected) ? 0.4 : 1,
            }}
          />
          <button
            type="submit"
            disabled={!userId || !connected || !input.trim()}
            style={{
              minHeight: 44,
              borderRadius: 8,
              background: "#10b981",
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 700,
              color: "#000",
              border: "none",
              cursor: "pointer",
              opacity: (!userId || !connected || !input.trim()) ? 0.3 : 1,
            }}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
