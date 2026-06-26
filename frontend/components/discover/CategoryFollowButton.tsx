"use client";

/**
 * CategoryFollowButton — follow a category (verb) and get pinged when any shop
 * in it goes live. Shown on /discover when a real verb is selected (not "For
 * you"). Wired to /api/category-follows (Bearer auth); follow snapshots the
 * viewer's email so the go-live notifier can reach them.
 *
 * Resilient by design: the backend no-ops until the category_follows table is
 * applied, so this just stays in the "Follow" state until then.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

export function CategoryFollowButton({ category, label }: { category: string; label: string }) {
  const { user, login, getToken } = useAuth();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reflect the current follow state when signed in.
  useEffect(() => {
    if (!user) { setFollowing(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/category-follows/check/${encodeURIComponent(category)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setFollowing(!!data.following);
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [user, getToken, category]);

  async function toggle() {
    if (busy) return;
    if (!user) { login(); return; }
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/category-follows/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ category, email: user.email || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.following === "boolean") setFollowing(data.following);
    } catch {
      setFollowing(!next); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
        following
          ? "border-mint-text bg-transparent text-mint-text"
          : "border-default bg-surface-card text-primary hover:border-strong"
      }`}
    >
      <span aria-hidden="true">{following ? "✓" : "🔔"}</span>
      {following ? `Following ${label}` : `Follow ${label}`}
    </button>
  );
}
