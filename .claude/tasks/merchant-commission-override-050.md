# TASK: merchant-commission-override-050

**Purpose:** Add the per-merchant commission override column on the
`merchants` table. Pairs with migration 049's `plan_limits.commission_rate`
to give the rate-resolution function its full input: merchant override
first, plan default second, fail-closed if neither is set.

This is a standalone, atomic, single-concern migration. It does NOT
include any application logic, any Stripe wiring, or any PR-COMM work —
those land separately and READ this column.

---

## WHAT TO DO

### 1. Prerequisite check (READ-ONLY, do this BEFORE writing the migration)

Confirm three things and report each. If any fails, STOP and ask before
proceeding:

a. The merchants table exists under that exact name. If the canonical
   table is named differently in this codebase (e.g. `merchant`,
   `merchant_accounts`), identify the correct name from
   `backend/db/migrations/*.sql` and report it. Do not guess.

b. The column `commission_rate_override` does NOT already exist on the
   target table. Grep all migrations + any live schema introspection
   available; report the search and the result.

c. There is no existing per-merchant commission column under a different
   name (e.g. `commission_override`, `fee_rate_override`). If one exists,
   STOP — adding a second would create the same two-tables-one-meaning
   problem the 049 prereq check guarded against.

### 2. Write the migration

File: `backend/db/migrations/050_merchant_commission_override.sql`

Header comment must explain:
- What the column is and why it's NULL-able.
- The NULL vs 0.00 semantics (NULL = unset, use plan rate; 0.00 = a
  deliberate comp/promo). Reference the resolution order:
  `merchants.commission_rate_override` -> `plan_limits.commission_rate`
  -> raise.
- Rollback statement.

Migration body:

```sql
ALTER TABLE merchants
    ADD COLUMN commission_rate_override NUMERIC(5,4);

ALTER TABLE merchants
    ADD CONSTRAINT ck_commission_rate_override_bounds
    CHECK (commission_rate_override IS NULL
           OR (commission_rate_override >= 0
               AND commission_rate_override <= 0.5));
```

Use the actual canonical table name if §1.a determined it is not
`merchants`. Match the casing/style of the surrounding migrations
(uppercase types, aligned column declarations) — see
`049_plan_limits.sql` for the reference.

Do NOT:
- Backfill any value (all existing rows must remain NULL — that is the
  intended "use plan default" state for every existing merchant).
- Add an index (low-cardinality column, only read in single-row lookups
  via merchant PK).
- Touch any other column or any other table.
- Add a trigger, function, view, or policy.
- Modify RLS on the merchants table.

### 3. Verification (local sandbox before any prod consideration)

Spin up a scratch Postgres DB, replay enough of the existing schema to
satisfy the migration (or just apply against a stub `merchants` table
with the minimum columns), and confirm:

- [ ] Migration applies cleanly; SQL parses.
- [ ] Column appears with type `NUMERIC(5,4)`, nullable.
- [ ] Existing rows (if any in the sandbox) remain NULL — no backfill.
- [ ] INSERT/UPDATE with `commission_rate_override = NULL` succeeds.
- [ ] INSERT/UPDATE with `commission_rate_override = 0.00` succeeds.
- [ ] INSERT/UPDATE with `commission_rate_override = 0.0100` succeeds.
- [ ] INSERT/UPDATE with `commission_rate_override = -0.0001` is
      rejected by `ck_commission_rate_override_bounds`.
- [ ] INSERT/UPDATE with `commission_rate_override = 0.5001` is rejected
      by `ck_commission_rate_override_bounds`.
- [ ] Rollback runs clean:
      ```sql
      ALTER TABLE merchants
          DROP CONSTRAINT ck_commission_rate_override_bounds;
      ALTER TABLE merchants
          DROP COLUMN commission_rate_override;
      ```

Report each check with the actual psql output, not a paraphrase.

### 4. Hold for review

After verification:
- `git status` to confirm only the new migration file is staged/untracked.
- Summarize: files added, tables touched, columns added, verification
  results.
- STOP. Do NOT apply to production. Do NOT commit yet — the user reviews
  the SQL first, then explicitly authorizes commit and, separately, the
  prod apply via `mcp__supabase__apply_migration`.

---

## WHAT NOT TO DO

- Do NOT write any application code (no Python, no TypeScript, no
  changes to `backend/api/`, `backend/services/`, or `frontend/`).
- Do NOT touch Stripe (no `application_fee_amount`, no Connect changes,
  no webhook handlers).
- Do NOT implement the rate-resolution function — that belongs to
  PR-COMM, not to this migration.
- Do NOT modify `plan_limits` or any other table.
- Do NOT backfill any existing merchant row with a non-NULL value.
- Do NOT create a feature branch — this is a single-file migration
  task continuing on the current branch, matching the 049 pattern.
- Do NOT push to `main`. Push to the designated working branch only,
  and only after the user authorizes the commit.
- Do NOT apply to production without explicit user approval.

---

## OUTPUT FORMAT

Reply with, in order:

1. **Prerequisite check** — three findings (table name, column absence,
   no rival column), each with the evidence (grep output snippet or
   migration file path:line).
2. **Migration file** — path written, body shown inline or referenced.
3. **Verification results** — every checklist item with raw psql output.
4. **Working tree state** — `git status` after writing the file.
5. **Summary** — files added, columns added, what's NOT touched.
6. **Ready for commit?** — yes/no, with blockers if no.

Then STOP and wait for explicit "commit" / "apply to prod" instructions.

---

## DEPENDENCIES

- Migration 049 (`plan_limits` table with `commission_rate` column)
  must already exist in prod. Without it, this column has nothing to
  fall back to and PR-COMM's resolution function can't be built.
  Status as of this task creation: **049 verified in prod.**

## CONSUMERS (informational — these PRs will READ this column later)

- PR-COMM: resolve_commission_rate() — checks
  `merchants.commission_rate_override` first, then
  `plan_limits.commission_rate`, then raises.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
