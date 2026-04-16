# TASK: scope-audit

**Purpose:** Pre-flight check run BEFORE editing code on any
non-trivial task. Prevents duplicate sections, out-of-scope
deletions, and collisions with existing working behavior.

---

## WHAT TO DO

Before starting the requested task:

1. Inspect the relevant page/component by reading the files
   end-to-end. Do NOT skim. Use `Grep` to find every existing
   occurrence of keywords tied to the new feature (e.g. if the
   task adds a "search hero", grep for `search`, `hero`, and
   any related state names across the codebase).

2. Identify any existing sections/components that overlap
   with the request. Call out each one explicitly — heading
   text, line range, filename.

3. List the exact files that need to be touched. Be
   concrete: `frontend/app/page.tsx:2500-2541`, not just
   "page.tsx".

4. Explain what must be preserved:
   - working event handlers
   - active API calls and their endpoints
   - state variables referenced elsewhere
   - routes and links

5. Explain any risk of duplication or deletion:
   - Will this create a second version of an existing
     section?
   - Will this orphan working code elsewhere?
   - Will this break a contract with another page?

6. Map the task to the SCOPE PROTECTION RULE in CLAUDE.md.
   If any rule is at risk of being violated, say so.

---

## WHAT NOT TO DO

- Do NOT edit any code.
- Do NOT create any new files.
- Do NOT commit.
- Do NOT run `npm run build` (nothing to build yet).
- Do NOT proceed to the actual task even if the audit looks
  clean. Always wait for user confirmation.

**Read-only exemption:** Because this task is strictly
read-only (no edits, no files, no commits), it is exempt from
the PRE-TASK ROUTINE branch-creation step in `CLAUDE.md`.
`scope-audit` may run from `main`. The actual task that follows
this audit MUST still create a `feature/<task-name>` branch
per the standard routine.

---

## OUTPUT FORMAT

Reply with:

1. **Files to touch** — bullet list of `path:line-range`
2. **Existing overlap** — any section/component that already
   does something similar, and where it lives
3. **Must preserve** — specific working behavior that has to
   survive the change
4. **Risk of damage** — what could go wrong, ranked by
   severity
5. **Recommended approach** — modify existing vs. add new,
   with a one-sentence justification
6. **Ready for `run task: <name>`?** — yes/no, with blockers
   listed if no

Then STOP and wait for confirmation.

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
