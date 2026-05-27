# Supabase Data API grants (policy for new migrations)

Effective immediately. Required reading before writing any migration
that runs `CREATE TABLE public.<name>`.

## What changed at Supabase

Supabase is removing implicit Data API exposure for new public tables:

- **New Supabase projects** (created after 2026-05-30): `CREATE TABLE
  public.<name>` does NOT auto-grant access to the `anon` /
  `authenticated` roles. The table is invisible to PostgREST / supabase-js
  / pg_graphql until an explicit `GRANT` runs.
- **Existing Supabase projects** (Dum Club's `snzodohibhxenqwdklxs`
  included): same behavior begins **2026-10-30** for tables created on
  or after that date.
- **Existing tables keep current grants.** Nothing already in production
  loses access.

GRANTs control table-level reachability via the API; **RLS still
controls row-level access**. The two are independent layers. You need
both: a GRANT to make the table reachable, an RLS policy to decide
which rows the caller sees.

Reference: https://github.com/orgs/supabase/discussions/35573

## How this project uses Supabase

- **Backend (FastAPI on Railway)** uses the `service_role` key via
  `backend/db/supabase.py`. The service role bypasses both RLS and
  GRANTs. **Backend code is unaffected by this change.** No GRANT
  needed for backend-only tables.
- **Frontend** is split across three Supabase clients:
  - **Browser client** (`lib/supabase/client.ts`, anon key in bundle,
    upgrades to `authenticated` once the user has a session). Today it
    touches `profiles` (`lib/linkWalletToProfile.ts`), `offers`
    (`components/dashboard/PostAndGoLive.tsx`), and the `offers`
    Storage bucket. All three call sites run under an authenticated
    Privy session and rely on RLS to scope rows.
  - **SSR client** (`lib/supabase/server.ts`, cookies-bridged session).
    Today it reads `projects` from `app/project/[id]/manage/layout.tsx`
    as the server-side owner gate. Anonymous visitors hit this with no
    session, so `projects` is reachable by `anon` SELECT.
  - **Service-role client** (`lib/ai/supabase-service.ts`). Used by
    Next.js API routes (AI agent runner, guards, tools) that hit
    `merchants`, `ai_agent_*`, etc. Bypasses RLS + GRANTs.
- **FastAPI backend** uses the service-role key via `backend/db/
  supabase.py`. Same bypass.
- **Cron jobs / edge functions** that hit PostgREST directly with the
  anon or authenticated key MUST have explicit grants on the tables
  they read.

Net effect: a small set of tables (`profiles`, `offers`, `projects`)
need explicit grants for the browser/SSR clients going forward. Every
other new table is backend-only and needs **no grants at all** —
default-deny is the safe posture.

## Required pattern for new `CREATE TABLE` migrations

Every new public-schema table MUST include — in the same migration file
that runs `CREATE TABLE`:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
2. At least one `CREATE POLICY` (use the deny-all template if the table
   is backend-only).
3. An explicit `GRANT` block stating which roles can reach the table
   via the Data API — even if the answer is "none", write the block as
   a comment that says so.

### Template (copy this into every new table migration)

```sql
CREATE TABLE IF NOT EXISTS public.<table> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ...
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1. RLS is mandatory on every public-schema table.
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

-- 2. Pick ONE policy block below. Delete the others.

-- (a) BACKEND-ONLY (default. Most tables on this project.)
--     Service-role bypasses RLS, so deny_all blocks any accidental
--     anon/authenticated PostgREST hit. See migration 061 for the
--     canonical deny_all pattern.
CREATE POLICY "deny_all_<table>"
  ON public.<table>
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- (b) AUTHENTICATED USER READ/WRITE (e.g. user-owned rows)
-- CREATE POLICY "<table>_owner_read"
--   ON public.<table> FOR SELECT TO authenticated
--   USING ((SELECT auth.uid()) = owner_id);

-- (c) PUBLIC READ (e.g. a public storefront listing)
-- CREATE POLICY "<table>_public_read"
--   ON public.<table> FOR SELECT TO anon, authenticated
--   USING (true);

-- 3. Explicit GRANTs. Required from 2026-10-30 onward; harmless before.

-- (a) BACKEND-ONLY tables: no grants. Document why.
-- (No GRANT — table is consumed only via service_role from backend/.)

-- (b) AUTHENTICATED-USER tables:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.<table> TO authenticated;

-- (c) PUBLIC-READ tables:
-- GRANT SELECT ON TABLE public.<table> TO anon, authenticated;
```

## Decision tree

```
Does the frontend (browser supabase-js) call .from("<table>")
  or hit /rest/v1/<table>?
├── No  → BACKEND-ONLY. RLS + deny_all. No GRANT. (Default — pick this.)
└── Yes → Does the page require Privy login?
          ├── Yes → AUTHENTICATED. RLS policy scoped to the user.
          │        GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated.
          │        (Grant only the verbs actually used.)
          └── No  → PUBLIC READ. RLS USING (true) for SELECT only.
                   GRANT SELECT TO anon, authenticated.
                   NEVER grant write to anon.
```

## Hard rules

- **Never `GRANT ... TO anon` for INSERT / UPDATE / DELETE.** If the
  frontend needs to write, route the write through a FastAPI handler
  that uses the service-role key and enforces authorization in app
  code. There are zero exceptions in this codebase today; keep it that
  way.
- **Never `GRANT ALL ON public.<table> TO public`.** `public` is the
  pg-internal pseudo-role that includes every role; granting to it
  bypasses the policy layer entirely.
- **Never disable RLS to "fix" a missing GRANT.** GRANT and RLS solve
  different problems; you need both.
- **Don't retroactively edit historical migrations.** Migrations are
  immutable history. If existing grants need to change, write a new
  migration.

## Audit summary (as of 2026-05-27)

Scope: all 61 migrations under `backend/db/migrations/`. Source:
inventory pass over every `CREATE TABLE public.*` statement +
cross-reference against `supabase.from(...)` call sites in `frontend/`
and `backend/`.

| Bucket | Count | Status |
|---|---|---|
| Tables created in `001`–`061` | 43 | All rely on Supabase's implicit auto-grant (no migration uses an explicit `GRANT`). |
| Reached by browser `supabase-js` (anon → authenticated upgrade) | `profiles`, `offers`, `offers` Storage bucket | Authenticated-context only; RLS scopes rows. |
| Reached by SSR `supabase-js` (cookies session, can be anon) | `projects` | Owner-gate read in `/manage` layout; anonymous SELECT reachable. |
| Reached by Next.js API routes via service-role client | `merchants`, `ai_agent_conversations`, `ai_agent_phone_numbers`, `ai_agent_idempotency` | Bypasses RLS + GRANTs. |
| Reached by backend (service-role key) | All of them | Service role bypasses RLS + GRANTs; the 2026 change does not affect this path. |
| RLS enabled | 18 | Includes 11 tables hardened by migration 061. |
| RLS not enabled | 25 | Pre-existing issue, **out of scope for this GRANT policy doc**. Tracked separately — see "Follow-ups". |

**Impact of the 2026-10-30 cutoff on this project:** **none for the
existing 43 tables.** Supabase explicitly preserves grants on tables
that exist before the cutoff. The risk this policy mitigates is
**future** tables silently failing to expose to the Data API (or worse,
silently exposing PII because someone forgot the RLS step).

## Follow-ups (out of scope for this PR)

These are flagged for separate hardening work; they are not GRANT
issues and would be solved by RLS policies, not grants:

1. **25 tables created in `001`–`042` predate the RLS-by-default
   posture.** They rely on the FastAPI layer being the sole writer.
   Several (e.g. `merchants`, `offers`, `orders`, `business_profiles`)
   contain data that should not be readable via the anon key today even
   though they technically are. Migration 061 closed the most sensitive
   gaps (`accounts`, `account_logins`, `investor_leads`,
   `trial_reminder_log`); the remainder need a `06X_enable_rls_*`
   follow-up migration that mirrors 061's pattern.
2. **No automated lint** for "new `CREATE TABLE` without a matching
   `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` + GRANT block." Worth
   adding to `scripts/check-human-copy.mjs` or a sibling script so PRs
   trip on missing scaffolding.

Neither of these changes API exposure today; both are RLS-side
hardening tracked under `docs/RLS_PERF_TODO.md` and migration 061's
notes.

## Quick reference: which role gets what

| Role | Used by | Bypasses RLS? | Needs GRANT? |
|---|---|---|---|
| `service_role` | Backend (FastAPI). Service-role key in `backend/db/supabase.py`. | Yes | No (but harmless to grant) |
| `authenticated` | Browser `supabase-js` once the user has a session | No | Yes, on tables the frontend touches |
| `anon` | Browser `supabase-js` before login; unauthenticated PostgREST callers | No | Only for explicitly public reads |
| `public` | pg-internal pseudo-role | No | **Never grant here** |
