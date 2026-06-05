-- 069_orders_shipping_address.sql
-- Capture the buyer's delivery address for physical-goods orders.
--
-- Live selling can't fulfill a physical product without somewhere to ship
-- it. Checkout uses Stripe Checkout Sessions, so we turn on Stripe's
-- native shipping_address_collection for physical_product offers (Stripe
-- renders + validates the address form) and read the result back in the
-- webhook into this column. Digital/service offers leave it NULL.
--
-- JSONB (not split columns) because the shape is a self-contained Stripe
-- address object — { name, phone, line1, line2, city, state, postal_code,
-- country } — that we store and display as a unit; we never filter/join on
-- individual parts. Nullable: most existing + all digital orders have no
-- address.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shipping_address JSONB;
