# DUM Club Support Runbook
# Written 2026-07-04. Owner: Julian. The "someone is stuck" playbook.

## Refunds — how money goes back

**The one-click path (works today, every merchant):**
Storefront → Manage → Orders → find the order → **Refund**.
- Returns the buyer's ENTIRE payment, including DUM Club's 1.5%
  (the code refunds our fee on purpose — never keep a fee on a
  refunded order).
- Money leaves the SELLER's Stripe balance (it was their money -
  direct charges). Buyer sees it on their card in 5-10 business days.
- Order status flips to Refunded everywhere automatically.

**Backup path:** every merchant has their own Stripe Express
dashboard (connect.stripe.com/express_login) — Payments → pick the
charge → Refund. Same result.

**What you CANNOT do:** refund another merchant's order for them.
Their money, their Stripe, their button. You can walk them through
it in 60 seconds (script below).

**Buyer says the seller won't respond:** per /help, you're the
backstop at the platform level. First, contact the merchant
yourself. If they're unreachable or unreasonable, remind the buyer
their card-dispute rights always work — and consider whether the
merchant belongs on the platform (admin → Suspend).

**Canned reply — buyer wants a refund:**
> No problem. The fastest path: message the shop from their page
> (Message button) and ask for a refund — sellers can do it in one
> tap and the money's back on your card in 5-10 business days. If
> you don't hear back within 2 days, email me directly and I'll
> step in: julian@topgunmaintenance.com

**Canned reply — merchant asks how to refund:**
> Open your shop page → Orders → find the order → tap Refund. The
> buyer gets everything back including our fee. Takes ten seconds.

## Sign-up rescue — the stuck points and the fixes

Diagnose from /admin/merchants first: it shows their payment-account
state, whether their shop is on Discover, and whether they're live.

**"I never got the email code"**
Spam folder first. Then: use the Google button instead — same
account either way (same-email sign-ins auto-link).

**"It says Stripe declined me" / they closed the Stripe window**
Not a decline — they just exited early. The error on screen now says
exactly that. Tell them: tap Connect Stripe again, and if they're
not an LLC, pick "Individual" on Stripe's form and use their SSN
(that's normal — same thing a bank asks for).

**"My shop disappeared" / empty dashboard**
They signed in with a DIFFERENT EMAIL than they signed up with.
Ask: "which email did you use the first time?" Same email, different
method (Google vs code) = auto-linked, just re-sign-in. Genuinely
different email = tell Claude in the Friday check-in; it's a
two-minute database link.

**"My shop isn't showing on DUM Club"**
Publishing needs three things: a real description (20+ characters),
Stripe connected, and at least one offer. The checklist on their
merchant page shows which one is missing.

**"I can't add an offer"**
They can — offers come BEFORE Stripe now. If the button does
nothing, have them refresh the page once (old tab).

**"How do I go live?"**
One tap from the shop page. If the camera prompt doesn't appear:
they declined browser camera permission — Settings → Site
permissions → allow camera + mic → reload.

## The founding-100 advantage: concierge onboarding

For the first merchants, don't send links — SIT WITH THEM. The
Sunday-market pitch ends with "give me your phone for 60 seconds,"
and you do the signup together on the spot. Every stuck point above
disappears when you're standing there, and the merchant's first
impression is a human, not a form. This is the one support channel
Whatnot structurally cannot offer.

## Channels + promises

- Email: julian@topgunmaintenance.com (already on /help). Keep the
  promise printed there: you step in if a seller is unresponsive.
- Founding merchants: give them your cell. White-glove is the moat.
- Response promise worth making out loud: "same day, usually within
  the hour." At this scale it's cheap; the reputation compounds.
- When something looks like a BUG, not confusion: screenshot +
  which page + what they tapped → Friday check-in with Claude (or
  sooner). Every fix this week started with a screenshot.

## Weekly hygiene

- Glance at /admin/merchants Monday + Friday: anyone stuck at
  "Payment account not set up" for 3+ days gets a friendly text.
- Check Orders for anything stuck in pending.
- Recurring confusion = a product fix, not a support script. Two
  people stuck the same way beats any canned reply — tell Claude.
