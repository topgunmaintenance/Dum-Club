-- 041_investor_leads.sql
-- Investor lead capture: emails submitted via the "Join Investor
-- Updates" form on /investors. Each row represents one opt-in.
--
-- Public POST endpoint (no auth) writes here via the regular
-- service-role connection. Reads are admin-only via the dashboard
-- query editor — no anon-key SELECT permission required.

CREATE TABLE IF NOT EXISTS investor_leads (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL,
  source       text        NOT NULL DEFAULT 'investors_page',
  user_agent   text,
  referrer     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on email so a repeat-submit from the
-- same address doesn't pile up duplicate rows. We DON'T treat this
-- as a hard error in the API — it returns 200 either way so the
-- buyer doesn't have to remember whether they already signed up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_investor_leads_email_lower
  ON investor_leads (lower(email));

CREATE INDEX IF NOT EXISTS idx_investor_leads_created_at
  ON investor_leads (created_at DESC);

COMMENT ON TABLE investor_leads IS
  'Email opt-ins from the /investors page "Join Investor Updates" form.
   No PII beyond email + opt-in context. Read by admins only.';
