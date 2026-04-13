# CURRENT_SPRINT.md
# Sprint 2 — Merchant Onboarding

## Goal

Get real merchants signed up and connected to
DUM Club with zero friction and zero cost.
First 20 merchants are founding merchants —
$0/month, $0 platform fee, full access.

## Context — What Already Exists

  business_profiles table — exists and working
  Stripe buyer checkout — working end to end
  Feature flags system — exists in feature_flags.py
  merchants table — migration approved, pending run

## Context — What Is Missing

  merchants table — not yet created
  Merchant signup endpoint — does not exist
  Stripe Connect — zero infrastructure
  Square OAuth — zero infrastructure
  Merchant dashboard — needs upgrade
  Founding merchant status — not in any UI

## Must Finish This Week

1. MERCHANTS TABLE
   Run the approved migration
   Confirm table created with all indexes

2. MERCHANT SIGNUP ENDPOINT
   POST /api/merchant/signup
   Auth via Privy — owner_privy_id TEXT
   Creates merchant with founding defaults
   One merchant per user — DB enforced
   No payment required
   Under 2 minutes to complete

3. STRIPE CONNECT OAUTH
   GET /api/merchant/stripe-connect/authorize
   GET /api/merchant/stripe-connect/callback
   Optional at signup — connect later is fine
   Uses STRIPE_CONNECT_CLIENT_ID env var

4. SQUARE OAUTH
   GET /api/merchant/square/authorize
   GET /api/merchant/square/callback
   Encrypt token — column: square_access_token_enc
   Optional at signup — connect later is fine
   Uses SQUARE_APPLICATION_ID and
   SQUARE_APPLICATION_SECRET env vars

5. MINIMAL MERCHANT DASHBOARD
   Founding merchant badge — Free forever
   Stripe Connect status + connect button
   Square status + connect button
   QR code linking to business profile
   Transaction count today
   Must work without any connections made

## Pricing Rules

  Do not hard-code $29 anywhere
  founding_merchant flag overrides all pricing
  Founding merchant always sees: Free
  Do not change existing 7% buyer platform fee

## Do Not Touch

  Live commerce flow — Sprint 1 complete
  Stripe checkout for buyers — working
  Webhook handler — hardened, do not touch
  Auth system — do not touch
  IVS streaming — do not touch
  existing feature_flags.py entries — never remove
  All existing docs — do not touch

## Build Order

  Complete steps in strict order
  Each step confirmed before next begins
  Report after each step before proceeding

## Definition of Done

  Merchant signs up in under 2 minutes
  Founding merchant status shown clearly
  Stripe Connect OAuth works end to end
  Square OAuth works end to end
  Dashboard shows basic data
  QR code displayed or downloadable
  All at zero cost for founding merchants
  TypeScript passes on all new files
  No regressions on existing buyer flows
