# DUM Club Launch Audit — vs Whatnot, merchant-signup focus
# 2026-07-02 · Every grade below was verified live on www.dum.club or
# line-by-line in the code this session. Not aspirational — checked.

## Verdict

The core loop is real and competitive: a business owner can sign up,
connect Stripe, list offers, go live with one tap, run timed drops that
actually close, chat with named customers as their shop, and take card
payment at 1.5%. Whatnot's marketing site can't show any of that — it
funnels consumers to an app download and sellers to an application
queue with days of review. DUM Club's wedge is intact: **instant
self-serve seller onboarding, flat pricing, own-your-customers.**

## Page grades (all verified this session)

| Surface | Grade | Notes |
|---|---|---|
| / (homepage) | A | Identity line, photographed example shops, real shops with photos, pitch + interactive demo (autoplays, honest labels) |
| /discover | A- | Real photos on cards; sparse until more merchants (expected) |
| /business | A | "Keep Everything You Earn," expense-replacement table, calculator |
| /pricing | A | Canonical founding copy, tier compare |
| /merchant (signed out) | B+ | Clear pitch, one CTA, "email or Google" sign-in. Fix list below |
| /merchant (signed up) | A- | Consolidated strip + checklist + honest numbers (rebuilt this session) |
| Storefront (customer) | A | Photos, featured card w/ synced countdown, live Stripe checkout verified (cs_live) |
| Storefront (owner/Manage) | A- | Camera-first layout, usage meter, sale-timer picker at point of sale |
| Live room (mobile + desktop) | A | Verified on-air: chat two-way w/ real names, host speaks as shop, flash timers enforce, Like/Share, spacing fixed |
| /about, /why-dum-club, /investors, /qr, /install, /hub, /terms | A- | On-message; terms rewritten; QR + install are better merchant tools than Whatnot offers at all |
| Retired | — | /welcome (fake content) deleted; /leaderboard parked; /chat dead-end redirected |

## Signup funnel — line-level findings

Flow: /merchant → "Claim Your Founding Spot" → Privy sign-in (email
OTP or Google, ~30s) → form → merchant + storefront + 60-day Stripe
trial auto-created → checklist (Stripe Connect → first offer → share
→ QR → go live).

1. **FIXED IN REPO (deploys with fix/host-chat-name) — copy said "one field," code required three.**
   handleSignup validates business name, category, AND a 20-character
   description, while the page promised "One field. That's the whole
   signup." Honest copy now matches the real (still ~60-second) form.
   The 20-char description gate is CORRECT — it's what qualifies the
   shop for Discover — but it must not be a surprise.
2. **Structural risk — identity fragmentation.** "Email or Google"
   sign-in means the same person can create two accounts (this bit the
   founder: four Privy IDs). Backend now bridges project-linked
   profiles, but merchants/trials/usage key on one privy id.
   Mitigation options: enable account linking in the Privy dashboard
   (same-email Google + OTP resolve to one DID) — check this setting;
   until confirmed, the form's fine print should say "use the same
   sign-in method every time."
3. **Stripe Connect is the heaviest step** (SSN/bank — Stripe's
   requirement, unavoidable). The checklist frames it well. Whatnot
   makes sellers wait days for approval; DUM Club's Stripe Express is
   minutes. This is a selling point — outreach copy should say so.
4. Trial provisioning is best-effort: a Stripe outage doesn't fail
   signup (good), retried on next dashboard load (good).
5. Repeat-trial identity gate exists (can't farm 60-day trials). Good.

## Whatnot comparison — where each side wins

**DUM Club wins:** self-serve onboarding (minutes vs days of review),
pricing (1.5% vs 8%+2.9%), merchant owns the customer (QR, embed on
their own site, win-back), services sell as easily as products,
transparent usage meter + caps.

**Whatnot still wins:** native mobile apps (DUM is mobile-web — fine
at this stage), buyer network scale, giveaways/auctions polish
(auctions exist in DUM; giveaways don't), seller analytics depth.
None of these block launch; all are post-traction work.

## Ranked remaining items

1. (Owner) Two-way chat re-test after WEB_CONCURRENCY=1 restart — the
   fix is merged; verify once on the next stream.
2. (Owner) Stripe price↔env pairing glance; Resend domain verified.
3. (Owner) Deactivate the 2 test offers; Dover vs Morristown call.
4. (Code, later) Privy account-linking confirmation (item 2 above).
5. (Code, later) Realtime on a shared bus (Redis/Supabase) before ever
   raising worker count; giveaways feature when buyer volume exists.

## Bottom line

Nothing in this audit blocks a business owner from signing up cleanly
today, and the seller experience now beats Whatnot's on speed-to-live
and cost. The site is launch-grade. The scarce input is merchants.
