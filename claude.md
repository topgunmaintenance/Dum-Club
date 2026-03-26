# CLAUDE PROJECT RULES — DUM CLUB

## ROLE
You are assisting in building a production-ready web application called DUM Club.

Act like a careful senior developer:
- make minimal, precise, safe changes
- do not overengineer
- do not break working features
- preserve the current direction of the product

## PROJECT CONTEXT
Current stack:
- Frontend: Next.js deployed on Vercel
- Backend: FastAPI deployed on Railway
- Database: Supabase (PostgreSQL)
- Blockchain: Solana
- Wallet/Auth: Wallet-based authentication
- AI layer: Ollama llama3 for project memory/chat
- Product direction: See PRODUCT.md before making feature, UI, or naming decisions

## DESIGN SYSTEM
- Background: Black (#000000)
- Accent: #00FF87
- Code font: JetBrains Mono
- Body font: Space Grotesk
- UI must be clean, modern, minimal, and uncluttered
- Improve one section or component at a time
- Reuse existing styles and components where possible
- Reference 21st.dev for individual components when useful

## CORE RULES
1. Only modify files directly related to the current task.
2. Do not refactor or rewrite working code unless explicitly told.
3. Keep changes small, isolated, and reversible.
4. Do not add unrelated systems, pages, or features unless requested.
5. Preserve existing functionality unless the task explicitly changes it.
6. Follow existing project patterns and naming conventions unless told otherwise.
7. Do not add mock logic, placeholder code, or stub features unless explicitly requested.
8. Do not install new packages or dependencies without approval.
9. Do not modify database schema, migrations, or SQL without approval.
10. If something is unclear, make the safest reasonable assumption only if it affects a small local change. If it affects architecture, auth, database, API shape, or multiple systems, stop and propose a plan first.

## REQUIRED WORKFLOW

Before coding:
- Read claude.md and PRODUCT.md
- Review the relevant files
- Briefly explain what you plan to change
- Identify the smallest possible implementation path

During coding:
- Make the smallest possible working change
- Do not touch unrelated files
- Preserve existing flows, integrations, and response shapes unless the task requires a change
- Keep code readable, production-friendly, and consistent with the current codebase

After coding:
- List exactly which files were changed
- Explain what was changed and why
- Note any risks, assumptions, or follow-up items
- Show the diff summary in plain language

## GIT WORKFLOW
- For each new scoped task, create a new branch before making code changes
- Branch names should be short and descriptive, based on the task
- Do not commit, push, merge, reset, rebase, checkout another branch, or revert unless explicitly instructed
- After making changes, stop and wait for my review before any commit or push
- Once I approve, then commit and push the current branch
- Never make git decisions silently

## FRONTEND WORKFLOW
Follow this order for UI work:
1. Read claude.md and PRODUCT.md before touching UI
2. Use installed front-end design skills to produce polished, intentional UI
3. Use screenshot-based iteration when available
4. If an inspiration site is provided, study its structure, spacing, hierarchy, and feel without copying unnecessary complexity
5. Use 21st.dev components selectively for focused UI upgrades only

## FRONTEND RULES
- Do not redesign entire pages unless asked
- Prefer small component-level improvements
- Improve spacing, hierarchy, readability, and clarity
- Keep layouts responsive and production-friendly
- Reuse existing components before creating new ones
- Use screenshot review when tooling is available, but do not block progress if screenshot tooling is unavailable

## BACKEND RULES
- Do not break existing API routes
- Keep backend logic simple, readable, and consistent with current patterns
- Do not change response shapes unless required by the task
- Do not introduce hidden side effects
- Respect current auth, permissions, and validation patterns

## SAFETY RULES
- Do not make broad architectural changes without approval
- Do not create or modify migrations without approval
- Do not install dependencies without approval
- Do not overwrite or undo recent work unless explicitly instructed
- Treat the current codebase as the baseline, not something to redesign from scratch

## GOAL
Build DUM Club step by step in a stable, testable way without breaking existing features.
