# Task: visual-qa-preview-pricing-assertions

**Type:** Code change — workflow + test additions.
**Branch policy:** Per CLAUDE.md v5.0, create a
`feature/visual-qa-preview-pricing-assertions` branch off
latest main before editing.
**Status:** Spec only. Execution requires the explicit phrase
`run task: visual-qa-preview-pricing-assertions`.
**Priority context:** Direct response to a gap surfaced during
the PR #239 (1% sales fee activation) merge gate. The current
`.github/workflows/visual-qa.yml` resolves `BASE_URL` to
`https://www.dum.club` (production) for `pull_request` triggers
— it does NOT test against the PR's own Vercel preview. A
visual-qa "pass" on a PR therefore only proves that production
is not broken right now; it does NOT verify the PR's specific
changes render correctly. The pricing gate PR #239 had to
satisfy was actually satisfied by manual content audit
(grep + diff review), not by visual-qa.

---

## OBJECTIVE

Close two gaps in the visual-qa workflow:

1. Make `pull_request` triggers test against the PR's own
   Vercel preview URL, not against production.
2. Add pricing-specific assertions that fail when canonical
   tier prices ($39 / $99 / $299 / $499 / $2,000+) or the
   "1% sales fee" disclosure regress.

After this lands, a PR that introduces a stale
"Plans start at $29/month" string anywhere on the named public
marketing surfaces fails visual-qa instead of silently passing.

---

## WHAT TO DO

### 1. Workflow — derive preview URL from the Vercel deployment

Edit `.github/workflows/visual-qa.yml`:

- In the `Resolve BASE_URL` step, add a branch for
  `pull_request` triggers that resolves the Vercel preview URL
  for the PR's head SHA. Pick the simplest method that
  actually works in this repo's setup. Options to consider:
  - **Parse the Vercel bot comment.** The
    `Vercel Preview Comments` check already posts a comment
    on each PR with the preview URL. Read PR comments via
    `actions/github-script`, find the most recent
    `vercel[bot]` comment, regex out the preview URL.
    Simple, no new secrets.
  - **Vercel REST API.** `GET
    /v6/deployments?gitSource.ref=<branch>&projectId=...`
    returns the latest deployment for the branch. Requires
    a `VERCEL_TOKEN` repo secret + the project ID.
  - **Deployment status events.** Wait for the
    `deployment_status` webhook to fire with `state =
    success`. Requires changing the workflow trigger.
- For `workflow_dispatch` runs, keep the existing
  `inputs.base_url` override.
- For `push` to main (post-merge), keep the existing
  production fallback (`https://www.dum.club`).
- The job MUST wait for the Vercel preview to reach `READY`
  before running tests. If the preview is not ready within
  the existing 10-minute job timeout, fail with a clear
  message ("Vercel preview never reached READY; visual-qa
  cannot verify PR-specific changes").

### 2. Pricing assertion spec

Add `frontend/tests/visual/pricing.spec.ts`. Assertions
against the canonical tier structure — re-read CLAUDE.md §3
when writing this file so the numbers are correct at the
time of writing (the doctrine may have moved between this
spec and execution):

- **/pricing** must visibly show:
  - `Starter` + `$39`
  - `Growth` + `$99`
  - `Pro` + `$299`
  - At least one mention of `$499` (Business)
  - At least one mention of `$2,000+` (Enterprise)
  - At least one mention of `1% sales fee`
- **/** (homepage) must visibly show:
  - `$39` somewhere in a Starter / Plans-start-at context
  - At least one mention of `1% sales fee`
- **/merchant** must visibly show:
  - `$39/month` OR `$39/mo`
  - `1% sales fee`
- **/business** must visibly show:
  - `$39 to $299` or equivalent tier range
  - `1% sales fee`

For each assertion, use Playwright's `page.getByText` and
`toBeVisible({ timeout: 8_000 })`. Take a full-page screenshot
of each surface so failures are debuggable from the artifact.

### 3. Forbidden-string assertions

Add a separate test in `pricing.spec.ts` that fails if any of
these strings appear visibly on the four public surfaces
above:

- `$29 to $99` (old tier range)
- `Plans start at $29` (old Starter base)
- `0% commission` (replaced doctrine)
- `Keep every sale` when not followed by a fee
  clarification on the same line (start with a plain
  exact-match assertion and refine if it false-positives
  against legitimate copy)

The failure message MUST name the page route AND the matched
string, so the next PR author knows exactly which surface
needs updating.

### 4. CI gate

The existing `Fail job if tests failed` step at the bottom of
`.github/workflows/visual-qa.yml` already converts spec
failures into a red check. No new gate needed unless the
workflow's job structure changes.

---

## WHAT NOT TO DO

- Do NOT change tier dollar amounts anywhere in production
  code or copy. This task only adds assertions; copy fixes
  live in their own PRs.
- Do NOT add a separate CI job for pricing assertions. They
  ride inside the existing `visual-qa` job to keep one CI
  signal per PR.
- Do NOT couple this task to a Vercel-token rotation or
  service-account creation. If the simplest preview-URL
  discovery method requires a new repo secret, document the
  required secret in the workflow file's top comment block
  and stop — let a human add the secret out-of-band.
- Do NOT delete or weaken the existing smoke specs
  (`homepage`, `discover`, `merchant`, `install`,
  `project-page`, `embed-bubble`). Pricing assertions are
  additive.
- Do NOT add assertions for dashboard, admin, or
  signed-in flows. Those are out of public-pricing scope
  and require auth state that visual-qa does not yet have.

---

## DELIVERABLE

One commit on `feature/visual-qa-preview-pricing-assertions`
containing:

- Updated `.github/workflows/visual-qa.yml`
- New `frontend/tests/visual/pricing.spec.ts`
- (If needed) Updated `frontend/playwright.config.ts` to
  honor the new BASE_URL semantics

Plus a PR description noting:

- Which preview-URL discovery method was chosen and why
- Whether a new GitHub Actions secret was required and
  what it should contain
- A link to one CI run on the resulting PR showing the new
  pricing assertions firing against the preview URL

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
