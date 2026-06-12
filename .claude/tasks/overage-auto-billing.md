TASK: overage-auto-billing

Make the metered 1x-3x viewer-hour overage bill automatically on a
schedule. Today it is metered but only invoiced when an operator
manually POSTs an admin endpoint, which in practice means $0 overage
revenue while the AWS cost is real.

Problem:
Usage between included_vh (1x) and the hard block (3x) generates
streaming cost with no automatic revenue recovery. The per-tier
profitability proof shows every defined tier is UNDERWATER at the 3x
ceiling when overage is not billed (Starter -$36, Growth -$111,
Pro -$151 worst case per merchant per month) and PROFITABLE at the
same ceiling when it is billed (+$29 / +$57 / +$149). This task is
the difference between the hard block protecting profit and merely
capping the size of the loss.

Evidence:
- Metering exists and accumulates monthly:
  backend/services/stream_telemetry.py:119-254 (on_stream_end ->
  merchant_monthly_usage upsert, viewer_seconds = duration x
  unique_viewers upper bound)
- Hard block reads it at every gate:
  backend/services/merchant_limits.py:285-342
- Billing calculator + invoice recorder already built and tested:
  backend/services/overage_billing.py (invoice_overage_for_period,
  no-double-bill netting against sales fees per CLAUDE.md s3)
- But the ONLY trigger is operator-driven:
  backend/api/routes/admin.py:48-53 ("Triggers are operator-driven;
  nothing here runs on a schedule yet"), POST /admin/overage/
  {merchant_id}/{yyyymm}
- Existing cron-worker pattern to copy:
  backend/services/agents/schedule_rollforward.py + docs/cron.md

Proposed approach:
1. New agent worker (services/agents/overage_billing_run.py shape)
   that, shortly after each month closes, iterates active merchants
   and calls the existing invoice_overage_for_period(merchant_id,
   prior_yyyymm) for each. Pure orchestration; the calculator and
   the no-double-bill netting stay untouched.
2. Wire it into the same external cron mechanism documented in
   docs/cron.md (Railway cron hitting an internal endpoint or the
   existing agents runner), NOT a new scheduling framework.
3. Operator visibility: write a one-line summary per run (merchants
   processed / invoiced / skipped / errored) to logs and surface
   totals on the existing /admin operations overview.
4. Keep the manual admin POST as the recompute/repair path.

Idempotency / rollup concerns (must hold):
- invoice_overage_for_period is already idempotent per
  (merchant_id, yyyymm) via merchant_overage_invoices - the cron
  re-running MUST remain a no-op for already-invoiced periods.
  Add a test asserting repeated=true on second run.
- Bill only CLOSED months (run for prior yyyymm, never current):
  merchant_monthly_usage accumulates at stream end, so an
  in-flight month is incomplete by definition.
- Late-arriving usage: a stream spanning month boundary lands its
  viewer_seconds in the month it ENDS (stream_telemetry.py:222-223,
  yyyymm = end date). Schedule the run with a grace delay (e.g.
  48h after month close) so marathon streams ending on the 1st
  are counted in the right period.
- No-double-bill netting reads sales-fee earnings for the same
  period; confirm the run order cannot net against a partially
  attributed period.
- Stripe failures on individual merchants must not abort the run;
  collect and report, retry on next cron tick.

HARD GATE - no prod money movement without explicit go:
First PR ships the worker in DRY-RUN mode (compute + record + log,
charge disabled by env flag). Julian reviews one real month of
dry-run output against the Stripe dashboard before the charging
flag is enabled. Flag default OFF. Any new migration (if an audit
column is needed) goes through the normal migration gate as its own
reviewed step.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
