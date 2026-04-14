# DUM Club — Session Template v5.0

## READ THIS FIRST — EVERY SESSION

DUM Club is a live selling marketplace and local business
discovery platform. We compete with Whatnot and Commonsold
on fees. They charge % per sale. We charge flat $29-$99/month.

We also replace Google Maps for local discovery and replace
direct mail with AI-powered points retention.

Current phase: See CLAUDE.md Section 6 for phase map.
Current active phase: Phase 0B

---

## BEFORE YOU TOUCH ANYTHING

1. Read CLAUDE.md v5.0 — full doctrine
2. Read CURRENT_SPRINT.md — active tasks
3. Read NEXT_TASK.md — immediate next action
4. Ask: what phase are we in? What's locked?
5. Check: does this task have a real unlock condition met?

---

## THE THREE RULES

1. Understand before changing
2. Smallest change that proves the point
3. One commit per feature, independently reversible

---

## ABSOLUTE RULES — NEVER VIOLATE

- Never charge % of sales — flat fee only, always
- Never fake data or simulated activity
- Never Solana/blockchain language on consumer pages
- Never DUM Points in navbar (Phase 2+ only)
- Never DUM Points purchase flow (legal review pending)
- Never compare to Angi, Thumbtack, DoorDash
- Never combine commits — one feature per commit
- Never skip phase unlock conditions
- Stripe is the ONLY payment processor — never add others
- FOUNDING_CAP = 100 — never change without explicit instruction

---

## COMPETITORS (ONLY these — no others)

Whatnot: 8% commission + 2.9% + $0.30 per transaction
Commonsold: % per sale + monthly fees
Google Maps: free listing but pay-to-rank, no deals
Yotpo/Smile.io: loyalty only, $199-$999/month no marketplace

---

## PRICING MODEL

Founding 100: $0 → $29/month after founding period
Starter: $29/month
Growth: $49/month
Pro: $99/month
Business (white-label): $499/month
Enterprise: $2,000+/month
Commission on sales: 0% — always — for everyone

---

## KEY ROUTES

/ — Homepage
/discover — Marketplace
/merchant — Founding seller signup
/build — Business launcher
/dashboard — Merchant dashboard
/hub — DUM Points (NOT in navbar, direct URL only)
/technology — Tech/Solana (footer only, never main nav)
/admin/outreach — Outreach admin (gated)

---

## FOUNDING CONSTANTS

FOUNDING_CAP = 100
File: backend/api/routes/merchant.py

---

## SESSION END CHECKLIST

- [ ] CURRENT_SPRINT.md updated with progress
- [ ] NEXT_TASK.md updated with next concrete action
- [ ] No fake data introduced anywhere
- [ ] No Solana language on consumer pages
- [ ] No DUM Points in navbar
- [ ] All commits clean and independently reversible
- [ ] No % fees introduced anywhere
