"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";

export type LiveChatMessage = {
  id: string;
  user: string;
  text: string;
  type: "chat" | "system" | "reward" | "purchase";
  timestamp: number;
};

type LiveChatProps = {
  projectId: string;
  userName: string | null;
  isOwner: boolean;
};

export function LiveChat({ projectId, userName, isOwner }: LiveChatProps) {
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`live:${projectId}`, {
      config: { broadcast: { self: true } },
    });

    channel
      .on("broadcast", { event: "chat" }, ({ payload }) => {
        setMessages((prev) => [...prev.slice(-199), payload as LiveChatMessage]);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !channelRef.current) return;

    const msg: LiveChatMessage = {
      id: crypto.randomUUID(),
      user: userName || "Viewer",
      text,
      type: "chat",
      timestamp: Date.now(),
    };

    channelRef.current.send({ type: "broadcast", event: "chat", payload: msg });
    setInput("");
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden" style={{ height: 320 }}>
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Live Chat</span>
        <span className="text-[10px] text-zinc-600">{messages.length} messages</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-zinc-700">No messages yet</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`text-sm leading-relaxed ${
            msg.type === "system" ? "text-zinc-600 italic"
            : msg.type === "reward" ? "text-emerald-400"
            : msg.type === "purchase" ? "text-sky-400"
            : "text-zinc-300"
          }`}>
            {msg.type === "chat" && (
              <span className="mr-1.5 font-semibold text-zinc-400">{msg.user}</span>
            )}
            {msg.type === "reward" && <span className="mr-1">+</span>}
            {msg.type === "purchase" && <span className="mr-1">$</span>}
            {msg.text}
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="border-t border-zinc-800 p-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={userName ? "Say something..." : "Sign in to chat"}
            disabled={!userName}
            maxLength={280}
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none transition focus:border-emerald-400/40 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={!userName || !input.trim()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-400 disabled:opacity-30"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

/** Helper to broadcast system messages from outside the component */
export function broadcastLiveEvent(
  projectId: string,
  message: Omit<LiveChatMessage, "id" | "timestamp">,
) {
  const supabase = createClient();
  const channel = supabase.channel(`live:${projectId}`);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channel.send({
        type: "broadcast",
        event: "chat",
        payload: {
          ...message,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        },
      });
      // Unsubscribe after sending — this is a fire-and-forget helper
      setTimeout(() => supabase.removeChannel(channel), 500);
    }
  });
}
