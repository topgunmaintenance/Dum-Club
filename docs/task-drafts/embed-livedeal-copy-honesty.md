# Task draft: embed "Live deal ends in" copy honesty

**Status:** captured, NOT scheduled. Do not ship ahead of the
#415/#416 commission-test work. This is a customer-honesty copy
fix, not a launch blocker.

**Type:** frontend copy change, single file.

---

## The problem

The storefront embed paints an urgency banner that reads:

> **Live deal ends in 59:43**

There is no deal. The `deal_*` columns exist in the schema
(`backend/db/migrations/035_public_commerce_metadata.sql`) but
are wired to **zero application code** — dormant schema, never
built. No discount is ever applied.

The countdown is actually the **per-stream duration timer**, not
a discount clock. It reads `sessionData.remaining_seconds`, which
comes from the `MAX_STREAM_DURATION` stream cap (~60 min). So
"59:43" just means the stream started ~17 seconds ago and has ~60
minutes left to air. The banner is the stream-duration timer
wearing deal-flavored copy.

Result: paying customers are shown "LIVE DEAL ENDS IN 59:43" when
nothing is on sale, on a countdown that manufactures false
urgency. That collides with the doctrine rule **"never fake
data."** This is the embed implying a deal that doesn't exist.

## Where it lives

`frontend/public/embed.js`

- Line **1372**: `cdLabel.textContent = "Live deal ends in";`
  — the dishonest label.
- Lines 1342-1396: the urgency-banner block. `hasTimer` is true
  whenever `sessionData.remaining_seconds > 0` (i.e. any live
  stream), so the "deal" label paints on every live show.
- Line 1339: `aria-label` is also `merchantTitle + " live deals"`
  — same dishonest framing for screen readers.

The in-code comment (lines 1342-1349) rationalizes the label as
"honest" because the stream-duration cap is a real constraint.
That reasoning covers the *timer* being real, not the word
**"deal"** — there is no deal. The label is what's dishonest, not
the countdown.

## The fix (when scheduled)

Relabel to what the countdown actually is — the live show's
remaining air time — without implying a discount:

- Line 1372: replace `"Live deal ends in"` with honest copy.
  Candidates: **"Show ends in"**, **"Live for"**, or **"On air"**
  (founder picks one). `"Show ends in"` keeps the existing
  countdown-MM:SS layout working unchanged.
- Line 1339 `aria-label`: change `" live deals"` to match (e.g.
  `" live show"`).
- Leave the stock-urgency branch (lines 1397-1402, "Only N left")
  untouched — that one reads real `quantity_remaining` and is
  honest.
- Do **not** touch the timer logic, the ticker, or the
  `deal_*` schema. Copy-only change.

## Out of scope / do not do here

- Do not build the `deal_*` feature. Dormant schema stays dormant.
- Do not touch any backend file.
- Do not bundle this with the #415/#416 / commission-test work.
- Human-copy guard: run `npm run check:human-copy` before PR
  (the new copy must avoid banned phrasing).

---

> Do not modify any code outside the named files for this task.
> If more files are needed, stop and ask first.
