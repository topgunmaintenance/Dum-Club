-- 037_popin_event_types.sql
-- DUM Pop-In Seller MVP — extend merchant_analytics_events.event_type
-- to allow the 4 new popin_* events fired by the embed pop-in widget.
--
-- Reuses the existing analytics table (migration 036) — no new tables,
-- no new columns. Strictly additive change to the CHECK constraint.

ALTER TABLE merchant_analytics_events
  DROP CONSTRAINT IF EXISTS merchant_analytics_events_event_type_check;

ALTER TABLE merchant_analytics_events
  ADD CONSTRAINT merchant_analytics_events_event_type_check
  CHECK (event_type IN (
    'embed_view',
    'project_view',
    'offer_view',
    'checkout_start',
    'purchase_completed',
    'live_view',
    'return_visit',
    'popin_view',
    'popin_click',
    'popin_dismiss',
    'popin_offer_click'
  ));
