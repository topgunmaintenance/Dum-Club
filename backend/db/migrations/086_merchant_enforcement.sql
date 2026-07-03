-- 086: enforcement columns — admin suspension of a merchant and admin
-- takedown of a single offer (founder request 2026-07-03: "am I able
-- to kick out businesses who sign up wrongly or sell items not good
-- to sell?").
--
-- admin_suspended rides the SAME gate as billing suspension
-- (is_merchant_suspended), so a suspended merchant cannot go live and
-- buyers cannot start checkout against their offers. Separate column
-- from subscription_status so billing state is never overwritten and
-- unsuspending cannot accidentally resurrect a delinquent plan.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS admin_suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_suspended_reason text,
  ADD COLUMN IF NOT EXISTS admin_suspended_at timestamptz;

COMMENT ON COLUMN merchants.admin_suspended IS
  'Platform enforcement: true blocks Go Live + checkout via is_merchant_suspended, regardless of billing state or grandfathering.';

-- Offer-level takedown: is_active=false alone could be flipped back by
-- the merchant; admin_removed makes the takedown stick until an admin
-- clears it.
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS admin_removed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_removed_reason text;

COMMENT ON COLUMN offers.admin_removed IS
  'Platform takedown: merchant cannot reactivate while true.';
