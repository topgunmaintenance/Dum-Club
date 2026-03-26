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
