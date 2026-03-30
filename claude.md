# Claude Engineering Rules — DUM Club

## Product Context

DUM Club is an AI-powered Solana launchpad for ideas.
Read `product.md` for the full product direction before making any changes.

The platform's core loop: **Describe → Generate → Launch → Discover → Evolve**

---

## Development Rules

### Before Writing Code
1. Read `product.md` to confirm the change aligns with product direction
2. Read existing files before editing them
3. Identify the smallest change that achieves the goal — no extra abstractions
4. Do not add features beyond what was asked

### Branching
- Branch from: `main`
- Feature branches: `feat/<short-description>`
- Fix branches: `fix/<short-description>`
- Always push to your designated branch

### Code Quality
- No backwards-compatibility hacks
- No error handling for scenarios that can't happen
- No helpers/utilities for one-time operations
- No docstrings/comments on code you didn't change
- Trust internal framework guarantees; validate only at system boundaries

### Security
- Never introduce command injection, XSS, or SQL injection
- Validate all user input at API boundaries
- Do not expose admin routes without auth guards

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 + TypeScript (app router) |
| Backend | FastAPI (Python 3.11) |
| Database | Supabase + pgvector |
| AI | Ollama + LlamaIndex |
| Blockchain | Solana |
| Wallets | Phantom / Solflare / Backpack |

---

## UI/UX Rules

### Language
- Follow the language guidelines in `product.md`
- Lead with "launch your idea" not "buy a service"
- Tokens are demand signals first, utility second
- Never promise guaranteed fulfillment in UI copy

### Pages That Should Exist
- `/` — Landing: idea → launch pitch
- `/discover` — Trending projects feed
- `/chat` — AI project creation chat
- `/dashboard` — User's projects
- `/project/[id]` — Project page with token market

### Pages That Are Lower Priority
- Booking/scheduling flows — only relevant *after* a project proves demand
- Redemption/verify flows — same, post-traction feature

These can stay in the codebase but should not be primary navigation or prominently featured in the UI.

---

## What NOT to Build (Without Explicit Approval)

- Direct service guarantee systems
- Legal marketplace infrastructure
- Investment or yield features
- Anything that implies securities

---

## Commit Style

Short imperative commits:
- `feat: add project creation chat flow`
- `fix: token status normalization`
- `chore: update product copy on landing page`

---

## Testing Mindset

- Manually verify the core loop works: describe → generate → launch → token live
- Token trading and price movement should work end-to-end
- AI chat for project creation should be the primary happy path
- The user should feel an immediate visible result after launching an idea

---

## Operational Rules

These rules are mandatory for all debugging, fixing, and deployment work.
See also: `production.md`, `marketplace-checklist.md`, `debug-template.md`, `handoff-template.md`.

### Scope Control
Before changing code, identify:
- exact frontend handler
- exact backend route
- exact DB table(s)
- exact deployment target(s)

Do not modify unrelated files. Do not refactor unrelated code. Do not redesign UI unless explicitly requested.

### Deployment Awareness (CRITICAL)
Before debugging any issue involving offers, checkout, token trading, auth, file upload, or project creation:
1. Verify GitHub branch and latest commit
2. Verify Vercel deployment commit
3. Verify Railway deployment commit

If backend and frontend are not on aligned commits — STOP. Report the mismatch. Do not change application logic until deployment is aligned.

### Bug Classification
Always classify every issue as one of before proposing a fix:
- code bug
- deployment mismatch
- environment variable issue
- DB / RLS issue
- stale cache issue
- third-party service issue
- user-flow misunderstanding

### Root Cause Rule
Do not claim a fix based only on reading code. You must identify:
1. symptom
2. failing layer
3. root cause
4. minimal fix
5. proof

### No Silent Failure Rule
Never allow silent returns for user actions. No early return in user-triggered flows unless:
- a visible user-facing error is shown
- a console or backend log is written

### Evidence Rule
Do not say "fixed" unless you provide evidence for:
- request fired
- backend route hit
- DB write succeeded
- UI refreshed correctly

### Logging Rule
For transactional flows, add temporary logs if needed. If logs are added: keep them scoped, label them clearly, remove or downgrade noisy logs after verification.

### Report Format Rule
Every bug report must follow `debug-template.md`. Every session must end with `handoff-template.md`.

### System Separation Rule
Treat these as separate systems even if they share a page:
- Creator Offers (create, edit, list)
- Offer Checkout / Order lifecycle
- Token Buy/Sell market
- Project manage/admin state

Do not assume a fix for one is safe for another. Never change more than one system in a single commit unless the root cause spans both.

### Freeze Rule
After stabilizing a critical flow, freeze it. Do not refactor it during unrelated work. If a later task touches it, re-run its checklist from `marketplace-checklist.md`.

### Session End Rule
At the end of each work session, provide the handoff template:
- what changed
- what is verified
- what is unverified
- what branch contains the work
- whether GitHub/Vercel/Railway are aligned
- exact next step

### Banned Phrases
Never use:
- "probably fixed"
- "should work now"
- "looks good"

Only use:
- "verified fixed" (with evidence)
- "partially fixed" (state what remains)
- "root cause found, unverified in production"
- "blocked by deployment mismatch"
