# TASK: plan-limits-zero-commission-053

**Purpose:** Reconcile `plan_limits.commission_rate` with doctrine.
CLAUDE.md §10 and absolute rule §12.1 state seller commission is 0% —
always, for everyone, forever. Migration 049 seeded every tier with
`commission_rate = 0.0100` (1%); this migration zeroes every row so
PR-COMM's resolver, when it falls through to the plan default for a
merchant whose override is NULL, returns `Decimal("0.0000")` on every
tier instead of 1%.

This is a DATA migration, not a schema migration. The column shape
(NUMERIC(5,4) NULL-able, bounds CHECK 0..0.5) is unchanged. The 0.5
upper bound stays so the column can record a non-zero rate IF doctrine
ever changes in the future — but right now, every row is 0.0000.

The 1% buyer-side margin mentioned in CLAUDE.md §4 (Stream 5) is
explicitly NOT applied via `plan_limits.commission_rate`. If/when that
buyer margin ships, it belongs in a separate column on a separate
concern. PR-COMM treats `plan_limits.commission_rate` exclusively as
seller-side commission, which is 0%.

---

## WHAT TO DO

### 1. Prerequisite check (READ-ONLY, do this BEFORE writing the migration)

Confirm each and report. If any fails, STOP and ask before proceeding:

a. The `plan_limits` table exists with column `commission_rate` and
   the `ck_commission_bounds` CHECK (NULL or 0..0.5). Re-confirm via
   live introspection.

b. The five seed rows are present: `starter`, `growth`, `pro`,
   `business`, `enterprise`. Report each row's current
   `commission_rate` value. The expected pre-migration state is
   every row at `0.0100`; surface any drift before applying.

c. Confirm no merchant has yet relied on a non-zero plan default
   for a real sale. Heuristic: scan `orders` for any row with
   `platform_fee_usd > 0`. If any exist, STOP and report — those
   sales were settled at a rate the merchant is owed reconciliation
   for, and a blind UPDATE here would silently rewrite history.
   This check matters even though PR-COMM hasn't shipped yet: the
   existing hard-coded `PLATFORM_FEE_RATE = 0.0` means no
   non-zero fee should ever have been written, but verifying it
   directly costs one SELECT and rules out a class of footgun.

### 2. Write the migration

File: `backend/db/migrations/053_plan_limits_zero_commission.sql`

Header comment must explain:
- Doctrine reference (CLAUDE.md §10 + absolute rule §12.1).
- Why a data-only migration (column shape stays; only values change).
- The explicit separation between this column (seller commission,
  always 0%) and the §4 Stream 5 buyer margin (lives elsewhere when
  it ships).
- Pre-migration state (every row at 0.0100 per the 049 seed) and
  post-migration state (every row at 0.0000).
- The use of `IS DISTINCT FROM` so the UPDATE is idempotent — running
  it a second time touches zero rows, and a NULL value (if any tier
  were ever set to NULL = "unset, fail closed") would be normalized
  to 0.0000.
- Rollback statement (restores the 049 seed values verbatim).

Migration body:

```sql
UPDATE plan_limits
   SET commission_rate = 0.0000,
       updated_at      = now()
 WHERE commission_rate IS DISTINCT FROM 0.0000;
```

Match the casing/style of `049_plan_limits.sql` and
`050_merchant_commission_override.sql`.

Do NOT:
- Alter the column shape, default, or CHECK bound.
- Drop or rename the column.
- Touch `merchants`, `orders`, or any other table.
- Add or remove rows from `plan_limits` (no INSERT, no DELETE).
- Backfill or rewrite `orders.platform_fee_usd` for past sales — if
  the prereq check at §1.c surfaces any non-zero values, STOP and
  escalate; do not "fix" history in this migration.
- Touch RLS or seed data outside the named UPDATE.

### 3. Verification (local sandbox before any prod consideration)

Per the 050 pattern (Supabase branching unavailable on Free plan).
Use a local Postgres sandbox: create a stub `plan_limits` table
matching the 049 schema, seed it with the five tiers at
`commission_rate = 0.0100`, apply this migration, and confirm:

- [ ] Migration applies cleanly; SQL parses.
- [ ] All five seed rows now have `commission_rate = 0.0000`.
- [ ] Row count is unchanged (5 before, 5 after — no deletes, no
      inserts).
- [ ] `updated_at` advanced on every row that was changed.
- [ ] CHECK constraint still enforces bounds: an UPDATE setting
      `commission_rate = -0.0001` or `0.5001` is rejected.
- [ ] Re-running the migration is a no-op: row count touched = 0
      (idempotent thanks to `IS DISTINCT FROM`).
- [ ] A row inserted with `commission_rate = NULL` is normalized to
      `0.0000` on re-apply (proves the `IS DISTINCT FROM` semantic).
- [ ] Rollback restores the 049 seed:
      ```sql
      UPDATE plan_limits SET commission_rate = 0.0100;
      ```
      All five rows back to 0.0100.

Report each check with the actual psql output, not a paraphrase.

### 4. Hold for review

After verification:
- `git status` to confirm only the new migration file is staged/untracked.
- Summarize: files added, table touched, row count changed, before/after
  values per tier.
- STOP. Do NOT apply to production. Do NOT commit yet.

---

## WHAT NOT TO DO

- Do NOT write any application code.
- Do NOT touch the commission resolver, checkout, or any other route.
- Do NOT modify `merchants`, `orders`, `merchant_plan_limits`, or any
  other table.
- Do NOT change the `plan_limits` schema (no ALTER, no DROP, no
  ADD CONSTRAINT). Values only.
- Do NOT add a CHECK that forces `commission_rate = 0` — the column
  must remain capable of holding a future non-zero rate if doctrine
  ever changes; today's enforcement is via the seed value being 0.
- Do NOT rewrite past `orders` rows.
- Do NOT create a feature branch — single-file migration on the
  current branch, matching the 050 pattern.
- Do NOT push to `main`.
- Do NOT apply to production without explicit user approval.

---

## OUTPUT FORMAT

Reply with, in order:

1. **Prerequisite check** — three findings (plan_limits + CHECK
   present, current per-tier rate dump, orders.platform_fee_usd
   distribution), each with raw SQL output.
2. **Migration file** — path written, body shown inline.
3. **Verification results** — every checklist item with raw psql output.
4. **Working tree state** — `git status` after writing the file.
5. **Summary** — files added, rows updated, before/after per tier.
6. **Ready for commit?** — yes/no, with blockers if no.

Then STOP and wait for explicit "commit" / "apply to prod" instructions.

---

## DEPENDENCIES

- Migration 049 (`plan_limits` seeded with five tiers at 1%) must
  already exist in prod. Status: **049 verified in prod** with all
  five rows at `commission_rate = 0.0100` (confirmed earlier in this
  session via `mcp__supabase__execute_sql`).
- This migration is independent of 050, 051, and 052; they can be
  applied in any order. All four must be in prod before PR-COMM
  ships.

## CONSUMERS (informational)

- PR-COMM resolver: when `merchants.commission_rate_override` is
  NULL, it looks up `plan_limits.commission_rate` via the
  `merchants.plan_id` bridge (added in 051). After this migration,
  that lookup returns `0.0000` for every tier — which is the
  doctrine-correct seller commission.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
