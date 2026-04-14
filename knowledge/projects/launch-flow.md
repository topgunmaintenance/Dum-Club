# Launch Flow

> STATUS (Phase 0 — April 2026): This subsystem is
> technically active but de-emphasized in the current
> product direction. See CLAUDE.md v5.0 for current
> positioning. Do not surface these features in UI
> until phase unlock conditions are met.

## Endpoint

POST /api/launch/ (backend/api/routes/launch.py)

## Steps

1. Receive idea + wallet_address + owner_id
2. Rate limit check: max 5 per wallet per 24h
3. AI generates metadata (name, description, offers, pricing)
   - Primary: Claude API
   - Fallback: OpenAI → Ollama → raw idea
4. Create project record (auto-approved, status=live)
5. Create simulated token (SIM_ prefix)
6. Auto-generate 1-3 draft offers
7. Award +25 DUM Points
8. Return project_id → frontend redirects to /project/{id}

## Auth

Launch endpoint does NOT require auth. Wallet address is validated but not authenticated. This is intentional for frictionless first experience.

## AI generation quality

- Names: should feel human-chosen, not generic
- Offers: 3 tiers (basic/standard/premium structure)
- Pricing: realistic for the business category
- Descriptions: 2-3 sentences, confident, category-appropriate

## Key files

- Backend: backend/api/routes/launch.py (lines 533-790)
- Frontend: frontend/app/page.tsx (handleHeroLaunch)

## Known limitations

- Ollama may not be running on Railway (no Docker Ollama)
- ANTHROPIC_API_KEY required for reliable generation
- Offer generation can silently fail — project still launches with 0 offers
