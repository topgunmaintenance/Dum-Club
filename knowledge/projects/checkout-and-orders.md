# Checkout & Orders

## Flow

1. Customer clicks offer → frontend calls POST /api/checkout/create-payment-intent
2. Backend creates Stripe Checkout Session with offer details
3. Customer redirected to Stripe → pays → redirected back
4. Stripe webhook fires → backend updates order to "paid"
5. quantity_sold increments on offer
6. DUM Points awarded (+2 buyer, +2 seller)

## Key files

- Backend: backend/api/routes/checkout.py
- Frontend: project/[id]/page.tsx (buyOffer function)

## Tables

- orders: id, offer_id, project_id, buyer_user_id, amount_paid_usd, status
- offers: quantity_sold, quantity_available, unlimited_inventory

## DUM Points discount

- 10 DUM Points = 10% off any offer at checkout
- Customer gets discount, business receives full price (platform absorbs)

## Known issues

- If webhook is misconfigured, orders stay in pending_payment
- Stripe test mode uses test card numbers
