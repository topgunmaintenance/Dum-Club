# TASK: orders-commission-audit-052

**Purpose:** Add two audit columns to the `orders` table so every order
created post-PR-COMM records (a) the commission rate that was resolved
at session-create time, and (b) the exact integer cents value sent to
Stripe as `application_fee_amount`. Without these, reverse-deriving
which rate was applied to a given order requires floating-point math on
the existing `platform_fee_usd` column — ambiguous for small amounts.

This is a standalone, atomic, single-concern migration. Two columns,
two CHECK constraints, no backfill. No application logic.

---

## WHAT TO DO

### 1. Prerequisite check (READ-ONLY, do this BEFORE writing the migration)

Confirm each and report. If any fails, STOP and ask before proceeding:

a. The `orders` table exists with column `platform_fee_usd`
   (migration 010). Re-confirm via live information_schema lookup —
   the resolver will eventually write all three columns and the math
   must line up.

b. Neither `resolved_commission_rate` nor `application_fee_amount_cents`
   already exists on `orders`. Grep all migrations + live introspection.

c. There is no rival audit column under a different name on `orders`.
   Search for `commission_rate_applied`, `commission_resolved_rate`,
   `applied_fee_cents`, `stripe_fee_cents`, `platform_fee_cents`,
   `fee_amount_cents`. If one exists, STOP — same two-tables-one-meaning
   trap.

d. Report current row count in `orders` (informational — confirms no
   backfill is needed, every existing row stays NULL on both new
   columns).

### 2. Write the migration

File: `backend/db/migrations/052_orders_commission_audit.sql`

Header comment must explain:
- What each column records and why both are needed (rate is the
  decision input; cents is the exact Stripe call argument; storing
  both removes round-trip ambiguity).
- NULL semantics: NULL on both means the order pre-dates PR-COMM
  (or was created via a pre-resolver code path). Going forward,
  every order created by `/create-payment-intent` writes both;
  every order created by `/sol-confirm` writes the rate but leaves
  application_fee_amount_cents = NULL (no Stripe call was made).
- Bounds on `resolved_commission_rate`: NULL or 0..0.5 inclusive,
  matching the source columns (`merchants.commission_rate_override`
  bound from 050, `plan_limits.commission_rate` bound from 049).
- Why `application_fee_amount_cents` is BIGINT, not INTEGER:
  signed INTEGER tops out near $21.4M per order; BIGINT handles
  enterprise / B2B-white-label edge cases without ever needing to
  re-migrate. Non-negative CHECK is enforced; Stripe enforces the
  upper bound at API call time.
- Backward-compat note: the existing `platform_fee_usd NUMERIC(10,2)`
  column is preserved untouched. PR-COMM continues to write it
  alongside the new columns so existing readers (analytics queries,
  recent-sales endpoint, seller dashboards) are unaffected.
- Rollback statement.

Migration body:

```sql
ALTER TABLE orders
    ADD COLUMN resolved_commission_rate NUMERIC(5,4);

ALTER TABLE orders
    ADD COLUMN application_fee_amount_cents BIGINT;

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_resolved_commission_rate_bounds
    CHECK (resolved_commission_rate IS NULL
           OR (resolved_commission_rate >= 0
               AND resolved_commission_rate <= 0.5));

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_application_fee_cents_nonneg
    CHECK (application_fee_amount_cents IS NULL
           OR application_fee_amount_cents >= 0);
```

Match the casing/style of `049_plan_limits.sql` and
`050_merchant_commission_override.sql` (uppercase types, aligned
declarations).

Do NOT:
- Backfill any value. Every existing orders row stays NULL on both
  columns. PR-COMM only writes them on NEW orders going forward.
- Add an index on either column (audit-only fields, no lookup path).
- Touch `platform_fee_usd`, `seller_receives_usd`, or any other
  existing column on `orders`.
- Modify any other table.
- Touch RLS on `orders`.
- Add a trigger, function, view, or policy.

### 3. Verification (local sandbox before any prod consideration)

Per the 050 pattern (Supabase branching unavailable on Free plan).
Use a local Postgres sandbox with a stub `orders` table carrying the
minimum columns (id + the new two columns + any existing column the
CHECKs reference). Apply the migration and confirm:

- [ ] Migration applies cleanly; SQL parses.
- [ ] Column `resolved_commission_rate` appears with type
      `NUMERIC(5,4)`, nullable.
- [ ] Column `application_fee_amount_cents` appears with type
      `BIGINT`, nullable.
- [ ] Constraint `ck_orders_resolved_commission_rate_bounds` exists
      with the expected definition.
- [ ] Constraint `ck_orders_application_fee_cents_nonneg` exists
      with the expected definition.
- [ ] Pre-existing rows (if any in the sandbox) remain NULL on both
      new columns — no backfill.
- [ ] INSERT/UPDATE with both columns = NULL succeeds.
- [ ] INSERT/UPDATE with `resolved_commission_rate = 0.0000` and
      `application_fee_amount_cents = 0` succeeds.
- [ ] INSERT/UPDATE with `resolved_commission_rate = 0.0100` and
      `application_fee_amount_cents = 100` succeeds.
- [ ] INSERT/UPDATE with `resolved_commission_rate = -0.0001` is
      rejected by `ck_orders_resolved_commission_rate_bounds`.
- [ ] INSERT/UPDATE with `resolved_commission_rate = 0.5001` is
      rejected.
- [ ] INSERT/UPDATE with `application_fee_amount_cents = -1` is
      rejected by `ck_orders_application_fee_cents_nonneg`.
- [ ] Boundary: `resolved_commission_rate = 0.5000` exact accepted.
- [ ] Rollback runs clean:
      ```sql
      ALTER TABLE orders
          DROP CONSTRAINT ck_orders_resolved_commission_rate_bounds;
      ALTER TABLE orders
          DROP CONSTRAINT ck_orders_application_fee_cents_nonneg;
      ALTER TABLE orders
          DROP COLUMN resolved_commission_rate;
      ALTER TABLE orders
          DROP COLUMN application_fee_amount_cents;
      ```

Report each check with the actual psql output, not a paraphrase.

### 4. Hold for review

After verification:
- `git status` to confirm only the new migration file is staged/untracked.
- Summarize: files added, columns added, constraint count, verification
  results.
- STOP. Do NOT apply to production. Do NOT commit yet.

---

## WHAT NOT TO DO

- Do NOT write any application code (no Python, no TypeScript, no
  changes to `backend/api/`, `backend/services/`, or `frontend/`).
- Do NOT touch the commission resolver or any checkout endpoint —
  PR-COMM lands after migrations 051/052/053 are all in prod.
- Do NOT modify `merchants`, `plan_limits`, or any other table.
- Do NOT backfill `resolved_commission_rate` or
  `application_fee_amount_cents` on existing orders.
- Do NOT touch `platform_fee_usd`, `seller_receives_usd`,
  `amount_paid_usd`, or any other existing column.
- Do NOT add indexes on either new column.
- Do NOT create a feature branch — single-file migration on the
  current branch, matching the 050 pattern.
- Do NOT push to `main`.
- Do NOT apply to production without explicit user approval.

---

## OUTPUT FORMAT

Reply with, in order:

1. **Prerequisite check** — four findings (orders + platform_fee_usd
   present, both new columns absent, no rival, current row count),
   each with evidence.
2. **Migration file** — path written, body shown inline or referenced.
3. **Verification results** — every checklist item with raw psql output.
4. **Working tree state** — `git status` after writing the file.
5. **Summary** — files added, columns added, what's NOT touched.
6. **Ready for commit?** — yes/no, with blockers if no.

Then STOP and wait for explicit "commit" / "apply to prod" instructions.

---

## DEPENDENCIES

- Migration 010 (`orders` table) must already exist in prod. Status:
  **010 in prod** (verified via existing checkout writes).
- This migration is independent of 050, 051, and 053; they can be
  applied in any order. All four must be in prod before PR-COMM
  ships.

## CONSUMERS (informational — these PRs will WRITE these columns later)

- PR-COMM `/create-payment-intent` path: writes both columns on every
  new order, alongside the existing `platform_fee_usd` for backward
  compat.
- PR-COMM `/sol-confirm` path: writes `resolved_commission_rate` for
  audit only (per Decision C); leaves `application_fee_amount_cents`
  NULL because no Stripe call is made in the SOL flow.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
