-- 070_orders_tracking.sql
-- Complete the physical-order lifecycle: when a seller marks an order
-- fulfilled they can record a shipment tracking number, and we stamp when
-- fulfillment happened. Pairs with 069 (shipping_address capture) so the
-- seller has the address to ship to and the buyer can see their tracking.
--
-- tracking_number is free text (carrier-agnostic — sellers paste whatever
-- the carrier gave them); no carrier API integration here. Both nullable:
-- digital orders and not-yet-shipped orders have neither.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tracking_number TEXT,
    ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
