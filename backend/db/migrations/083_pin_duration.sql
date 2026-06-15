-- 083_pin_duration.sql
-- Seller-selectable pin timer (display-only urgency countdown).
--
-- ⚠️  NOT YET APPLIED TO PRODUCTION. This file ships in the PR for review;
--     the operator applies it to the prod DB (snzodohibhxenqwdklxs) out of
--     band. Until then the backend treats pinned_until as absent and the
--     embed simply shows the pinned card with no countdown (unchanged).
--
-- When a seller pins an offer during a live session they pick a duration
-- from {2, 5, 10, 30, 60} minutes. pinned_until records when that pin's
-- on-screen countdown ends. This is DISPLAY-ONLY urgency: at zero the
-- countdown stops and the feature pill clears — price and availability do
-- NOT change. (A real flash sale would instead use the dormant
-- offers.deal_* columns from migration 035; that is a separate feature.)
--
-- One pinned offer per project, so the deadline lives next to
-- projects.pinned_offer_id rather than on offers. NULL = no active timer
-- (an indefinite pin, or no pin at all).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned_until TIMESTAMPTZ;

COMMENT ON COLUMN projects.pinned_until IS
  'Display-only pin countdown deadline. NULL = no timer. Set by '
  '/api/projects/{id}/pin-offer from the seller-picked duration '
  '{2,5,10,30,60} min. Nothing about price/availability changes at zero.';
