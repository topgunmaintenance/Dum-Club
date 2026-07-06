# Task: replay-recording-infra

## Goal
Record live shows so they can replay later. Backend only: enable
IVS Real-Time composite recording to S3 for merchant stages, store
the resulting playback URL per project, keep costs capped.

## Founder decisions (2026-07-06)
- Replay-first strategy: recordings of real past shows are the MVP
  source for the always-on loop. Merchant uploads are Phase 2 (a
  separate future task; do not build upload UI here).
- Replay viewer-hours meter against the tier budget exactly like
  live viewer-hours (see replay-viewer-hour-metering task).

## Scope
1. Lift the recording guardrail in
   backend/services/ivs_realtime.py DELIBERATELY:
   - Replace the assert with an explicit opt-in path (e.g.
     RECORDING_ENABLED env flag + per-merchant opt-in column).
   - Keep the docstring's cost warning; update it to describe the
     new cost contract below.
2. Cost contract (this is the guardrail's replacement):
   - Keep ONE recording per project: when a new recording lands,
     delete the previous object (or use an S3 lifecycle rule +
     latest-pointer). Storage exposure per merchant stays ~1-2GB.
   - Recordings go to a dedicated bucket/prefix with a lifecycle
     rule as a backstop (e.g. expire after 14 days).
3. New migration: `live_replays` table (or columns on projects) —
   project_id, s3_key/playback_url, duration_seconds, recorded_at,
   enabled (merchant's "loop my last show" toggle, default false).
4. Webhook/completion handling: when IVS finishes writing the
   composite, resolve the playback URL and upsert the row.
5. Merchant API: endpoint to toggle `enabled` (the dashboard UI
   wires up in replay-storefront-loop, not here).

## WHAT NOT TO DO
- No frontend changes in this task.
- No upload flow, no transcoding pipeline.
- Do not enable recording for stages by default — opt-in only.
- Do not remove the cost documentation; update it.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
