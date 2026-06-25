"use client";

/**
 * FollowButton — Follow / Following toggle for a shop (project), wired to the
 * existing favorites API (table name kept; "Follow" is just the UI label).
 *
 * Reuses the exact pattern the storefront uses (lib/auth useAuth → login when
 * signed out, Bearer token on POST /api/favorites/toggle). Optimistic with a
 * server reconcile + revert-on-failure. Following also opts the viewer into a
 * go-live reminder (best-effort), same as the storefront. preventDefault +
 * stopPropagation so it's safe inside a card-wide <Link>.
 */

import { useState } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import { API_BASE } from "../lib/apiBase";

export function FollowButton({
  projectId,
  initialFollowing = false,
  initialCount = 0,
  size = "sm",
}: {
  projectId: string;
  initialFollowing?: boolean;
  initialCount?: number;
  size?: "sm" | "md";
}) {
  const { user, login, getToken } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!user) { login(); return; }

    const next = !following;
    // Optimistic
    setFollowing(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/favorites/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.favorited === "boolean" && data.favorited !== next) {
        // Reconcile if the server disagreed with the optimistic flip.
        setFollowing(data.favorited);
        setCount((c) => Math.max(0, c + (data.favorited ? 1 : -1) - (next ? 1 : -1)));
      }
      // Following opts into a go-live alert (best-effort, deduped server-side).
      if ((data.favorited ?? next) && user.email) {
        fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/live-reminders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email }),
        }).catch(() => {});
      }
    } catch {
      // Revert
      setFollowing(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }

  const pad = size === "md" ? "px-3.5 py-1.5 text-xs" : "px-2.5 py-1 text-[10px]";
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full border font-bold uppercase tracking-[0.06em] transition ${pad} ${
        following
          ? "border-brand-teal/40 bg-brand-teal-soft text-brand-navy"
          : "border-default bg-surface-card text-secondary hover:border-strong hover:text-primary"
      }`}
    >
      {following ? "Following" : "Follow"}
      {count > 0 && <span className="opacity-70">· {count}</span>}
    </button>
  );
}
