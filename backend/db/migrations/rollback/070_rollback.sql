-- 070_rollback.sql
-- Rollback for 070_orders_tracking.sql. Drops the columns (any recorded
-- tracking numbers are lost).

ALTER TABLE orders
    DROP COLUMN IF EXISTS tracking_number,
    DROP COLUMN IF EXISTS fulfilled_at;
