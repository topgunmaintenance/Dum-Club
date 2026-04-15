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
4. [ ] deals-section
5. [ ] automation-layer

## Notes

- search-hero (commits `f7a99ae` + `d65b397`) and live-section
  (commit `30d702b`) ride together on `feature/search-hero` and
  will merge to main via a single feature PR.
- "Done" in this queue means committed on a branch, not necessarily
  merged to main. Once a task is `[x]` it is skipped by
  "run next task" regardless of merge state.
- If a task needs to be re-done after a revert or rollback, flip
  its marker back to `[ ]` manually before invoking "run next task".
