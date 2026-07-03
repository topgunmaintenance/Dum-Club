-- 085: merchants.entity_type — Individual vs. Registered Business,
-- collected at signup (two tappable cards, borrowed from Whatnot's
-- onboarding). Optional column; NULL for every merchant who signed
-- up before this landed. Used later for tax-doc and Stripe-account
-- guidance, never customer-facing.
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS entity_type text
  CHECK (entity_type IN ('individual', 'registered_business'));

COMMENT ON COLUMN merchants.entity_type IS
  'Self-reported at signup: individual | registered_business. NULL = pre-085 signup.';
