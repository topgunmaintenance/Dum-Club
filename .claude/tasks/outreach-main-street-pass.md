# Task: outreach-main-street-pass

## Goal
Every outreach word a prospect reads sounds like a founder talking
to a shop owner, in the 2026-07-07 main-street pivot voice, with
doctrine-canonical numbers. Founder approved all four drafts +
both add-ons 2026-07-15.

## Scope
1. `backend/services/email.py` OUTREACH_TEMPLATES — all four
   templates rewritten: leads with the person-behind-the-counter
   story; "Whatnot takes up to 8%" (never bare "8%"); "30 days
   free" canon; human breakup email. Subjects: initial keeps
   "We already built your store"; day5 becomes "Sell live from
   your own counter"; day10 becomes "Last note from me".
2. `backend/services/email.py` _render_outreach_html — dark shell
   replaced with the light doctrine palette (white / #0B1220 ink /
   #00A36C mint wordmark). CAN-SPAM unsubscribe footer untouched.
3. `LAUNCH-OUTREACH-KIT.md` — manual pitch/DM/one-liner/market
   scripts swept: "60 days free" and founding-first lead retired;
   "Every business gets 30 days free" throughout; price-lock moved
   to an after-signup quiet-perk note outside the spoken scripts.

## WHAT NOT TO DO
- No changes to send logic, unsubscribe tokens, follow-up
  thresholds, or template keys
- No scarcity, counts, or countdowns anywhere
- The verified $10k/month Whatnot math block stays untouched

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
