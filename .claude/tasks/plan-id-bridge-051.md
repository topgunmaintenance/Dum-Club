# TASK: plan-id-bridge-051

**Purpose:** Add the bridge column `merchants.plan_id` that links a
merchant row to a row in `plan_limits` (created in migration 049).
Without this column the commission resolver (PR-COMM) has nothing to
JOIN on — `merchants.plan_type` ('founding' | 'standard' | 'promoted')
does not match any `plan_limits.plan_id` ('starter' | 'growth' | 'pro'
| 'business' | 'enterprise').

This is a standalone, atomic, single-concern migration. It adds one
column, sets a foreign-key constraint via the column declaration, and
backfills existing merchant rows per the mapping decided in scope-audit.
No application logic, no Stripe wiring.

---

## WHAT TO DO

### 1. Prerequisite check (READ-ONLY, do this BEFORE writing the migration)

Confirm each and report. If any fails, STOP and ask before proceeding:

a. The `merchants` table exists. Already verified in migration 050's
   prereq pass; re-confirm from prod via execute_sql.

b. The column `plan_id` does NOT already exist on `merchants`. Grep
   migrations + run a live information_schema lookup; report both
   results.

c. There is no rival bridge column under a different name on
   `merchants`. Search for `plan_ref`, `plan_key`, `plan_limits_id`,
   `tier_id`, `pricing_plan_id`. If one exists, STOP — adding a
   second bridge is the same trap migration 050's prereq guarded
   against.

d. The `plan_limits` table exists with `plan_id TEXT PRIMARY KEY`
   (migration 049). The FK in this migration must point at that PK.
   Confirm the seed rows: starter, growth, pro, business, enterprise.

e. Report the distribution of `merchants.plan_type` values currently
   in prod. The migration backfill only handles three values
   ('founding', 'standard', 'promoted'). Any row outside that set
   will be left NULL by the backfill — surface the count so the
   operator can decide whether to proceed or pause and reclassify
   those rows first.

### 2. Write the migration

File: `backend/db/migrations/051_merchants_plan_id.sql`

Header comment must explain:
- What the bridge column is and why it exists (without it, PR-COMM
  can't resolve plan-default commission for any merchant).
- Why NULL-able (per Decision A — defer NOT NULL until full migration
  audit; rows whose plan_type is outside the mapping stay NULL and
  fall through to "fail closed" in the resolver, which is correct).
- The backfill mapping verbatim:
    'founding'  -> 'starter'
    'standard'  -> 'starter'
    'promoted'  -> 'pro'
- Why no CHECK constraint is added (FK to plan_limits.plan_id
  enforces validity; CHECK would duplicate that).
- Why no index is added (PR-COMM's hot read path is `merchants` PK
  lookup followed by a JOIN to `plan_limits` PK; both endpoints are
  already indexed).
- Rollback statement.

Migration body:

```sql
ALTER TABLE merchants
    ADD COLUMN plan_id TEXT REFERENCES plan_limits(plan_id);

UPDATE merchants
   SET plan_id = CASE plan_type
                   WHEN 'founding'  THEN 'starter'
                   WHEN 'standard'  THEN 'starter'
                   WHEN 'promoted'  THEN 'pro'
                 END
 WHERE plan_id IS NULL
   AND plan_type IN ('founding', 'standard', 'promoted');
```

Match the casing/style of surrounding migrations (uppercase types,
aligned column declarations) — see `049_plan_limits.sql` and
`050_merchant_commission_override.sql` for the reference.

Do NOT:
- Add a CHECK constraint (FK is sufficient).
- Add NOT NULL (per Decision A, stays nullable for now).
- Add an index on the new column.
- Touch any other column or table.
- Backfill rows whose `plan_type` is outside the three mapped values
  — leave them NULL and surface in verification.
- Drop or rename the deprecated `merchants.platform_fee_percent` or
  the overlap between `subscription_tier` and `plan_type` — those are
  separate cleanups, not this PR.
- Modify RLS on `merchants`.

### 3. Verification (local sandbox before any prod consideration)

Per the 050 pattern, Supabase branching is unavailable (Free plan).
Use a local Postgres sandbox with stub `plan_limits` (5 seed rows from
049) and stub `merchants` (rows covering each `plan_type` value).
Apply the migration and confirm:

- [ ] Migration applies cleanly; SQL parses.
- [ ] Column `plan_id` appears with type `text`, nullable.
- [ ] Foreign-key constraint exists pointing to `plan_limits(plan_id)`.
- [ ] Backfill: every `plan_type='founding'` row now has
      `plan_id='starter'`.
- [ ] Backfill: every `plan_type='standard'` row now has
      `plan_id='starter'`.
- [ ] Backfill: every `plan_type='promoted'` row now has
      `plan_id='pro'`.
- [ ] Backfill: rows whose `plan_type` is outside the three values
      remain `plan_id IS NULL`. Report the count.
- [ ] FK rejects an INSERT/UPDATE with `plan_id='invalid_tier'`.
- [ ] INSERT with `plan_id=NULL` succeeds (nullable).
- [ ] UPDATE setting `plan_id` from NULL to a valid tier succeeds.
- [ ] Rollback runs clean:
      ```sql
      ALTER TABLE merchants DROP COLUMN plan_id;
      ```
      (FK constraint drops automatically with the column.)

Report each check with the actual psql output, not a paraphrase.

### 4. Hold for review

After verification:
- `git status` to confirm only the new migration file is staged/untracked.
- Summarize: files added, tables touched, columns added, backfill
  counts, any rows left NULL.
- STOP. Do NOT apply to production. Do NOT commit yet — the user
  reviews the SQL first, then explicitly authorizes commit and,
  separately, the prod apply via `mcp__supabase__apply_migration`.

---

## WHAT NOT TO DO

- Do NOT write any application code (no Python, no TypeScript, no
  changes to `backend/api/`, `backend/services/`, or `frontend/`).
- Do NOT touch Stripe (no Connect changes, no webhook handlers).
- Do NOT implement the commission resolver — that belongs to
  PR-COMM, after migrations 051/052/053 land.
- Do NOT modify `plan_limits`, `orders`, or any other table.
- Do NOT add a CHECK or NOT NULL constraint on `plan_id`.
- Do NOT drop or alter `merchants.platform_fee_percent`,
  `merchants.subscription_tier`, or `merchants.plan_type`.
- Do NOT create a feature branch — this is a single-file migration
  task continuing on the current branch, matching the 050 pattern.
- Do NOT push to `main`. Push to the designated working branch only,
  and only after the user authorizes the commit.
- Do NOT apply to production without explicit user approval.

---

## OUTPUT FORMAT

Reply with, in order:

1. **Prerequisite check** — five findings (table exists, no plan_id,
   no rival, plan_limits FK target, plan_type distribution), each
   with the evidence (grep snippet, file:line, or raw SQL output).
2. **Migration file** — path written, body shown inline or referenced.
3. **Verification results** — every checklist item with raw psql output.
4. **Working tree state** — `git status` after writing the file.
5. **Summary** — files added, columns added, backfill counts, what's
   NOT touched.
6. **Ready for commit?** — yes/no, with blockers if no.

Then STOP and wait for explicit "commit" / "apply to prod" instructions.

---

## DEPENDENCIES

- Migration 049 (`plan_limits` table with `plan_id PRIMARY KEY`) must
  already exist in prod. Status as of this task creation:
  **049 verified in prod** (5 seed rows present).
- Migration 050 is independent of this one; either can be applied
  first. Both must be in prod before PR-COMM ships.

## CONSUMERS (informational — these PRs will READ this column later)

- PR-COMM: `resolve_commission_rate()` — JOINs
  `merchants.plan_id = plan_limits.plan_id` to fetch the plan-default
  commission when `merchants.commission_rate_override` is NULL.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
