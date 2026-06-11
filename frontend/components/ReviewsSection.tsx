"use client";

/**
 * ReviewsSection — storefront reviews list + a write-a-review form for
 * signed-in non-owners. Backed by the existing /api/reviews endpoints:
 *   GET  /api/reviews/project/:id  (paginated list + count + average)
 *   POST /api/reviews/             (create/update; owner-blocked server-side)
 *
 * The header star summary lives on the project page header; this is the
 * full section lower on the storefront.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Review = { id: number; rating: number; comment: string; created_at: string };

function Stars({ value, className = "text-sm" }: { value: number; className?: string }) {
  const full = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className={className} aria-label={`${value} out of 5 stars`}>
      <span className="text-amber-400">{"★".repeat(full)}</span>
      <span className="text-secondary">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function ReviewsSection({
  projectId,
  isOwner,
  isAuthenticated,
  getToken,
  onLogin,
}: {
  projectId: string;
  isOwner: boolean;
  isAuthenticated: boolean;
  getToken: () => Promise<string | null>;
  onLogin: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/reviews/project/${encodeURIComponent(projectId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setReviews(data.reviews || []);
        setAvg(data.average_rating || 0);
        setCount(data.count || 0);
      }
    } catch {
      /* leave empty on failure */
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Please sign in to leave a review.");
        return;
      }
      const res = await fetch(`${API_BASE}/api/reviews/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, rating, comment: comment.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.detail || "We couldn't save your review. Please try again.");
        return;
      }
      setComment("");
      setRating(5);
      load();
    } catch (err) {
      console.error("[reviews] submit failed", err);
      setError("Network problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto mt-10 max-w-3xl rounded-2xl border border-default bg-surface-card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-primary">Reviews</h2>
        {count > 0 && (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <Stars value={avg} />
            <span className="font-semibold text-primary">{avg.toFixed(1)}</span>
            <span>({count})</span>
          </div>
        )}
      </div>

      {!isOwner &&
        (isAuthenticated ? (
          <form onSubmit={submit} className="mt-5 rounded-xl border border-default bg-surface-muted p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-secondary">Your rating</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    aria-label={`${n} star`}
                    className={`text-xl transition ${n <= rating ? "text-amber-400" : "text-secondary hover:text-amber-400/60"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Share your experience (optional)"
              className="mt-3 w-full resize-none rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary placeholder:text-muted"
            />
            {error && (
              <p role="alert" className="mt-2 text-xs font-medium text-rose-300">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="mt-3 rounded-lg bg-brand-teal px-4 py-2 text-sm font-bold text-black transition hover:bg-brand-teal-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Posting..." : "Post review"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onLogin}
            className="mt-5 rounded-lg border border-default bg-surface-muted px-4 py-2 text-sm font-semibold text-primary transition hover:border-strong"
          >
            Sign in to leave a review
          </button>
        ))}

      <div className="mt-6 space-y-4">
        {loaded && reviews.length === 0 ? (
          <p className="text-sm text-muted">No reviews yet. Be the first to leave one.</p>
        ) : (
          reviews.map((r) => (
            <div key={r.id} className="border-t border-default pt-4 first:border-t-0 first:pt-0">
              <Stars value={r.rating} className="text-xs" />
              {r.comment && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-primary">{r.comment}</p>
              )}
              <p className="mt-1 text-[11px] text-muted">
                {new Date(r.created_at).toLocaleDateString()}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
