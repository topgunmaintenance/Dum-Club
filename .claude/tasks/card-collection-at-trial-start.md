TASK: card-collection-at-trial-start

TOP hard-launch blocker on the SUBSCRIPTION leg (ahead of everything
except merging #415 + #416). Collect a payment method via Stripe
SetupIntent AT TRIAL START so the existing trial -> auto-charge
machinery actually bills $39/$99/$299 at day 60 instead of silently
pausing at $0. Build it as ONE piece with trial-abuse prevention —
the SetupIntent card capture serves both.

STATUS (audit 2026-06-14, prod snzodohibhxenqwdklxs): the subscription
scaffolding is BUILT but the revenue-critical card capture is NOT
IMPLEMENTED, so every trial currently ends in `paused` and collects $0.

---

## The current failure this closes (unguarded + unalerted today)

- create_trial_subscription (services/subscriptions.py:142-158) creates
  the Stripe Subscription with trial_period_days=60,
  payment_behavior="default_incomplete",
  payment_settings.save_default_payment_method="on_subscription", and
  trial_settings.end_behavior.missing_payment_method = "pause"
  (subscriptions.py:147).
- NO payment method is ever attached. Repo-wide grep (backend +
  frontend) for SetupIntent / billing_portal / setup-mode or
  subscription-mode Checkout / PaymentElement / CardElement /
  @stripe/react-stripe / client_secret confirmation returns NOTHING
  except the pause-config line. app/merchant/page.tsx wires only Stripe
  CONNECT (the merchant's payout account), never the merchant paying us.
- Because the trial's first invoice is $0, the default_incomplete +
  expand(latest_invoice.payment_intent) pattern collects no card at
  create either.
- Result at day 60: Stripe has no card -> missing_payment_method:pause
  -> subscription status flips to "paused", NO invoice, NO charge, and
  the invoice.paid webhook (checkout.py:1313, "the canonical trial
  converted" moment) NEVER fires. Silent $0. There is no alert and no
  guard for this state today.

## The fix (only missing piece — the rest is already built + correct)

1. Add a SetupIntent card-capture step at TRIAL START (signup /
   onboarding), NOT at trial end:
   - Backend: create a Stripe SetupIntent for the merchant's
     stripe_customer_id (usage="off_session"); return client_secret.
   - Frontend: mount Stripe Elements (PaymentElement) in the merchant
     onboarding flow; confirmSetup; on success the payment method is
     saved to the customer.
   - Attach it as the subscription's default_payment_method (or set
     customer.invoice_settings.default_payment_method) so Stripe
     auto-charges at trial end.
2. With a card on file, the EXISTING machinery already does the rest,
   unchanged and correct:
   - trial_period_days -> at day 60 Stripe auto-charges the tier price.
   - invoice.paid webhook (checkout.py:1313-1336) -> subscription_status
     = "active", clears grace window. invoice.payment_failed -> "past_due"
     + opens the 3-day grace window (checkout.py:1313-1399). Dunning +
     receipt emails (services/email.py:520,538) and the trial_reminders
     agent already exist. DO NOT rebuild these — they are correct once a
     card exists.
3. Keep missing_payment_method:"pause" as the FALLBACK for the edge
   case where capture failed — but the happy path now always has a card.

## Where it goes (do NOT conflate with Connect)

- app/merchant/page.tsx today wires ONLY Stripe CONNECT: stripe_connect_id
  / stripe_connect_status / /api/merchant/stripe-connect/status. That is
  the merchant RECEIVING payouts.
- This task adds the merchant PAYING US (the platform subscription card).
  These are two different Stripe objects (Connect account vs the
  platform Customer + SetupIntent + Subscription). Surface them as
  clearly distinct steps in onboarding: "Get paid (connect Stripe)" vs
  "Start your plan (add a card, free for 60 days)". Never merge the two
  buttons/flows.

## Tie-in: same step as trial-abuse prevention (build together)

The trial-abuse spec needs a card FINGERPRINT captured at trial start
to enforce one-trial-per-identity. That is the SAME SetupIntent:
- Existing identity gate: services/trial_identity.py
  (evaluate_trial_gate, record_trial_identity), migration
  080_trial_identity_ledger.sql, wired at merchant.py:523/697/729. It
  currently keys on an email/identity hash (flag-gated, fail-closed).
- The SetupIntent's resulting PaymentMethod card fingerprint
  (pm.card.fingerprint) is the strong abuse signal: record it in the
  trial-identity ledger so the same physical card can't farm repeat
  60-day trials across emails. Build card capture once; feed both
  conversion (default payment method) AND abuse-prevention (fingerprint
  in the ledger).
- Net: ONE SetupIntent at trial start closes BOTH the $0-pause
  conversion gap and the one-trial-per-card abuse gap. Do not implement
  them as two separate captures.

## Verification (how to prove it works)

- Happy path: complete a merchant signup, confirm a SetupIntent card is
  saved + set as the subscription default_payment_method, and that the
  trial converts to a real charge at day 60. To avoid waiting 60 days,
  run with a SHORTENED trial (TRIAL_DAYS env is already configurable —
  subscriptions.py:56 — set e.g. TRIAL_DAYS=1 in a test env, or use a
  Stripe test clock to advance past trial_end) and observe:
  * Stripe: an invoice.paid for the tier price (1500/3900/9900 cents),
    application of the saved card.
  * DB: merchants.subscription_status -> "active", next_billing_at set,
    grace_period_* null.
- Failure path: with a card that declines at conversion, confirm
  invoice.payment_failed -> subscription_status "past_due" +
  grace_period_ends_at = now + 3d (checkout.py path already does this),
  dunning email fires, and after grace Stripe's dunning + the daily
  sweep handle suspend. (This path is already built; verifying it just
  confirms the card-on-file now makes it reachable.)
- Abuse path: a second signup attempting the same card fingerprint is
  refused/flagged by the trial-identity ledger.

## Gates / constraints

- Stripe Billing config (Prices 39/99/299 via STRIPE_PRICE_ID_*) already
  exists; no new Price objects unless confirmed in the Stripe dashboard.
- New columns (if any — e.g. merchants.default_payment_method_id, or a
  card_fingerprint column on the trial-identity ledger) go through the
  normal migration gate as their own reviewed step.
- No deploy without Julian. SetupIntent uses live-mode keys — test on a
  preview/test env with a shortened trial first.

Do not implement now. Read-only task file. When triggered, this is the
top subscription-leg blocker.
