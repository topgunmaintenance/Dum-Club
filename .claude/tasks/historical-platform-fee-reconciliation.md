# TASK: historical-platform-fee-reconciliation

**Purpose:** Read-only audit of historical orders in prod that carry
`platform_fee_usd > 0`. PR-COMM surfaced 34 such rows totalling
$242.41 against an implied 7% rate — a value that contradicts both
doctrine (CLAUDE.md §10 absolute rule §12.1: "Commission on sales:
0% — always, for everyone, forever") and the current hardcoded
`PLATFORM_FEE_RATE = 0.0`. These rows pre-date PR-COMM and were
likely settled when an earlier `PLATFORM_FEE_RATE` constant was
non-zero.

This task **only documents the situation** so an operator (Julian)
can decide what to do offline. It does not change any data, does
not call Stripe, and does not move money. The deliverable is a
detailed audit report + a recommendation matrix the operator picks
from in a separate conversation.

---

## WHAT TO DO

### 1. Read-only pull from prod

Query the prod Supabase project (`snzodohibhxenqwdklxs`) via
`mcp__a2f6dac0-...__execute_sql`. Every query is SELECT-only. No
INSERT, UPDATE, DELETE, ALTER, or DDL of any kind. If any query
needs to do anything other than SELECT, STOP and ask first.

#### 1a. Top-line totals (one row)

Pull the gross-aggregate picture so the operator sees scope at a
glance:

- total orders with `platform_fee_usd > 0`
- sum of `platform_fee_usd` across all such orders
- sum of `amount_paid_usd`
- sum of `seller_receives_usd`
- date range: min/max `created_at`
- distinct `seller_user_id` values (count, to confirm only the
  founding merchant is affected)

#### 1b. Classify each affected order by buyer + Stripe-PI presence

Group counts so demo/seed data is visible separately from real
settlements:

| buyer_kind | has_stripe_pi | row_count | total_fee | total_gross |
|---|---|---|---|---|
| `guest:%`            | with / without | … | … | … |
| `demo_%` / `seed_%`  | with / without | … | … | … |
| `did:privy:%`        | with / without | … | … | … |
| other                | with / without | … | … | … |

Use the same buckets PR-COMM surfaced; the structure is already
familiar to the operator.

#### 1c. Per-order detail rows (the audit table itself)

For every order with `platform_fee_usd > 0`, emit one row with:

- `id`                                — order UUID
- `created_at` (date + time UTC)
- `buyer_user_id`
- `buyer_kind` (computed: guest / demo / real_privy / other)
- `seller_user_id`
- merchant `business_name` (JOIN `merchants` on
  `owner_privy_id = orders.seller_user_id`; report NULL if no row)
- `offer_id` + offer `title` (JOIN `offers`)
- `amount_paid_usd`                   — gross sale
- `platform_fee_usd`                  — what was skimmed
- `seller_receives_usd`               — what the merchant got
- implied rate = `round(platform_fee_usd / NULLIF(amount_paid_usd, 0), 4)`
- `stripe_session_id`                 — for operator look-up in Stripe dashboard
- `stripe_payment_intent_id`          — same
- `solana_tx_signature`               — should be NULL on this set;
                                        if non-NULL, surface as a
                                        separate concern
- `status`                            — pending_payment / paid /
                                        fulfilled / etc
- `source`                            — normal / live / live_auction

Output sorted by `created_at` ASC so the timeline reads naturally.

#### 1d. Separate the "real founding merchant" subset

The operator's primary concern is real money against the real
founding merchant (Topgun Maintenance). Re-aggregate filtering to:

    buyer_kind = 'real_privy'
    AND stripe_payment_intent_id IS NOT NULL
    AND seller_user_id matches the verified Topgun owner_privy_id

Report:
- order count in this subset
- sum of `platform_fee_usd` (this is the headline number the
  operator weighs reconciliation against)
- sum of `amount_paid_usd`
- date range
- list of all `stripe_payment_intent_id` values (so the operator
  can verify each in Stripe dashboard offline)

#### 1e. Cross-check against Stripe IDs — METADATA ONLY

For every order in §1d (the real-money subset), list its
`stripe_payment_intent_id` and `stripe_session_id`. **Do NOT call
the Stripe API.** Hand off the IDs so the operator can verify in
the Stripe dashboard manually whether `application_fee_amount` was
actually skimmed for each charge. This task's contract stops at
producing the ID list — the Stripe verification is the operator's
step, in a separate session, possibly under a separate Stripe-
touching task with a tighter authorization gate.

### 2. Write the audit report

File: `.claude/audits/historical-platform-fee-reconciliation-<YYYY-MM-DD>.md`

The file is the deliverable. It is NOT a migration, NOT a task
file, NOT application code. Structure:

1. **Headline number**: total `platform_fee_usd` from §1d (real
   Stripe-settled against the real merchant). One sentence.
2. **§1a top-line totals**.
3. **§1b classification table**.
4. **§1c per-order detail table** — sortable, copy-pastable.
5. **§1d real-merchant subset summary**.
6. **§1e Stripe ID list** for the real subset.
7. **Recommendation matrix** (verbatim from §3 below). The audit
   does NOT pick an option; that's the operator's call.
8. **Provenance section** at the bottom:
   - SQL queries actually run (so the report is reproducible)
   - Date the audit was generated
   - Branch + commit SHA the audit was generated from
   - Explicit "Stripe was NOT called; IDs are surfaced for offline
     verification" line so a future reader knows the audit's
     boundary

### 3. Produce the recommendation matrix

Include this matrix verbatim in the report — do not pick. The
operator chooses in a separate conversation.

| Option | What it means | Mechanics | Pros | Cons |
|---|---|---|---|---|
| **A. Leave as pre-doctrine accounting** | Treat the historical 7% as the rate-in-force at the time those orders were settled. No money moves. | Add a one-paragraph note to the merchant's account record explaining the historical-rate window. | Zero operational cost. No risk of refund-on-refund accounting confusion. | Merchant has unrecovered fees they may feel entitled to. Quiet trust hit if discovered. |
| **B. Merchant credit** | Issue a credit equal to the historical `platform_fee_usd` against a future invoice (or recorded as a balance the merchant can draw against future platform charges). | Tracked in our own ledger; no Stripe involvement. Reduces a future subscription bill or counts against AI-social-media add-on. | Simple, no Stripe surface area. Easy to revoke if the merchant churns. | Requires us to actually issue an invoice eventually — until then it's an IOU sitting on our side. |
| **C. Refund / reversal via Stripe** | For each Stripe-settled order in §1d, issue a Stripe Refund or reverse the `application_fee` so the merchant's Stripe balance is made whole. | One Stripe API call per PaymentIntent: `stripe.Refund.create(...)` with appropriate `reverse_transfer` / `refund_application_fee` flags depending on charge mode. Direct-charge model means application-fee reversal is the correct mechanic, NOT a full refund (which would also pull back the customer payment). | Money actually moves; merchant is made fully whole; cleanest from an audit perspective. | Highest operational risk. Requires a separate authorization gate and a Stripe-touching task that this audit explicitly DOES NOT include. If any of the PIs are too old, partially refunded, or otherwise locked, the operation can fail mid-batch — handle idempotently. |
| **D. Internal ledger adjustment only** | Record the historical 7% as a "to be netted against future revenue" line in whatever ledger DUM Club keeps for the merchant. Don't move money. | Spreadsheet entry or a future `merchant_ledger` table. | No Stripe touch. Easy. | Indistinguishable from option A unless the ledger is ever actually consulted; risk of being forgotten. |

The recommendation matrix is the contract this task produces; it
is NOT a recommendation. Whoever runs the next step (the operator)
picks.

### 4. Hold for review

After writing the audit report:
- `git status` — only the new audit file under `.claude/audits/`
  should be untracked. No code files, no migrations.
- Summarize: file path, real-merchant subset total, option count
  in the recommendation matrix.
- STOP. Do NOT commit the audit file without explicit user
  authorization (`commit` instruction). Do NOT proceed to any of
  options A/B/C/D — those are separate tasks that need their own
  authorization gates.

---

## WHAT NOT TO DO

- Do NOT modify any `orders` row. No UPDATE, no DELETE. Historical
  fees stay exactly as they were settled.
- Do NOT issue any refund (no `stripe.Refund.create`).
- Do NOT issue any credit (no inserts into any ledger table, no
  balance adjustments).
- Do NOT call Stripe at all. Not retrieve, not list, not modify.
  Even read-only Stripe calls are outside this task's scope —
  surface the IDs and let the operator verify offline.
- Do NOT apply any migration. This task does not create columns,
  tables, or indexes.
- Do NOT write application code (no Python, no TypeScript, no edits
  to `backend/`, `services/`, or `frontend/`).
- Do NOT modify the merchant's record in `merchants` (no notes
  column update, no flag flip).
- Do NOT pick a recommendation option in the audit report.
- Do NOT publish the audit anywhere outside the repo (no Slack
  post, no email, no GitHub issue, no PR comment) — it's an
  internal document.
- Do NOT create a feature branch. Read-only tasks per CLAUDE.md
  may run from the current working branch (
  `claude/zen-davinci-1poSH` or whatever is current). No
  `feature/<task-name>` branch is needed.
- Do NOT push to `main`.
- Do NOT include actual buyer PII (emails, full Privy IDs) in the
  audit report beyond what's already in the `orders` row. The
  `buyer_user_id` column value is acceptable (it's a DID, not a
  PII identifier); buyer emails should NOT be added to the per-
  order table even if available — they aren't needed to decide
  reconciliation.

---

## OUTPUT FORMAT

Reply with, in order:

1. **Top-line headline** — one sentence with the real-merchant
   subset total from §1d.
2. **§1a top-line totals** — raw SQL output.
3. **§1b classification table** — markdown table.
4. **§1c per-order detail** — markdown table or fenced JSON,
   sortable.
5. **§1d real-merchant subset** — summary block + total fee + PI
   count.
6. **§1e Stripe ID list** — one line per PI, optionally with the
   session id, marked clearly as "for offline verification only".
7. **Recommendation matrix** — verbatim from §3.
8. **Provenance** — SQL run, date, branch+SHA.
9. **Audit file path** — `.claude/audits/historical-platform-fee-reconciliation-<YYYY-MM-DD>.md`.
10. **Working tree state** — `git status` after the file is
    written.
11. **Ready for commit?** — yes/no, with blockers if no.

Then STOP and wait for explicit "commit" or "pick option X"
instructions. The audit file commit is a separate user-initiated
step, just like the migration commits in the PR-COMM cycle.

---

## DEPENDENCIES

- Read-only access to prod Supabase project
  `snzodohibhxenqwdklxs` via the Supabase MCP `execute_sql` tool.
- No schema dependency — every column queried here existed before
  migrations 050/051/052/053. PR-COMM's audit columns
  (`resolved_commission_rate`, `application_fee_amount_cents`) are
  NULL on all 45 historical rows by design (no backfill), so they
  are not part of this audit.

## CONSUMERS (informational — what happens AFTER this audit)

Depending on the option Julian picks, one of these follow-up
tasks gets created:

- Option A → `historical-fee-pre-doctrine-note` (one-row insert
  into a merchant-notes column, if such a column exists; else a
  short migration creating one).
- Option B → `historical-fee-merchant-credit-ledger` (probably a
  new `merchant_ledger` table + a row per affected order). Needs
  its own scope-audit before drafting.
- Option C → `historical-fee-stripe-application-fee-reversal`
  (the Stripe-touching task). REQUIRES explicit Stripe-call
  authorization, a dry-run mode, and idempotent batch handling
  keyed on `stripe_payment_intent_id`. Out of scope for any task
  that hasn't been explicitly authorized to call Stripe.
- Option D → `historical-fee-internal-ledger-entry` (same
  ledger-table shape as Option B but no merchant-visible credit).

This audit task ends BEFORE any of those start.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
