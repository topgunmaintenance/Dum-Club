# AI Employee System

## Architecture

- Backend: POST /api/ai/project-chat (ai_chat.py)
- Frontend: AiSalesChat.tsx (floating chat component)
- LLM: Claude Haiku via Anthropic SDK
- Data source: Supabase (projects + offers tables)

## How it works

1. Frontend sends project_id + user message + last 8 messages as history
2. Backend fetches project data + active offers from Supabase
3. Backend builds a structured knowledge packet (system prompt)
4. Sends to Claude Haiku with 512 token max
5. Returns response + offer list for frontend linking

## Knowledge packet structure

The AI employee receives ONLY:
- business_summary: name, category, description
- offer_catalog: title, price, description for each active offer
- recommendation_rules: which offer to suggest by default (mid-tier)
- assistant_identity: tone derived from business category
- constraints: strict rules about what it can and cannot say

The AI employee NEVER receives:
- Internal engineering notes
- Deployment details
- Roadmap or strategy docs
- Bug reports
- Token/blockchain details
- Any wiki content directly

## Identity system

- Monogram: 2-letter initials from business name
- Accent color: deterministic from name hash (8-color palette)
- Tone: matches business category (direct for services, warm for food, etc.)

## Guardrails

1. Only discuss listed offers — never invent
2. Never invent prices, discounts, policies, or availability
3. Never say "as an AI" — represent the business
4. Never mention DUM Club, tokens, crypto
5. Never use markdown in responses
6. If info is missing: "That's not listed here, but I can help you choose"
7. Keep responses to 2-3 sentences
8. Bias toward recommending the mid-tier offer

## Frontend behavior

- Floating button: visible when offers.length > 0
- Quick prompts: "What do you offer?", "Which should I pick?", "What's most popular?"
- Offer linking: offer names in responses become clickable
- Mobile: positioned above sticky CTA bar (bottom-20)
- DumPill hidden on project pages to avoid overlap
