# Task: livestream-reliability-audit

**Type:** Read-only audit (no code edits, no config edits, no
deploys, no migrations, no load tests run).
**Branch policy:** Per CLAUDE.md v5.0 read-only exemption, this
task does not require a `feature/<task-name>` branch and may run
from the current branch. The actual follow-up tasks named at the
bottom of the deliverable MUST each create their own
`feature/<task-name>` branch when authorized.
**Status:** Spec only. Execution requires the explicit phrase
`run task: livestream-reliability-audit`.
**Priority context:** Priority 1 of the post-PR-COMM launch focus
(livestream reliability + speed). Pre-flight audit for any
follow-on livestream work.

---

## OBJECTIVE

Produce one markdown audit report that tells a launch-focused
operator, in priority order:

1. Where current livestream latency is actually spent (frontend,
   IVS, backend, websocket, playback init) and what would move the
   needle.
2. Which mobile-live failure modes are unhandled today.
3. What Mux code is still on disk, classified, so a future
   deletion task has a contract to work from — without deleting
   anything in this audit.
4. Which non-IVS surface (chat, presence, reactions, order events,
   replay polling) will break first under viewer load, plus a
   sandbox load-test plan that has NOT yet been run.
5. Where the replay/VOD lifecycle is fragile and what makes the
   replay purchase flow break.

The deliverable is a markdown report. Nothing else.

---

## WHAT TO DO

### Section 1 — IVS go-live latency path

Trace the exact end-to-end path from the merchant clicking "Go
Live" to the first frame rendered for a viewer. Cover both halves:

- **Frontend → backend (broadcast init):** which component fires
  the click, which API route(s) it hits, what backend does
  (channel create/lookup, stream key issue, recording config,
  metadata writes), what the frontend does with the response
  (token mint, IVS Web Broadcast SDK init, getUserMedia, encoder
  bring-up, RTMP/WHIP handshake).
- **Backend → IVS:** channel state transitions, any waits for
  IVS to acknowledge live, any DB writes that gate downstream
  reads.
- **Viewer side:** how a viewer learns the stream is live
  (websocket push? polling? page-load fetch?), playback init,
  manifest/segment fetch, first decoded frame.

For each step, record:

- File + symbol references in `file_path:line_number` form
- Whether the step is sync or async
- Whether it blocks the next step
- Any retry / polling loop and its interval
- Any serialization that could be parallelized
- An order-of-magnitude latency estimate (best/typical/worst) with
  the basis for the estimate (measured, docs, inference — say
  which)

Conclude the section with **"Where latency is dominated"** — one
or two sentences naming the single biggest contributor and the
runner-up.

### Section 2 — First-frame playback analysis

Focused inspection of the viewer-side player startup. Cover:

- HLS playback startup path: which player library, init args,
  whether `lowLatency`/`liveCatchup` style flags are on, whether
  we're using IVS quick-sync features.
- Autoplay / poster / muted logic: what controls `muted` on first
  load (autoplay policies require it on mobile), how the poster
  image is chosen, whether the player renders any frame before
  manifest arrives.
- Player initialization timing: where in the React lifecycle the
  player mounts, whether it waits for any non-essential data
  (auth check, analytics, etc.) before requesting the manifest.
- Manifest / segment behavior: target duration, segment length,
  whether we prefetch, whether we render the lowest rendition
  first then switch up.

End with a **"Low-hanging startup improvements"** sub-list,
each item with: surface, estimated first-frame win, risk level.

### Section 3 — Mobile live stability

Targeted at iOS Safari and Android Chrome — the two platforms
that decide whether a real merchant can broadcast from their
phone. Cover:

- iOS Safari quirks: autoplay restrictions on viewer side,
  WebRTC/IVS Web Broadcast SDK support on broadcaster side,
  PiP, fullscreen, hardware encoder availability.
- Android Chrome quirks: same axes; document any known divergence
  from iOS.
- Lock screen / background behavior: what happens when the
  broadcaster locks the phone, what happens when a viewer
  backgrounds the tab, how playback resumes.
- Reconnect handling: network drop → recover, IVS channel
  disconnect → recover, websocket reconnect on the viewer side.
- Autoplay restrictions: confirm the muted-autoplay pattern is in
  place; flag any surface that calls `.play()` without the user
  gesture path.
- Camera/mic permission edge cases: first-time grant, denied
  state, revoked mid-stream, permission UI on iOS standalone vs
  in-browser.
- Network interruption handling: 3G/4G/wifi transitions, captive
  portals, VPN, low-bandwidth fallback rendition.

For each failure mode, mark: **observed**, **inferred from code**,
or **unknown — needs device test**. Do not claim "observed"
without a code reference or a documented test.

### Section 4 — Mux inventory audit

Grep the entire repo (frontend, backend, infra, docs, scripts,
tests) for `mux` (case-insensitive). For each hit, classify as:

- **active production path** — code currently runs in production
  and a failure here would affect live merchants
- **dormant fallback** — wired up but gated off / behind a feature
  flag / behind an env var that isn't set
- **dead code** — imported but never called, or only referenced
  by other dead code
- **docs/comments only** — markdown, comments, commit messages,
  ROADMAP, env-example files

Output a table with columns: `file_path:line_number`,
`snippet (≤80 chars)`, `classification`, `evidence`. "Evidence"
means: how you decided the classification (e.g. "no callers in
repo," "gated by `MUX_FALLBACK_ENABLED` which is unset in `.env*`
files," "imported in `lib/video/index.ts` but only re-exported,
never used downstream").

End with a **"Deletion candidates"** sub-list — files that could
be removed in a future cleanup task. Do not delete any of them.
Do not create the cleanup task.

### Section 5 — Viewer scalability surface

The premise: IVS itself handles video distribution to ~100k
viewers without our help. The actual scaling risk lives in the
non-IVS surfaces we own. For each of the following, identify the
implementation, the fanout pattern, and where it would break
under load:

- websocket fanout (which server, what library, broadcast
  pattern, per-connection memory)
- chat (storage path, write rate, read fanout, moderation hooks)
- reactions / hearts (same axes; usually higher volume than chat)
- order updates pushed to viewers during a live stream
- presence tracking (viewer count) — pull vs push, refresh
  interval, accuracy guarantee
- replay polling (any client polling that runs during live or
  immediately after stream end)

For each surface, estimate the **first bottleneck under load** —
which resource (CPU, memory, DB connection, websocket fd, Stripe
rate limit, IVS API rate limit) saturates first, and at roughly
what concurrent-viewer count.

Conclude with a **sandbox load-test plan** that names:

- target environment (sandbox/staging, never prod)
- viewer concurrency steps (e.g. 10 → 50 → 200 → 500)
- what to instrument (which metrics, where they're collected)
- what counts as pass/fail
- estimated cost / risk

**Do not run the load test in this audit.** The plan is the
deliverable.

### Section 6 — Replay reliability

Trace the replay / VOD lifecycle end-to-end:

- Asset creation: when does a recording get persisted, where
  (IVS auto-record to S3? a separate VOD pipeline?), under what
  channel config.
- Asset persistence: what we store vs what IVS stores, naming /
  pathing, lifecycle policy, deletion policy.
- Playback path: how a viewer arrives at a replay URL, how the
  player picks the VOD manifest, how it differs from live
  playback.
- Replay purchase flow dependencies: which surfaces let a viewer
  buy from a replay, where the Stripe session is created, whether
  the seller's connected account is still required, whether any
  product/inventory state is snapshotted at stream time or pulled
  live at purchase time.

Identify **likely failure points** with one of:

- recording not started (channel config drift)
- recording started but asset never finalized
- manifest URL stale / 404
- product/inventory state has changed since the stream and the
  buyer sees something that's no longer available
- application_fee_amount mis-set on replay purchases (cross-link
  to the platform-fee doctrine — but do not audit historical fees
  in this task)

---

## DELIVERABLE FORMAT

Single markdown file:

    .claude/audits/livestream-reliability-audit-<YYYY-MM-DD>.md

Top of file: one-line summary + one-line verdict ("ready for
launch / soft launch only / needs work before any merchant
broadcasts").

Sections, in this order:

1. Section 1 — IVS go-live latency path
2. Section 2 — First-frame playback analysis
3. Section 3 — Mobile live stability
4. Section 4 — Mux inventory audit
5. Section 5 — Viewer scalability surface
6. Section 6 — Replay reliability
7. **Findings table (prioritized, all sections combined)**
8. **Quick wins vs structural fixes**
9. **Recommended next tasks** (names only, not created)
10. **Open questions** (anything that needed a device test, a
    prod log, or an answer from the operator)

### Findings table columns

| # | Title | Surface | Severity | Effort | Evidence | Recommendation |

Severity rubric:

- **Critical** — blocks launch. A real merchant cannot broadcast
  reliably, or viewers cannot watch reliably, today.
- **High** — degrades launch experience materially. First impression
  damage, lost sales, support burden.
- **Medium** — noticeable but tolerable. Fix before scaling past
  the founding 100.
- **Low** — polish. Schedule when Priority 1-5 are closed out.

Effort labels:

- **XS** — under an hour
- **S** — half-day or less
- **M** — one to three days
- **L** — multi-day, needs design

### Quick wins vs structural fixes section

Two short lists. **Quick wins** = severity High or Critical AND
effort XS or S. Anything else with a recommendation goes under
**Structural fixes** with a one-line note on what makes it
structural (architecture change, infra cost, breaking change,
needs design review, etc.).

### Recommended next tasks

Bullet list. Each entry: task name in `kebab-case`, one-line
description, finding numbers it resolves. Do NOT create the task
files in this audit. Suggested naming pattern:

- `livestream-go-live-latency-fix`
- `livestream-first-frame-startup-fix`
- `livestream-mobile-stability-fix`
- `mux-dead-code-removal`
- `livestream-viewer-fanout-loadtest` (the sandbox load test as
  its own task, gated on operator approval)
- `replay-purchase-flow-hardening`

---

## WHAT NOT TO DO

- Do NOT edit any application code.
- Do NOT edit any config (env files, IVS console, Vercel,
  Railway, Supabase, GitHub Actions).
- Do NOT deploy anything.
- Do NOT apply database migrations.
- Do NOT call any Stripe API (read or write).
- Do NOT call any IVS API that mutates state (no
  CreateChannel, no PutMetadata, no StopStream). Read-only IVS
  describes are allowed only if absolutely necessary to answer a
  latency question — prefer code reading first.
- Do NOT run the load test described in Section 5. The plan is
  the deliverable.
- Do NOT delete any Mux code, even files classified as dead.
  Cleanup is a separate task gated on operator approval.
- Do NOT create the follow-up task files named in Section 9. Names
  only.
- Do NOT touch the historical platform-fee reconciliation — that
  is parked under `historical-platform-fee-reconciliation` and is
  explicitly out of scope for this audit.
- Do NOT expand scope into crypto / Solana / DAO / NFT / token UX.
- Do NOT propose new billing experiments.
- Do NOT speculatively rewrite or "modernize" code. If a finding
  recommends a rewrite, justify it with a measured cost — not
  taste.
- Do NOT post anything outside the repo (Slack, email, GitHub
  comments, PR descriptions). The deliverable is a file on the
  branch.
- Do NOT commit the audit report from inside the read-only run.
  After the report is written, STOP. Operator decides whether to
  commit, edit, or discard.

---

## EXECUTION CONTRACT

When the operator says `run task: livestream-reliability-audit`:

1. Confirm we are not on `main`. Read-only exemption applies, so
   running from the current feature branch (or `main`) is allowed,
   but log the branch in the report header.
2. Restate the audit scope in one sentence.
3. Execute Sections 1-6 in order, using Read/Grep/Bash (read-only
   shell) and the Explore subagent for breadth. No write tools.
4. Compose the markdown deliverable at the path above.
5. Print a summary to the operator: total findings, count by
   severity, top 3 by severity-then-effort, and the verdict line.
6. STOP per the HARD STOP RULE. Do not commit. Do not start any
   of the recommended follow-up tasks.

---

## ACCEPTANCE CRITERIA FOR THE AUDIT REPORT

The report is acceptable when:

- All 6 sections are present and non-empty.
- Every finding cites at least one `file_path:line_number`
  reference OR is explicitly marked `unknown — needs device test`
  / `unknown — needs prod log`.
- Severity and effort labels are assigned for every finding.
- The findings table is sorted by severity descending, then
  effort ascending.
- Quick wins vs structural fixes is non-empty (or explicitly
  states "no quick wins identified" with reasoning).
- Recommended next tasks are named in `kebab-case` and each maps
  to at least one finding number.
- The verdict line at the top is one of:
  `ready for launch` / `soft launch only` / `needs work before
  any merchant broadcasts` — pick one, don't hedge.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
