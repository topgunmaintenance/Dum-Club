-- 069_rollback.sql
-- Rollback for 069_orders_shipping_address.sql.
-- Drops the column. Any captured shipping addresses are lost (they remain
-- available in the Stripe Dashboard on each connected account's payment).

ALTER TABLE orders
    DROP COLUMN IF EXISTS shipping_address;
