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
  // When provided, the chat authenticates the WebSocket with the viewer's
  // Privy token (?token=). The server then derives sender id + host role
  // from the verified token (not the client), gates sending to signed-in
  // users, and honors host bans. Guests (no token) can still watch.
  getToken?: () => Promise<string | null>;
  // Comment-to-buy: when a viewer types a claim keyword ("!buy" / "sold"),
  // the chat hands the raw text up instead of posting it, so the parent can
  // claim the pinned offer + open checkout. Optional; existing call sites
  // unchanged.
  onCommentBuy?: (text: string) => void;
  // Equal-height live module: when true the chat fills its parent cell
  // (height:100%) instead of the fixed 480px box, so video|chat read as
  // one tile side by side. Default false keeps every existing call site
  // (embed bubble, etc.) pixel-identical.
  fillHeight?: boolean;
  // Sign-in gate: when provided AND the viewer is signed out (no userId),
  // the chat shows a full-width "Sign in to chat" button that calls this
  // instead of a disabled input. Wire it to the Privy login modal. When
  // omitted, the signed-out state falls back to the disabled input.
  onRequestSignIn?: () => void;
  // overlay mode: transparent chrome for the immersive live room — no card
  // background/border/header, white text with a drop-shadow for legibility
  // over video, and a translucent input. Default false keeps every existing
  // call site (storefront, embed bubble) pixel-identical.
  overlay?: boolean;
}

// Comment-to-buy claim keywords. Matches "!buy", "buy", "!sold", "sold"
// (optionally followed by more text) at the start of the message.
const CLAIM_KEYWORD_RE = /^\s*!?(buy|sold)\b/i;

// Anonymous viewer ids carry an "anon-" prefix (set client-side in
// /embed/[businessId]/page.tsx when no Privy user is signed in). The
// chat renders these messages with a subtle "guest" tag so the host
// can read trust at a glance — authenticated users render with their
// email-prefix display name, guests render as "Guest #XXXX guest".
function isGuestSenderId(senderId: string | undefined | null): boolean {
  return typeof senderId === "string" && senderId.startsWith("anon-");
}

// Client-side send floor. Stops a chat-tab-spam keypress loop from
// pegging the websocket; the real abuse surface is server-side rate
// limiting (a follow-up). 1500ms matches the perceptual "typed reply"
// cadence — fast enough to feel responsive, slow enough to make
// scripted flooding obvious.
const SEND_MIN_INTERVAL_MS = 1500;

export function LiveChatIVS({ projectId, userId, userName, isHost, onItemUpdate, onItemSold, onViewerCountChange, getToken, onCommentBuy, fillHeight = false, onRequestSignIn, overlay = false }: LiveChatIVSProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
  const [chatError, setChatError] = useState("");
  const [input, setInput] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sendCooldown, setSendCooldown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reconnect backoff: a fixed 2s retry hammered the relay every 2s for
  // the whole outage. Back off exponentially (2s, 4s, 8s … capped at
  // 30s) and reset to 0 on a successful open.
  const reconnectAttemptsRef = useRef(0);
  const lastSendRef = useRef<number>(0);

  useEffect(() => {
    __debug && console.log("[live-chat] MOUNTED — host:", isHost, "project:", projectId, "user:", userId);

    async function connect() {
      const wsProtocol = API_BASE.startsWith("https") ? "wss" : "ws";
      const wsHost = API_BASE.replace(/^https?:\/\//, "");
      // Authenticate the socket so the server can trust who is sending +
      // enforce bans. Guests (no token) connect without it — watch only.
      let tokenParam = "";
      if (getToken) {
        try {
          const t = await getToken();
          if (t) tokenParam = `?token=${encodeURIComponent(t)}`;
        } catch {}
      }
      const url = `${wsProtocol}://${wsHost}/api/auction-ws/events/${projectId}${tokenParam}`;
      __debug && console.log("[live-chat] Connecting:", url.replace(/token=[^&]+/, "token=***"));

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        __debug && console.log("[live-chat] Connected");
        setConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "chat") {
            const incoming = msg.data as ChatMessage;
            // Dedup by id so a reconnect that replays recent history
            // can't double-post a message (or collide React keys).
            setMessages((prev) =>
              incoming?.id && prev.some((m) => m.id === incoming.id)
                ? prev
                : [...prev.slice(-199), incoming],
            );
          } else if (msg.type === "viewer_count") {
            setViewerCount(msg.data.count);
            onViewerCountChange?.(msg.data.count);
          } else if (msg.type === "item_updated" && onItemUpdate) {
            __debug && console.log("[live-chat] Item updated:", msg.data);
            onItemUpdate(msg.data as ItemUpdateEvent);
          } else if (msg.type === "user_banned") {
            const target = msg.data?.target_id;
            if (target) setBannedIds((prev) => new Set(prev).add(target));
          } else if (msg.type === "user_unbanned") {
            const target = msg.data?.target_id;
            if (target) setBannedIds((prev) => { const n = new Set(prev); n.delete(target); return n; });
          } else if (msg.type === "error") {
            const m = msg.data?.message;
            if (m) {
              setChatError(m);
              window.setTimeout(() => setChatError(""), 4000);
            }
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
          } else if (msg.type === "claim") {
            // Live "X just claimed!" feed (comment-to-buy). System line in
            // the chat rail; reuses the same broadcast plumbing as item_sold.
            const d = msg.data || {};
            const left = typeof d.remaining === "number" ? ` (${d.remaining} left)` : "";
            setMessages((prev) => [...prev.slice(-199), {
              id: `claim-${Date.now()}`,
              sender_id: "system",
              sender_name: "DUM Club",
              sender_role: "host" as const,
              body: `🛒 ${d.display_name || "Someone"} just claimed ${d.title || "the item"}!${left}`,
              created_at: Date.now() / 1000,
            }]);
          }
        } catch {}
      };

      ws.onclose = () => {
        __debug && console.log("[live-chat] Disconnected");
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect with exponential backoff (2s, 4s, 8s … cap 30s)
        // so a sustained relay outage doesn't get hammered every 2s.
        const attempt = reconnectAttemptsRef.current++;
        const delay = Math.min(2000 * 2 ** attempt, 30000);
        reconnectRef.current = setTimeout(connect, delay);
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
    if (!body) return;

    // Comment-to-buy: a claim keyword opens checkout for the pinned offer
    // instead of posting as chat. Viewers only (the host pins/sells). Runs
    // before the WS-open guard so a claim works even mid-reconnect (it's a
    // REST call, not a chat send).
    if (!isHost && onCommentBuy && CLAIM_KEYWORD_RE.test(body)) {
      onCommentBuy(body);
      setInput("");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Client-side rate limit. Bail (and visibly disable the send
    // button for the remaining window) if the user clicks/Enters
    // faster than SEND_MIN_INTERVAL_MS.
    const now = Date.now();
    const sinceLast = now - lastSendRef.current;
    if (sinceLast < SEND_MIN_INTERVAL_MS) {
      setSendCooldown(true);
      window.setTimeout(() => setSendCooldown(false), SEND_MIN_INTERVAL_MS - sinceLast);
      return;
    }
    lastSendRef.current = now;
    setSendCooldown(true);
    window.setTimeout(() => setSendCooldown(false), SEND_MIN_INTERVAL_MS);

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
        // fillHeight is used ONLY by the embed modal, whose chat lives in a
        // fixed-height (100dvh) overflow-hidden column. The old hard
        // minHeight:480 made this box taller than its cell on short overlay
        // viewports, so the cell clipped the bottom — the message input /
        // "Sign in to chat" row — off-screen. In fillHeight mode drop the
        // floor so the box exactly fills its cell (the messages area below
        // absorbs the squeeze and scrolls), keeping the input always visible.
        // Non-fillHeight callers (the 480px box) are unchanged.
        minHeight: overlay ? 0 : fillHeight ? 0 : 480,
        height: overlay ? "auto" : fillHeight ? "100%" : 480,
        maxHeight: overlay ? "44vh" : fillHeight ? "none" : "70vh",
        border: overlay ? "none" : "1px solid #27272a",
        borderRadius: overlay ? 0 : 16,
        background: overlay ? "transparent" : "#0a0a0a",
        position: "relative",
        zIndex: 10,
        opacity: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header — hidden in overlay mode (the live room's top bar already
          shows LIVE + the viewer count). */}
      {!overlay && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #27272a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>LIVE CHAT</span>
            {connected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />}
          </div>
          <span style={{ fontSize: 11, color: "#71717a" }}>{viewerCount} watching</span>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 12px",
          minHeight: overlay ? 0 : fillHeight ? 0 : 260,
          // Drop-shadow keeps white chat text readable over any video frame.
          textShadow: overlay ? "0 1px 3px rgba(0,0,0,0.85)" : undefined,
        }}
      >
        {messages.length === 0 && (
          <div style={{ display: "flex", height: "100%", minHeight: 200, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
            <p style={{ fontSize: 13, color: "#a1a1aa", lineHeight: 1.5 }}>
              {connected ? "Be the first to say something." : "Connecting to live chat..."}
            </p>
          </div>
        )}
        {messages.map((msg) => {
          // Hide anyone the host has banned (server broadcasts user_banned).
          if (bannedIds.has(msg.sender_id)) return null;
          const guest =
            msg.sender_role === "viewer" && isGuestSenderId(msg.sender_id);
          // Host can ban a real (non-host, non-guest, non-system) sender.
          // The server re-verifies the requester is the host, so a spoofed
          // isHost prop can't actually ban anyone.
          const canBan =
            isHost &&
            msg.sender_role !== "host" &&
            !!msg.sender_id &&
            msg.sender_id !== "system" &&
            !isGuestSenderId(msg.sender_id);
          return (
            <div key={msg.id} style={{ fontSize: 14, lineHeight: 1.6 }}>
              <span style={{
                fontWeight: 600,
                color: msg.sender_role === "host"
                  ? "#f87171"
                  : guest ? "#8a8a92" : "#a1a1aa",
                marginRight: 6,
              }}>
                {msg.sender_name}
                {msg.sender_role === "host" && (
                  <span style={{ fontSize: 9, color: "#ef444480", marginLeft: 4 }}>HOST</span>
                )}
                {guest && (
                  <span style={{
                    fontSize: 9,
                    color: "#71717a",
                    marginLeft: 4,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}>guest</span>
                )}
              </span>
              <span style={{ color: overlay ? "#ffffff" : "#d4d4d8" }}>{msg.body}</span>
              {canBan && (
                <button
                  type="button"
                  onClick={() => wsRef.current?.send(JSON.stringify({ type: "ban", target_id: msg.sender_id }))}
                  title="Ban this viewer from chat"
                  style={{ marginLeft: 6, fontSize: 9, color: "#71717a", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  ban
                </button>
              )}
            </div>
          );
        })}
      </div>

      {chatError && (
        <div style={{ padding: "6px 12px", fontSize: 12, color: "#f87171", borderTop: "1px solid #27272a" }}>
          {chatError}
        </div>
      )}

      {/* Input — signed-out viewers can READ chat but not POST. Instead
          of a greyed-out box, show one full-width "Sign in to chat"
          button that opens the Privy modal (onRequestSignIn). After
          login the parent passes a real userId and this re-renders to
          the working input with no reload. When onRequestSignIn isn't
          provided (e.g. the embed bubble), fall back to the disabled
          input so nothing breaks. */}
      {!userId && onRequestSignIn ? (
        <div style={{ borderTop: overlay ? "none" : "1px solid #27272a", padding: 8 }}>
          <button
            type="button"
            onClick={onRequestSignIn}
            style={{
              width: "100%",
              minHeight: 44,
              borderRadius: 8,
              background: "#10b981",
              padding: "12px 18px",
              fontSize: 14,
              fontWeight: 700,
              color: "#000",
              border: "none",
              cursor: "pointer",
            }}
          >
            Sign in to chat
          </button>
        </div>
      ) : (
        <form onSubmit={sendMessage} style={{ borderTop: overlay ? "none" : "1px solid #27272a", padding: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                !connected
                  ? "Connecting…"
                  : "Say something..."
              }
              disabled={!userId || !connected}
              maxLength={300}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: overlay ? 9999 : 8,
                border: overlay ? "1px solid rgba(255,255,255,0.25)" : "1px solid #27272a",
                background: overlay ? "rgba(0,0,0,0.45)" : "#18181b",
                padding: "10px 14px",
                fontSize: 14,
                color: "#fff",
                outline: "none",
                opacity: (!userId || !connected) ? 0.4 : 1,
              }}
            />
            <button
              type="submit"
              disabled={!userId || !connected || !input.trim() || sendCooldown}
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
                opacity: (!userId || !connected || !input.trim() || sendCooldown) ? 0.3 : 1,
              }}
            >
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
