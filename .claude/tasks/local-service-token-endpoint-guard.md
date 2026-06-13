TASK: local-service-token-endpoint-guard

Gate 3 — visible 500s / hygiene. Guard the token/market endpoints to
NO-OP cleanly for projects that have no token/mint (template_type
"local_service" and any project with NULL token_status / token_symbol),
returning a clean empty/zero payload instead of erroring.

SEPARATE FROM THE AI FLAG. This is unrelated to ENABLE_AI_FEATURES
(#414), which only hides AI render surfaces on the frontend. This task
is a BACKEND correctness fix on the token/market data path. Do not
conflate them.

SEPARATE FROM (AND SUCCESSOR TO) PR #396. PR #396 ("token 500 leak
hygiene") is MERGED (2026-06-11). It did ONLY message sanitization —
it stopped returning raw exception / subprocess stderr text to clients
in market.py and token.py. Its own body states: "Bug 1 (token-economy
500s) root cause is not in this PR — the audit found no deterministic
unguarded crash in the token handlers; this PR only fixes the leak
hygiene. Pinning the exact 500 needs the prod error log." So the REAL
fix (a guard/no-op for no-token projects) was explicitly deferred and
is THIS task.

Problem shape:
DUM Club has token-economy projects (token_symbol + on-chain mint, a
token_status lifecycle draft -> trading_live) AND plain local-service
storefronts (template_type "local_service", e.g. Topgun) that have NO
token at all. Token/market endpoints that assume a token exists can
500 (or return misleading data) when hit against a no-token project.
market.py already degrades softly (_get_market_row returns a zero-
filled dict when project_market_state has no row), but the audit did
NOT find/confirm every token endpoint does the same — the deterministic
500 was never pinned because it needs the prod error log.

Implementation steps:
1. PINPOINT FIRST (needs prod signal): pull the prod error log for the
   token-economy 500s (Railway/Sentry) to identify the exact endpoint
   + input that crashes against a local_service project. Do not guess;
   the #396 audit already failed to find it by static reading.
2. GUARD, don't just sanitize: in each token/market endpoint that can
   be hit for a no-token project, detect "no token" early
   (template_type == "local_service" OR token_status IS NULL OR
   token_symbol IS NULL) and return a clean, explicit empty/zero
   response (mirror market.py:_get_market_row's zero-fill pattern) with
   a 200, rather than proceeding into token-assuming code that 500s.
   The frontend already tolerates zero/absent market data on service
   storefronts (the project page renders services without a token
   panel).
3. Keep it a NO-OP, not a feature: no new token behavior, no UI change.
   The goal is "service storefronts never trigger a token 500."

Risks:
- Do not change behavior for real token-economy projects (token_status
  present) — only the no-token branch returns the empty payload.
- Confirm the guard covers GET market, any token quote/mint status
  read, and the project-page fan-in (/public + /market) path.

Human-review point: reproduce the original 500 against a local_service
project (e.g. topgun-maintenance) BEFORE and confirm a clean 200 AFTER;
confirm a real token project's market still returns live data.

No migration. No schema change. Backend-only guard. If a fix needs to
touch more than the token/market route handlers, stop and report.
