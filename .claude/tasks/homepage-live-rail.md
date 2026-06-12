TASK: homepage-live-rail

Unify the homepage "Live Now" section on the shared discover
LiveRail component, and give the rail a card cap.

Background (confirmed before go):
- /project/{slug}?live=1 is the CORRECT link target. The project
  page renders the full live-watch experience (LIVE banner, video
  player, LiveChatIVS, buy flow) whenever the project's is_live
  state is true. The ?live=1 param is inert and read nowhere;
  it stays on the href as harmless self-documentation. Do NOT
  add logic that depends on it.
- The homepage currently renders a bespoke LiveNowSection that
  duplicates the rail concept: it links to /project/{id} without
  slug, fires one /api/offers/{id} fetch per live project on
  load, and hides any live seller who has no priced offer.

Requirements:
1. LiveRail (components/discover/LiveRail.tsx):
   - render at most 12 live cards
   - if more than 12 projects are live, append one overflow card
     "+N more live" linking to /discover?live=1 (the discover
     page already reads live=1 and switches to live-only)
   - ordering: inherit the order of the projects prop as-is
2. Homepage (app/page.tsx):
   - render LiveRail in place of LiveNowSection, feeding it the
     existing liveNowProjects list (same data source, same
     length > 0 render gate, same vertical spacing)
   - delete the now-unused LiveNowSection component and
     LiveNowCard type (duplicate section; doctrine forbids two
     versions of the same section)

Rules:
- ONLY real data; live sellers without a priced offer render
  without a price line, never with a fake one
- no new dependencies
- do NOT add live_started_at or ANY migration in this task;
  that is queued separately as live-started-at
- frontend only

STOP after the PR is open. No merge without a separate explicit
go after diff review.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
