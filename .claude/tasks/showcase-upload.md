# Task: showcase-upload

## Goal
Merchants get a video on their shop WITHOUT going live: "Record or
upload a showcase." On a phone the button opens the camera directly
(file input with capture); on desktop it's a file picker. Founder
decisions 2026-07-06: caps 5 min / 500MB; when a merchant has both a
live replay and an upload, THEY pick which plays (no auto-priority).

## Depends on
replay-storefront-loop (the offline video player + dashboard card).

## Scope
1. Migration 088: evolve live_replays for multiple sources —
   - add `source` text NOT NULL DEFAULT 'live_recording'
     ('live_recording' | 'upload')
   - drop the UNIQUE(project_id) constraint; replace with a partial
     unique index: at most ONE row per (project_id, source)
   - add `is_active` boolean NOT NULL DEFAULT false with a partial
     unique index (one active row per project) — this is the
     merchant's "this one plays" selection
   - backfill: existing rows get source='live_recording',
     is_active = enabled
2. Backend upload flow (same bucket as recordings, uploads/ prefix):
   - POST /api/ivs/showcase-upload-url → presigned S3 PUT (owner-
     verified; content-type video/mp4|video/quicktime; max 500MB)
   - POST /api/ivs/showcase-uploaded → merchant confirms; backend
     HEADs the object, rejects >500MB, upserts the source='upload'
     row, deletes the previous upload object (one upload per
     project, same cost cap as recordings)
   - Extend replay-status to return both rows + which is active
   - POST /api/ivs/showcase-activate {project_id, source} → flips
     is_active (the picker)
3. Dashboard UI (the card built in replay-storefront-loop):
   - "Record or upload a showcase" button —
     <input type="file" accept="video/*" capture> so phones open
     the camera; upload progress; 5-min guidance copy
   - When both sources exist: two thumbnails with a "plays on your
     shop" radio (the picker)
4. Honesty rules: uploads are labeled "VIDEO" (replays keep
   "REPLAY"); never LIVE, never coral, never fake viewer counts.

## WHAT NOT TO DO
- No transcoding pipeline (mp4/mov direct playback; HLS not needed
  for MVP)
- No editing tools, filters, or thumbnails-from-video
- No Discover surfacing of showcase videos
- Do not let uploads bypass the 5-min/500MB caps server-side

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
