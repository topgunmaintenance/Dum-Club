-- 051_merchants_plan_id.sql
-- Bridge column linking each merchant row to a plan_limits row. Without
-- this, PR-COMM's commission resolver has nothing to JOIN on — the
-- existing merchants.plan_type ('founding' | 'standard' | 'promoted')
-- does not match any plan_limits.plan_id ('starter' | 'growth' | 'pro' |
-- 'business' | 'enterprise', seeded by migration 049). With this column
-- in place the resolver can do:
--     SELECT m.commission_rate_override, pl.commission_rate
--     FROM   merchants m
--     LEFT JOIN plan_limits pl ON pl.plan_id = m.plan_id
--     WHERE  m.id = :merchant_id;
-- and apply the resolution order:
--     m.commission_rate_override -> pl.commission_rate -> raise.
--
-- Nullable on purpose. Per the scope-audit decision, NOT NULL is deferred
-- until the full plan_type / subscription_tier / plan_type-vs-plan_id
-- consolidation lands. A row whose plan_type is outside the mapped set
-- (or whose plan_type is itself NULL) stays plan_id = NULL, and the
-- resolver's third branch ("raise / fail closed") handles it correctly
-- — better than silently routing such a merchant to a default tier.
--
-- Backfill mapping (decided in scope-audit, recorded here verbatim):
--     plan_type = 'founding'  -> plan_id = 'starter'
--     plan_type = 'standard'  -> plan_id = 'starter'
--     plan_type = 'promoted'  -> plan_id = 'pro'
-- Rows with any other plan_type value are NOT touched by the backfill;
-- they remain plan_id IS NULL and are surfaced in the verification report.
--
-- No CHECK constraint is added: the FK to plan_limits(plan_id) enforces
-- validity. A CHECK that hard-coded the five known tier names would
-- duplicate the FK and rot the moment a sixth tier is seeded.
--
-- No index is added. PR-COMM's read path is single-row by merchants PK,
-- then a JOIN to plan_limits PK; both endpoints are already indexed and
-- plan_id is fetched as part of the row scan, never used as a WHERE
-- predicate.
--
-- Rollback:
--   ALTER TABLE merchants DROP COLUMN plan_id;
-- The FK constraint is dropped automatically with the column.

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
