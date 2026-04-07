# Business Identity System

## Components

- Monogram: 2-letter initials from business name (e.g. "Sparkle Pro" → "SP")
- Accent color: deterministic from name hash, 8-color palette
- Tone: derived from business category (archetype system)

## 8 Archetypes

| Archetype | Business types | Tone |
|-----------|---------------|------|
| Expert | Consulting, legal, finance | Measured, specific |
| Craftsperson | Handmade, bakery, custom | Warm, detail-oriented |
| Performer | Fitness, entertainment | Energetic, short sentences |
| Host | Restaurants, events | Welcoming, sensory |
| Builder | Tech, design, dev | Direct, outcome-focused |
| Guide | Education, wellness | Patient, encouraging |
| Curator | Subscription, retail | Taste-driven |
| Operator | Cleaning, maintenance | Efficient, reliable |

## Where identity appears

- AI chat button: monogram + accent color
- Chat header: monogram + business name
- Chat responses: monogram avatar
- Homepage demo: static example (Sparkle Pro, orange)

## Implementation

- Frontend: AiSalesChat.tsx (getAccentFromName, getMonogram)
- Color assignment: hash of business name mod 8 colors
- Archetype: not yet assigned in DB — future enhancement
