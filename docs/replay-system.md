# Replay system (foundation)

What's shipped, what's deliberately deferred, and how the system grows.

## What this is

A **scaffold** for post-stream replay. The actual recording pipeline
(IVS → S3 → CDN) is not in this PR. The scaffold is:

- `projects.replay_url TEXT` + `replay_recorded_at TIMESTAMPTZ` —
  nullable columns added in migration `047_replay_url.sql`.
- `POST /api/health/replay-url` — admin-gated endpoint to set or clear
  a project's replay URL.
- Project-page render path — when `!project.is_live && project.replay_url`,
  shows a "Replay · Last live show · &lt;date&gt;" card with a
  "Watch replay →" link. Mutually exclusive with the LIVE block.

That's the entire shipped surface. The column is NULL on every existing
row → the render path is dormant by default → zero user-visible change
until someone (or something) populates the column.

## Why this is enough for now

The doctrine is "live-first commerce." Replay is genuinely useful but
not the primary buyer experience. Shipping the *display path* first
means:

1. Once the recording pipeline lands, replays appear immediately — no
   second frontend PR needed.
2. The column can be populated manually for one-off cases (a great
   show goes viral, paste the URL in the DB, done) while the automated
   pipeline is still being designed.
3. The scaffold makes no assumptions about *which* recording backend
   wins (IVS auto-record to S3 vs. composition vs. a third-party
   service) — `replay_url` is just a URL.

## Next steps (in order, when you're ready)

### Step 1 — enable IVS recording

AWS IVS Real-Time supports `AutoParticipantRecordingConfiguration` →
S3. Once IVS Real-Time itself is activated (see
`docs/IVS_ACTIVATION.md`), the recording config can be added to the
existing stage creation call in `services/ivs_realtime.py
::create_stage`.

Requires:

- A new S3 bucket for replays (pick `us-east-1` to match IVS).
- IAM permission `s3:PutObject` on that bucket for the IVS service
  role.
- A `recording_configuration_arn` passed to `client.create_stage(...)`.

Cost note: recordings are billed per GB stored + per GB egress.
Decide a retention window (e.g. 30 days) before turning this on at
scale.

### Step 2 — wire `end-stage` to write `replay_url`

When `POST /api/ivs/end-stage` fires (or via a separate
post-stream worker), look up the S3 URL of the recorded file and
write it to `projects.replay_url`. Existing endpoint
`POST /api/health/replay-url` does the DB update — call it from the
end-stage handler, or write directly. Either works.

The recording lands in S3 a few seconds after the stage ends; the
write should be either delayed (poll for the file) or event-driven
(S3 event notification → small worker). Pick the simpler one.

### Step 3 — optionally surface replays on `/discover`

A "Recent replays" rail on `/discover` is straightforward once
`replay_url IS NOT NULL` is queryable. Add a partial index then if
the result set is large enough to matter:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_with_replay
    ON projects(replay_recorded_at DESC)
    WHERE replay_url IS NOT NULL AND is_deleted = false;
```

Out of scope for the foundation PR — add when there's actual replay
volume.

### Step 4 (future) — clipping

The user-mention of "future clipping system" is real but not on this
PR. The replay foundation supports it naturally: a `clips` table with
`(project_id, replay_url, start_ms, end_ms, label)` rows can be added
later without touching `projects.replay_url`. No premature design
needed — the column shape supports clips without baking them in.

## Operator notes

- The current admin endpoint (`POST /api/health/replay-url`) is
  intentionally not surfaced in the merchant UI. Replay URLs should
  only land in the DB after a vetted recording lifecycle — merchants
  shouldn't paste arbitrary URLs.
- `replay_url` is a plain TEXT column. Anyone setting it via this
  endpoint should write a fully-qualified `https://...` URL pointing
  at a public-readable S3 object (or a CDN URL).
- Setting `replay_url: null` (or empty string) via the endpoint clears
  both columns — useful if a recording was bad and needs to be hidden.
