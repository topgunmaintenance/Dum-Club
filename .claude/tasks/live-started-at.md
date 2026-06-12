TASK: live-started-at

Add projects.live_started_at so live surfaces can order and time
real broadcasts. Queued follow-up from homepage-live-rail; runs
under the normal migration gate.

Requirements:
1. Migration (next free number in backend/db/migrations/):
   - ADD COLUMN live_started_at TIMESTAMPTZ NULL on projects
   - comment the column: set when a broadcast actually starts,
     cleared or left for recap purposes when it ends (decide and
     document at implementation time)
2. Backend: set live_started_at = now() in every code path that
   flips is_live to true (IVS realtime, native_mux, manual_embed,
   go-live endpoints); null it where is_live flips false if the
   recap flow does not need it.
3. LiveRail ordering: most-recently-live first, ordered by
   live_started_at DESC, replacing the inherit-feed-order default
   shipped in homepage-live-rail.
4. "Live for HH:MM" timer on the project page LIVE banner — the
   timer deliberately left out earlier because the field did not
   exist (comment near the banner in app/project/[id]/page.tsx).
   Client-side approximation was rejected as misleading for
   late-joiners; compute from live_started_at.

Rules:
- ONLY real data
- migration must be additive and backwards compatible; NULL means
  "went live before this column existed" and must render exactly
  as today (no timer, feed-order position)
- one migration, one feature, one commit

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
