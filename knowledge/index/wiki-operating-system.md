# Knowledge System Operating Rules

## Folder purposes

- **raw/** — messy source material. Transcripts, notes, pasted outputs, PR summaries. Temporary. Gets cleaned into wiki or deleted.
- **wiki/** — cleaned, structured, evergreen docs. Rewritten from raw inputs. Should be readable by anyone.
- **index/** — top-level entry docs. Architecture, product truth, deployment map, system maps. Start here.
- **log/** — chronological. Dated entries for changes, decisions, milestones, regressions, merges.
- **prompts/** — master prompts, handoff prompts, stabilization prompts used with Claude Code.
- **bugs/** — recurring issues, root causes, fixes, known gotchas. Prevents re-investigation.
- **demo/** — pitch flow, judge talking points, differentiators, demo scripts.
- **projects/** — per-feature or per-subsystem notes. Auth, checkout, AI employee, DUM Points, etc.

## Rules

1. raw is messy. wiki is clean. Never confuse the two.
2. log is chronological and factual. No opinions.
3. No duplicate truth across files unless intentional (e.g. a summary in index that links to detail in projects).
4. Important product truth gets promoted into index docs.
5. When code changes materially, update the relevant wiki or projects doc.
6. When bugs are fixed, add root cause and fix to bugs/ or log/.
7. Keep docs concise, factual, scannable. No walls of text.
8. Prefer short sentences and clear headers over paragraphs.

## How Claude Code should use this

- Before making changes: check relevant index/ and projects/ docs for context.
- After making changes: update relevant docs if the change is material.
- For debugging: check bugs/ first for known issues.
- For demos: check demo/ for current scripts and talking points.
- For handoffs: use log/ to record what happened.

## What goes where

| Situation | Destination |
|-----------|------------|
| New feature shipped | projects/{feature}.md + log/ entry |
| Bug found and fixed | bugs/common-failures.md |
| Architecture decision | index/current-architecture.md |
| Product direction change | index/product-truth.md |
| Demo script update | demo/judge-demo-script.md |
| Session notes | raw/ (then clean into wiki if valuable) |
