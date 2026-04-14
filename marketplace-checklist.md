# Marketplace Stabilization Checklist

Run the relevant section(s) after any change to offers, checkout, or token trading.

---

## Flow A -- Create Offer

- [ ] Clicking Create Offer fires a request
- [ ] Invalid inputs show visible errors (title empty, price zero)
- [ ] Valid payload reaches backend (`[saveOffer] sending POST` in console)
- [ ] Backend route logs receipt (`[offers] CREATE request` in server logs)
- [ ] Supabase row inserted into `offers` table
- [ ] `loadOffers()` returns the new offer
- [ ] Offer appears in UI without manual refresh
- [ ] Offer still appears after full page refresh

## Flow B -- Buy Offer / Checkout

- [ ] Clicking Buy creates checkout session (`[buyOffer] checkout response status: 200`)
- [ ] Response contains valid `checkout_url`
- [ ] Stripe redirect succeeds (user lands on Stripe checkout page)
- [ ] Return URL parsing is correct (no duplicate `?checkout=success` params)
- [ ] Success banner appears on return
- [ ] `?checkout=` param cleaned from URL after processing
- [ ] Webhook hits backend (`[webhook] WEBHOOK RECEIVED` in server logs)
- [ ] Order row created in `orders` table with status `pending_payment`
- [ ] Webhook updates order to `paid`
- [ ] `quantity_sold` increments on the offer
- [ ] Sold-out state computed and displayed correctly when remaining = 0
- [ ] Owner page reflects new order in seller orders
- [ ] Public page reflects updated inventory

## Deployment Check

- [ ] GitHub `main` commit hash recorded: ___
- [ ] Vercel deployed commit recorded: ___
- [ ] Railway deployed commit recorded: ___
- [ ] Frontend and backend deployments aligned: YES / NO

---

## Pass Rule

Do not say "fixed" unless all boxes in the relevant flow section are checked.
If any box fails, report the exact failing step and stop.
