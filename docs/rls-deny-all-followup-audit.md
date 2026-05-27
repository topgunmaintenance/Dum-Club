# RLS deny-all follow-up: audit of remaining unprotected tables

Status: **audit-only.** This document inventories the public-schema
tables that still have RLS disabled and classifies each one's access
path. No SQL is proposed here yet — see "Recommended next step" at the
bottom for the migration sketch.

Companion to:
- `docs/supabase-grants.md` — forward-going GRANT policy for new tables
- Migration `061_enable_rls_on_public_tables.sql` — the pattern this
  follow-up extends to the remaining tables

## Scope

Twenty-two public-schema tables created in migrations `003`–`042`
predate the RLS-by-default posture established in migration `061`.
Each currently relies entirely on the FastAPI backend being the only
writer (the backend uses the service-role key, which bypasses RLS
*and* grants). Today they are still reachable by the anon key over
PostgREST — that anon key ships in the browser bundle.

Out of scope:
- `projects` — created outside the migration directory (pre-tracking
  Supabase Studio creation). Browser SSR client reads from it via the
  `/manage` owner gate. Needs its own follow-up that defines an
  intentional read policy, not a deny_all.
- `profiles`, `posts`, `categories`, `vaults`, `transcripts`,
  `content_embeddings`, `ai_agent_*` — already RLS-enabled (see
  migrations `001`, `032`, `035`).
- Sensitive tables already hardened by `061`: `accounts`,
  `account_logins`, `investor_leads`, `trial_reminder_log`,
  `stream_sessions`, `viewer_session_events`, `merchant_plan_limits`,
  `merchant_monthly_usage`, `plan_limits`, `merchant_overage_invoices`.

## Audit table

Cross-references run on `claude/rls-deny-all-followup` against `main`
at commit `91d53fa`. Counts are distinct call sites returned by `grep
.from("<table>")` and `grep .table("<table>")`.

| # | Table | Migration | Browser `.from()` | SSR `.from()` | Service-role / backend `.table()` | Sensitivity | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | `service_profiles` | 003 | 0 | 0 | 2 | Operator | **deny_all** |
| 2 | `availability_slots` | 003 | 0 | 0 | 1 | Operator | **deny_all** |
| 3 | `bookings` | 003 | 0 | 0 | 1 | Customer PII (booking history) | **deny_all** |
| 4 | `offers` | 010 | 0 (only Storage bucket of same name) | 0 | 8 | Public catalog data | **deny_all**, RLS-bypass on backend continues |
| 5 | `orders` | 010 | 0 | 0 | 4 | Customer PII (purchases) | **deny_all** |
| 6 | `business_profiles` | 014 | 0 | 0 | 4 | Operator | **deny_all** |
| 7 | `dum_transactions` | 016 | 0 | 0 | 6 | Customer ledger | **deny_all** |
| 8 | `favorites` | 017 | 0 | 0 | 1 | User preference (low) | **deny_all** |
| 9 | `reviews` | 017 | 0 | 0 | 1 | Public when surfaced via backend | **deny_all** (backend curates which rows render) |
| 10 | `referrals` | 017 | 0 | 0 | 2 | Internal | **deny_all** |
| 11 | `external_businesses` | 018 | 0 | 0 | 4 | Internal CRM seed data | **deny_all** |
| 12 | `external_business_demand_events` | 018 | 0 | 0 | 2 | Internal analytics | **deny_all** |
| 13 | `purchase_proofs` | 018 | 0 | 0 | 4 | Internal | **deny_all** |
| 14 | `merchant_outreach_queue` | 018 | 0 | 0 | 1 | Internal CRM | **deny_all** |
| 15 | `auctions` | 022 | 0 | 0 | 3 | Public when surfaced via backend | **deny_all** |
| 16 | `auction_bids` | 022 | 0 | 0 | 1 | Customer PII | **deny_all** |
| 17 | `processed_webhook_events` | 025 | 0 | 0 | 1 | Internal idempotency log | **deny_all** |
| 18 | `merchants` | 026 | 0 | 0 | 10 | Stripe Connect IDs, owner identity | **deny_all** (high priority — credentials-adjacent) |
| 19 | `outreach_leads` | 028 | 0 | 0 | 1 | Internal CRM | **deny_all** |
| 20 | `outreach_messages` | 028 | 0 | 0 | 1 | Internal CRM | **deny_all** |
| 21 | `merchant_analytics_events` | 036 | 0 | 0 | 3 | Internal analytics | **deny_all** |
| 22 | `seed_claim_audit` | 042 | 0 | 0 | 1 | Internal audit log | **deny_all** |

**Result: 22 of 22 tables are safe to deny_all.** None have browser
or SSR `supabase-js` table-level access today. All access flows
through the FastAPI service-role client, which bypasses RLS.

## Verifying "no browser access" claims

The two `.from("offers")` call sites found in the browser bundle —
`components/dashboard/PostAndGoLive.tsx:99` and
`lib/popinVideoUpload.ts:96` — are `supabase.storage.from("offers")`,
which references the **`offers` Storage bucket**, not the public
`offers` database table. Storage uses a separate permission system
(bucket policies) and is unaffected by Data API RLS / GRANTs. The
`offers` database table itself has zero browser table access.

Frontend table-level `.from()` calls confirmed by
`grep -rn '\.from(["'\''][a-z_]' frontend/ | grep -v node_modules`:

| Path | Table | Client | Status |
|---|---|---|---|
| `lib/linkWalletToProfile.ts:23` | `profiles` | browser (anon→authenticated) | Already RLS-enabled in `001` |
| `app/project/[id]/manage/layout.tsx:70` | `projects` | SSR cookies | Out of scope (see above) |

Everything else routes through `lib/ai/supabase-service.ts`
(`getServiceClient()`) or Next.js API routes (service-role). Those
calls are unaffected by RLS or GRANTs.

## Why deny_all (not table-specific policies)?

Mirroring `061`'s posture is the lowest-risk move:

- The backend already does all writes via service-role and will keep
  working without change.
- The deny_all policy on `anon, authenticated` makes the existing
  defacto-locked posture **explicit** instead of relying on "nobody
  remembered to call this table from the browser yet."
- It removes the silent footgun where a future developer adds a
  browser `.from("merchants")` call, gets data back without RLS
  scoping it, and ships a PII leak.
- Granular policies (e.g. "customer can read their own orders") can
  be added later, table-by-table, when a frontend feature actually
  needs them. The deny_all is reversible — `DROP POLICY` plus a real
  policy is the upgrade path.

This is the same logic used in `061`. See the rationale comments in
that migration.

## Risk of breaking backend flows

Negligible. Verified preconditions:

1. **All backend Supabase reads/writes use the service-role key**
   (`backend/db/supabase.py` creates the client with
   `SUPABASE_SERVICE_ROLE_KEY`). Service-role bypasses RLS by design.
2. **All Next.js server-side reads of these tables use the service-
   role client** (`frontend/lib/ai/supabase-service.ts`'s
   `getServiceClient()`).
3. **`backend/db/supabase.py` already documents this in
   `docs/RLS_PERF_TODO.md`**: *"the backend bypasses RLS … RLS is the
   safety net for any direct anon/authenticated PostgREST access …
   not the primary access path for the FastAPI backend."*
4. **Migration `061` is the working precedent** — it added deny_all
   to `stream_sessions`, `viewer_session_events`,
   `merchant_plan_limits`, `merchant_monthly_usage`, `plan_limits`,
   and `merchant_overage_invoices` (all backend-only). No backend
   regression was reported when `061` shipped.

## Recommended next step (separate PR)

A single forward migration `062_enable_rls_deny_all_backfill.sql`
that, for each of the 22 tables above:

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_<table>"
  ON public.<table>
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
```

Rollout protocol (proven on `061`):

1. Transactional dry-run on production via the Supabase MCP
   `execute_sql` pattern (`BEGIN; … ROLLBACK;`) to confirm no syntax
   errors and that the existing service-role read path still returns
   the same row count.
2. Apply via `apply_migration` and watch the backend logs for any
   PostgREST 401/403 errors for ~30 minutes.
3. Re-run Supabase Advisor — expect the "RLS disabled in public
   schema" ERROR count to drop by 22.

Risky-to-revert: no. Revert path is `DROP POLICY` + `ALTER TABLE …
DISABLE ROW LEVEL SECURITY` in a single migration.

## What this PR does NOT change

- No migration is created in this branch (audit-only).
- No code (frontend, backend) is changed.
- No existing RLS policy is loosened or removed.
- The `projects` table is not touched — its SSR-anon read path needs
  a positive policy, not deny_all, and that's a separate audit.
- The `offers` Storage bucket and its policies are not touched.
