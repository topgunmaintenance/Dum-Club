## SPRINT 1 — Live Commerce Viewer UX (CLOSED)

All four tasks complete and approved.

1. LAYOUT FIX — Chat beside video on desktop ✅
   Two-column grid (lg: breakpoint), chat right
   Mobile: video top, chat below, sticky buy bar
   Commit: 2c3aa01

2. ENERGY LAYER — Purchase animation ✅
   Sale toast overlay bottom-left of video
   Green with $ icon, auto-dismiss 4s, stack limit 3
   Commit: a90e737

3. DUM POINTS CONFIRMATION — Post-purchase ✅
   Amber toast top-right of video
   sessionStorage price persistence across Stripe redirect
   Formula mirrors backend: min(50, 10 + floor(amount/5))
   Auto-dismiss 10s
   Commit: 38a6279

4. CAMERA-FIRST SELLER FLOW ✅
   Go Live button on dashboard project cards
   Go Live button in navbar (desktop + mobile)
   Auto-trigger camera preview via ?golive=1 param
   IVSStageHost autoStart prop
   Commit: 90f17c8

---

## SPRINT 2 — Merchant Onboarding

## Goal
Get real merchants signed up and connected
to DUM Club with zero friction and zero cost.
First 20 merchants are founding merchants —
$0/month, $0 platform fee, full access.
Billing architecture must support $29/month
later but pricing logic must allow $0 now.

## Must Finish This Week

1. Merchant signup flow
   Simple form: business name, type, location
   No payment required for founding merchants
   Create merchant record in database
   Issue founding merchant status flag

2. Stripe Connect onboarding
   Merchant connects their Stripe account
   So they can receive payouts from live sales
   Standard Stripe Connect OAuth flow

3. Square OAuth connect
   Merchant connects their Square account
   We receive their location_id
   Every future Square sale auto-awards
   DUM Points to their customers

4. Merchant dashboard — minimal
   Show: transactions today
   Show: DUM Points issued today
   Show: connected status for Square
   Show: QR code to download and print

## Pricing Architecture
  founding_merchant: boolean flag on merchant record
  subscription_price_usd: DECIMAL default 0
  platform_fee_percent: DECIMAL default 0
  Both fields exist for future use
  Do not hard-code $29 anywhere in UI or logic
  Founding merchant sees: "Founding Member — Free"
  Future merchants will see pricing options

## Do Not Touch
  Live commerce flow — sprint 1 complete
  Stripe checkout for buyers — working
  Webhook handler — hardened
  Auth system
  IVS streaming

## Definition of Done
  A real merchant can sign up in under 4 minutes
  Connect Square in one OAuth click
  See their dashboard with live data
  Download their QR code
  All at zero cost with founding merchant status
