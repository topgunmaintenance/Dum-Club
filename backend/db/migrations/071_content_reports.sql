-- 071_content_reports.sql
-- Trust & safety: let any viewer report a live stream / storefront for
-- operator review. This is the buildable slice of moderation — real-time
-- chat ban/mute is intentionally NOT built here because the live chat
-- transport (auction_ws) carries client-supplied, unauthenticated
-- sender ids, so a per-id ban would be trivially evaded. Reports feed an
-- operator review queue instead and don't depend on chat identity.
--
-- Written by the API via the service-role client; RLS denies anon/
-- authenticated direct access (operators read via service role / admin),
-- matching the deny-all posture established in migration 062.

CREATE TABLE IF NOT EXISTS content_reports (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID,
    reporter_privy_id  TEXT,                          -- nullable: reports can be anonymous
    reason             TEXT NOT NULL,                 -- spam | scam | inappropriate | counterfeit | other
    details            TEXT,
    status             TEXT NOT NULL DEFAULT 'open',  -- open | reviewed | actioned | dismissed
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status
    ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_project
    ON content_reports (project_id);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- Deny-all to anon/authenticated; the API uses the service-role client
-- (bypasses RLS) to insert, and operators read via service role / admin.
DROP POLICY IF EXISTS deny_all ON content_reports;
CREATE POLICY deny_all ON content_reports
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);
