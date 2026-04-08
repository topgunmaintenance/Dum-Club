# Claude Engineering Rules — DUM Club

## Priority Rule

When conflicts exist:
1. `production.md` rules override everything
2. `marketplace-checklist.md` defines completion
3. `debug-template.md` defines structure

Do not bypass these for speed.

---

## Product Context

DUM Club is an AI-powered business creation platform on Solana.
Read `product.md` for the full product direction before making any changes.

The platform's core loop: **Describe → Launch → Grow**

---

## Current Transition Priority — Input-First Upgrade

Dum Club is already largely built and functioning (~85% complete). The current goal is NOT to rebuild the system.

We are transitioning the product toward a more input-first, minimal, faster UX model while preserving the existing architecture.

### What Already Works (Do NOT Break)
- AI launch flow: idea → AI generates → storefront with offers → live
- Auth: Google sign-in via Privy + auto embedded wallet
- Payments: Stripe checkout + order emails (buyer + seller)
- Projects, dashboard, discover, project pages
- Storefront/Exchange split (business-first default, crypto in Exchange)
- Supporter/perks language (crypto hidden from storefront views)
- Token auto-creation on project launch (simulated mint)
- Shooting stars background, side navigation, premium UI

### Hybrid Model (Active)
- **Storefront** (default): supporters, rewards, perks, business language
- **Exchange** (advanced): token, price, market, trade language
- Users never see crypto unless they intentionally click Exchange

### Critical Rules for This Transition
- Do NOT rebuild the product from scratch
- Do NOT replace working architecture unless explicitly asked
- Do NOT modify backend endpoints unless absolutely required
- Do NOT introduce new database tables or draft systems
- Reuse the current /build launch logic whenever possible
- Prefer small, isolated frontend changes over broad refactors
- Preserve working flows: auth, wallet creation, project launch, dashboard, discover, Stripe checkout
- The homepage may become the new fast entry point, but /build should remain usable as a fallback path
- Users become businesses by launching — there is no separate business registration flow
- Optimize for speed, clarity, and minimal break risk

### Definition of Success
The upgraded experience should reduce friction:
type idea → authenticate → auto-wallet → launch → land on live project

This is a transition and polish phase, not a rewrite phase.

### Off-Platform → On-Platform Growth Engine (Additive Layer)

DUM Club is building a customer acquisition engine on top of the existing launch flow. See `product.md` "Off-Platform → On-Platform Growth Engine".

The engine is implemented as thin agent modules in `backend/services/agents/`:

- `base.py` — `AgentResult` dataclass + `Agent` protocol. No framework, no new deps.
- `local_discovery.py` — the **Local Discovery Agent**. Merges DUM Club project matches and nearby off-platform results (Google Places) into one labeled result set. Shipped in PR: local discovery only.
- `purchase_proof.py` — the **Purchase Proof Agent**. Future PR. Do not build in the local-discovery PR.
- `rewards.py` — the **Rewards Agent**. Future PR. Do not refactor reward logic out of `dum_points.py` or `external_business.py` until the dedicated Rewards Agent PR.

Rules for anyone touching this layer:

- Agents are **additive**. `backend/api/routes/search.py`, `backend/services/external_places.py`, and `backend/api/routes/external_business.py` stay as the HTTP surface. Agent modules are called from the routes, not the other way around.
- Every agent stays deterministic. No LLM calls, no OCR, no network in the agent core unless the spec explicitly says so. External providers are injected so tests can mock them.
- Every new behavior is behind a feature flag in `backend/api/routes/feature_flags.py`. Off by default. When the flag is off, the route falls back to the previous code path byte-for-byte.
- The wire contract of `POST /api/search/homepage` does not break. New fields may be added; existing fields may not be removed or renamed.
- Outreach "sent" state is only ever set after an actual send action. Never mark an outreach row as `sent` just because the agent queued it.

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

### Language (Hybrid Model)
- Follow the language guidelines in `product.md`
- **Storefront/default:** supporters, perks, rewards, back this project, storefront, offers
- **Exchange/advanced:** token, trade, price, market cap, buy/sell
- Never mix crypto language into the storefront experience
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
