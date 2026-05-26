-- phase0_verify.sql
-- Read-only verification for Phase 0 livestream cost-protection.
--
-- Covers migrations 048 (telemetry tables), 054 (1% commission), and
-- 059 (last_heartbeat_at column) plus the runtime sanity checks for
-- the code changes that depend on them. Run after every Phase 0 deploy.
--
-- Each section returns one or more rows you can eyeball against the
-- "Expected" comment. Failures: STOP, diagnose, do not proceed.

-- ================================================================
-- Section 1: migration 054 (1% commission active)
-- ================================================================

-- Expected: every plan_id has commission_rate = 0.0100
-- (Pre-054 state: every row was 0.0000 -> 0% charged while UI said 1%.)
SELECT plan_id, commission_rate
  FROM public.plan_limits
 ORDER BY plan_id;

-- Sanity: no row left at 0.0000
SELECT COUNT(*) FILTER (WHERE commission_rate = 0.0000) AS zero_rate_rows
  FROM public.plan_limits;
-- expect: 0

-- ================================================================
-- Section 2: migration 048 (telemetry tables exist)
-- ================================================================

-- Expected: 4 rows (all 4 telemetry tables present)
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN ('stream_sessions','viewer_session_events','merchant_plan_limits','merchant_monthly_usage')
 ORDER BY table_name;

-- Initial row counts (will grow as merchants stream)
SELECT 'stream_sessions'        AS t, COUNT(*) FROM public.stream_sessions
UNION ALL SELECT 'viewer_session_events',  COUNT(*) FROM public.viewer_session_events
UNION ALL SELECT 'merchant_plan_limits',   COUNT(*) FROM public.merchant_plan_limits
UNION ALL SELECT 'merchant_monthly_usage', COUNT(*) FROM public.merchant_monthly_usage;

-- ================================================================
-- Section 3: migration 059 (last_heartbeat_at column)
-- ================================================================

-- Expected: column exists, type timestamptz, nullable
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='projects'
   AND column_name='last_heartbeat_at';

-- Expected: partial index exists
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname='public'
   AND indexname='idx_projects_live_heartbeat';

-- ================================================================
-- Section 4: runtime — heartbeat write is happening
-- ================================================================

-- Currently-live projects with their heartbeat freshness.
-- Expected after the new backend code is deployed AND a host is
-- actively broadcasting: last_heartbeat_at within the last ~10s.
-- Stale or NULL last_heartbeat_at = the host has gone away.
SELECT id, name, is_live, live_provider, ivs_stage_arn, live_stream_id,
       last_heartbeat_at,
       (now() - last_heartbeat_at) AS heartbeat_age,
       updated_at
  FROM public.projects
 WHERE is_live = true
 ORDER BY last_heartbeat_at NULLS LAST;

-- ================================================================
-- Section 5: runtime — telemetry is being written
-- ================================================================

-- Active stream sessions (no end_at). Expected: matches the count of
-- is_live=true projects (one row per active broadcast).
SELECT s.id, s.project_id, p.name AS project_name, s.provider,
       s.start_at, s.peak_concurrent
  FROM public.stream_sessions s
  LEFT JOIN public.projects p ON p.id = s.project_id
 WHERE s.end_at IS NULL
 ORDER BY s.start_at DESC;

-- Recent viewer-token events. Expected after Phase 0 deploy + any
-- viewer hitting a live stream: rows present.
SELECT vse.id, vse.viewer_id, vse.token_issued_at,
       p.name AS project_name
  FROM public.viewer_session_events vse
  JOIN public.stream_sessions ss ON ss.id = vse.stream_session_id
  JOIN public.projects p          ON p.id = ss.project_id
 ORDER BY vse.token_issued_at DESC
 LIMIT 20;

-- ================================================================
-- Section 6: orphaned-stream check (run on demand)
-- ================================================================

-- Same query the startup sweep uses. Expected: zero rows during
-- normal operation. Non-zero means the sweep hasn't run (Railway
-- restart pending) or a host went away between sweeps.
SELECT id, name, is_live, last_heartbeat_at, updated_at,
       CASE
         WHEN last_heartbeat_at IS NULL AND updated_at < (now() - interval '10 minutes')
           THEN 'orphan_null_heartbeat'
         WHEN last_heartbeat_at < (now() - interval '5 minutes')
           THEN 'orphan_stale_heartbeat'
         ELSE 'fresh'
       END AS classification
  FROM public.projects
 WHERE is_live = true
 ORDER BY last_heartbeat_at NULLS LAST;
