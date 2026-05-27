-- 067_rollback.sql — reverses migration 067_merchant_recap_log.
--
-- SAFE because:
--   * merchant_recap_log has only ONE writer: the weekly merchant_recap
--     cron at backend/services/agents/merchant_recap.py. Dropping the
--     table means the cron's insert-then-send dedup signal stops
--     firing on duplicates, so a re-run within the same week could
--     double-send. The cron itself is only scheduled weekly; the
--     practical blast radius of a same-week double-send is bounded.
--   * No readers outside the cron module. RLS deny-all means no
--     public surface ever exposed this table.
--   * Safe to re-apply by re-running 067_merchant_recap_log.sql.

BEGIN;

DROP INDEX IF EXISTS public.idx_merchant_recap_log_sent_at;
DROP INDEX IF EXISTS public.idx_merchant_recap_log_merchant;
DROP TABLE IF EXISTS public.merchant_recap_log;

COMMIT;
