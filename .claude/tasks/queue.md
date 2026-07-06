# DUM Club Task Queue

Ordered product tasks for the homepage and core product loop.
Updated on ship, not continuously.

Markers:
- `[ ]` — not done
- `[x]` — committed (points to the commit SHA where the work landed,
  on whichever branch; may or may not yet be merged to main)

When the user says **"run next task"**, Claude loads the first `[ ]`
entry top-to-bottom, resolves its task file at
`.claude/tasks/<name>.md`, and executes it per the DUM Club Execution
System in CLAUDE.md.

## Queue

1. [x] search-hero       — `d65b397` on `feature/search-hero`
2. [x] search-results    — committed on `feature/search-results`
3. [x] live-section      — `30d702b` on `feature/search-hero`
4. [x] deals-section     — `feature/deals-section` · 2026-04-15
5. [x] automation-layer  — `feature/automation-layer` · 2026-04-17
6. [x] discover-rebuild  — `feature/discover-rebuild` · 2026-04-19
7. [x] design-system-primitives    — `feature/design-system-primitives` · 2026-05-10
8. [x] header-redesign             — `feature/header-redesign` · 2026-05-10
9. [x] color-token-pass            — `feature/homepage-below-fold-migration` · 2026-05-10
10. [x] business-and-pricing-rebuild — `feature/pricing-real-page-and-business-light` · 2026-05-10
11. [x] merchant-light-and-square-cleanup — `feature/merchant-light-and-square-cleanup` · 2026-05-10
12. [x] dashboard-and-hub-light          — `feature/dashboard-and-hub-light` · 2026-05-10
13. [x] homepage-live-rail               — `feature/homepage-live-rail` · 2026-06-12
14. [x] live-started-at                  — `feature/live-started-at` · 2026-06-18 (migration 084 authored by operator)
15. [x] hero-demo-button                 — `feature/hero-demo-button` · 2026-07-06
16. [x] replay-recording-infra           — `feature/replay-recording-infra` · 2026-07-06
17. [ ] replay-storefront-loop
18. [ ] showcase-upload
19. [ ] bubble-showcase
20. [ ] replay-viewer-hour-metering

## Notes

- search-hero (commits `f7a99ae` + `d65b397`) and live-section
  (commit `30d702b`) ride together on `feature/search-hero` and
  will merge to main via a single feature PR.
- "Done" in this queue means committed on a branch, not necessarily
  merged to main. Once a task is `[x]` it is skipped by
  "run next task" regardless of merge state.
- If a task needs to be re-done after a revert or rollback, flip
  its marker back to `[ ]` manually before invoking "run next task".
- live-started-at is migration-gated: it adds
  `projects.live_started_at`, switches LiveRail to
  most-recently-live-first ordering, and powers the "Live for
  HH:MM" timer on the project page. Do not fold any of that into
  other tasks.
