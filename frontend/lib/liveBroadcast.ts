import { createClient } from "./supabase/client";

export type LiveChatMessage = {
  id: string;
  user: string;
  text: string;
  type: "chat" | "system" | "reward" | "purchase";
  timestamp: number;
};

/**
 * Fire-and-forget broadcast of a system/live event onto the
 * `live:<projectId>` Supabase channel. Extracted from the (now
 * deleted) LiveChat component so its call sites keep working as
 * pure dead-code hygiene — see the live-experience UX pass. The
 * rendered live chat is LiveChatIVS (WebSocket relay); this helper
 * stays untouched so existing call sites compile unchanged.
 */
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
