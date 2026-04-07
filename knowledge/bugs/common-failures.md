# Common Failures & Fixes

## Missing tables (reviews, favorites, referrals)

**Symptom**: 990+ errors/sec, Railway log rate limit hit
**Root cause**: Migration 017 not run in Supabase
**Fix**: Run backend/db/migrations/017_favorites_reviews_referrals.sql
**Safety net**: All three route files have try/except with safe fallbacks and log-once pattern

## Mobile header not clickable

**Symptom**: Hamburger toggles (≡ → ✕) but dropdown invisible
**Root cause**: backdrop-filter on <nav> creates CSS containing block that traps position:fixed children
**Fix**: Moved dropdown outside <nav> as a React fragment sibling

## Starfield performance

**Symptom**: Site feels slow, GPU usage high
**Root cause**: 130 particles with shadowBlur at 60fps on every page
**Fix**: Throttled to 30fps, removed star shadows, cut particles in half

## AI chat not visible

**Symptom**: "Ask [Business]" button doesn't appear
**Root cause**: Was gated by !isOwner (hidden from project owner) + DumPill z-index overlap
**Fix**: Removed owner gate, hidden DumPill on project pages, positioned chat above mobile CTA bar

## Stripe webhook orders stuck

**Symptom**: Orders stay in pending_payment
**Root cause**: STRIPE_WEBHOOK_SECRET not set or webhook URL misconfigured
**Fix**: Set env var, verify webhook URL points to Railway backend

## DUM Points not updating after Stripe purchase

**Symptom**: User returns from Stripe, balance unchanged
**Root cause**: Balance refresh uses setTimeout cascade (1s, 3s, 7s) — may miss if webhook is slow
**Fix**: Current design is acceptable — webhook eventually fires and balance updates on next page load
