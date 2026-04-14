# BACKLOG

Things deferred from the active sprint with explicit re-enable conditions.
Don't ship from this list without the gating condition being met.

---

## Dover Network Effect Visualizer
**Removed in:** Phase 0A cleanup
**Original commit:** `4135d65 feat: homepage moat section — 'Buy Here. Use There.'`
**Why removed:** The section used fictional businesses (Mario's Cafe → Taco Lane) with fictional transactions. First-time visitors absorbed the vibe before they read any "example" label, and the vibe was fabricated social proof. The Master Playbook is unambiguous: trust signals come before growth metrics, and fictional examples are the same category of trust erosion as a fake activity ticker.

**Re-enable condition:** ≥3 real merchants on DUM Club Dover have at least one cross-network DUM redemption (i.e., a customer earned points at merchant A and spent them at merchant B in the database).

**Implementation when ready:**
1. Use real merchant names from the database (e.g., Topgun Maintenance + 2 others).
2. Pull real `dum_transactions` rows showing the earn → redeem pair, anonymizing customer name.
3. Reuse the JSX layout from commit `4135d65` (two cards + connector arrow + takeaway banner) — the visual structure is sound, only the data source needs to become real.
4. Drop the section back into `frontend/app/page.tsx` between the social-proof block and `#section-how`.
5. Add `{ id: "section-moat", label: "Why It Works" }` back to `HOME_SECTIONS`.

**Owner:** Founder
**Phase:** ≥ Phase 1B complete (≥20 real merchants in Dover, multiple real cross-network DUM redemptions)

---

## Live Streams Hero Banner
**Status:** Code dormant, behind `NEXT_PUBLIC_ENABLE_LIVE_STREAMS` env flag (defaults to off)
**Gated in:** `03a4999 chore: gate live-streams hero behind NEXT_PUBLIC_ENABLE_LIVE_STREAMS`

**Re-enable condition:** A specific Phase 3+ category event (single-category drop, auction, scheduled live-commerce moment) where the Whatnot-style live-stream hero is the right tool. Not before.

**To re-enable:** Set `NEXT_PUBLIC_ENABLE_LIVE_STREAMS=true` on Vercel. No code change needed.

---

## Merchant Outreach Agent
**Status:** Built, deployed, dormant
**Built in:** `4a5d02f feat: merchant outreach v1`
**README note:** See top of `backend/api/routes/outreach.py`

**Why dormant:** Phase 0 demand acquisition is personal SMS to ~20 known contacts (Master Playbook Phase 0C). Cold outreach via Resend is appropriate in Phase 1B (~20 founding merchants in Morris County), not before. Triggering it earlier risks burning Resend sender reputation and looking spammy to people you don't know.

**Re-enable condition:** Phase 0 complete (≥3 real paid Stripe transactions from 3 different real customers through DUM Club). At that point Phase 1B begins, the target list is the 20 mobile/home services merchants in Dover, and the outreach agent is the right tool.

---

## /hub redesign for non-crypto consumers
**Status:** Partially deferred
**Phase 0A scope:** Hide the Buy DUM Points panel only.
**Phase 3A scope:** Full redesign — drop wallet/claim language from default view, move on-chain claim behind an "Advanced" toggle, show balance in DUM + USD equivalent ("568 DUM, worth $56.80"), show "Where you can spend it right now" merchant list, add weekly bonus DUM promos.

**Re-enable condition:** Phase 3 — ~50+ real merchants across 3-4 verticals in Dover. Until then DUM Points has no concrete consumer-facing dollar value, and a redesign would just paint over a hollow page.

---

## Regulatory review for purchasable DUM Points
**Status:** Hard-gated until lawyer review
**Removed in:** Phase 0A — `Buy DUM Points` panel hidden on `/hub`

**Re-enable condition:** Written legal review of selling a utility token to US consumers via Stripe with on-chain claim path, covering money transmission, stored-value-card rules, state-by-state prepaid card regulations, and SEC investment-contract risk. See Master Playbook Phase 3C.

**Until then:** Earned-only points. No purchase path. No top-ups. The dormant code stays in place because earning still works; only the user-facing purchase entry point is hidden.
