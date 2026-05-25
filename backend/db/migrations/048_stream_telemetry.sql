-- 048_stream_telemetry.sql
-- Phase 0: livestream cost-protection telemetry.
--
-- ZERO enforcement. ZERO new gates. Pure observation.
-- Four new tables. All additive. No changes to existing schema.
-- RLS deny-all by default (service-role only); no public reads.
--
-- The point of this migration is to start COLLECTING data so Phase 1
-- caps can be set against real consumption instead of guesses. The
-- audit (see chat history) explicitly recommended this before any
-- enforcement work because:
--   * IVS Real-Time list pricing at $0.10/hr per viewer means a
--     theoretical 2000-viewer-hour Starter plan = $200 COGS on a
--     $29 plan
--   * actual merchant consumption is unknown; could be much lower
--   * setting caps without data either bankrupts the platform OR
--     blocks real launches
--
-- Application sites (best-effort writes, never block live path):
--   POST /api/ivs/create-stage      → INSERT stream_sessions
--   POST /api/ivs/viewer-token      → INSERT viewer_session_events
--   POST /api/ivs/end-stage         → UPDATE stream_sessions + monthly_usage
--   POST /api/projects/{id}/go-live → INSERT stream_sessions (Mux path)
--   POST /api/projects/{id}/end-live→ UPDATE stream_sessions + monthly_usage
--   stale-clear in projects.py (3 sites) → UPDATE stream_sessions
--
-- Rollback: DROP TABLE all four. The application writes are wrapped in
-- try/except, so missing tables become silent no-ops.

-- ── 1. Stream sessions: one row per stream lifecycle ──────────
CREATE TABLE IF NOT EXISTS stream_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    merchant_id          UUID REFERENCES merchants(id) ON DELETE SET NULL,
    provider             TEXT NOT NULL,           -- 'ivs_realtime' | 'native_mux' | 'manual_embed'
    stage_arn            TEXT,                    -- IVS only; NULL on Mux
    start_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_at               TIMESTAMPTZ,
    ended_reason         TEXT,                    -- 'manual' | 'stale_heartbeat' | 'host_disconnect' | null
    peak_concurrent      INTEGER NOT NULL DEFAULT 0,
    total_viewer_secs    BIGINT  NOT NULL DEFAULT 0,
    total_tokens_minted  INTEGER NOT NULL DEFAULT 0,
    total_unique_viewers INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_merchant_start
    ON stream_sessions(merchant_id, start_at DESC);

-- Partial index for the "find active session for this project" lookup
-- on every viewer-token mint. Keeps that hot-path SELECT fast even as
-- the table grows.
CREATE INDEX IF NOT EXISTS idx_stream_sessions_active_by_project
    ON stream_sessions(project_id) WHERE end_at IS NULL;

ALTER TABLE stream_sessions ENABLE ROW LEVEL SECURITY;
-- No policies = deny all. Service role bypasses RLS, which is exactly
-- what we want — telemetry is operator-only data.


-- ── 2. Viewer session events: one row per viewer-token mint ───
CREATE TABLE IF NOT EXISTS viewer_session_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stream_session_id UUID NOT NULL REFERENCES stream_sessions(id) ON DELETE CASCADE,
    viewer_id         TEXT NOT NULL,         -- privy_did or "anon-<hash>"
    token_issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- estimated_seconds is left NULL by Phase 0. A later worker can
    -- back-fill it from token TTL or explicit /viewer-leave signals.
    -- Until then the row exists purely to count token mints.
    estimated_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_viewer_session_events_session
    ON viewer_session_events(stream_session_id);

ALTER TABLE viewer_session_events ENABLE ROW LEVEL SECURITY;


-- ── 3. Per-merchant plan-limit overrides (Pro tier mostly) ────
-- Populated manually by an admin for Pro merchants. Phase 0 leaves it
-- empty; Phase 1 reads from here on every viewer-token mint, falling
-- back to env-default tier caps when a row is missing or a column NULL.
CREATE TABLE IF NOT EXISTS merchant_plan_limits (
    merchant_id              UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
    max_concurrent_viewers   INTEGER,         -- NULL = use tier default
    max_stream_duration_min  INTEGER,
    max_streams_per_day      INTEGER,
    max_monthly_viewer_hours INTEGER,
    notes                    TEXT,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE merchant_plan_limits ENABLE ROW LEVEL SECURITY;


-- ── 4. Monthly usage rollup ───────────────────────────────────
-- Fast "have you exceeded your monthly budget" lookup. Updated on
-- stream end (and by a backfill worker in the future). Composite PK
-- handles upsert semantics.
CREATE TABLE IF NOT EXISTS merchant_monthly_usage (
    merchant_id    UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    yyyymm         TEXT NOT NULL,             -- 'YYYY-MM' (UTC)
    viewer_seconds BIGINT NOT NULL DEFAULT 0,
    stream_count   INTEGER NOT NULL DEFAULT 0,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_id, yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_merchant_monthly_usage_yyyymm
    ON merchant_monthly_usage(yyyymm);

ALTER TABLE merchant_monthly_usage ENABLE ROW LEVEL SECURITY;
