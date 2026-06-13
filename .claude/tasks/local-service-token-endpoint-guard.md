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

---

## AUDIT 2026-06-13 — step 1 (pinpoint) attempt + result

STEP 1 COULD NOT BE COMPLETED: no prod backend error log is reachable
from this session. The 500 surfaces in the Railway-hosted FastAPI app;
the available MCP tooling is Supabase / Vercel / GitHub only. Supabase
get_logs covers Supabase services (postgres/api/auth/...) NOT the
Railway app, and it required approval that wasn't granted. There is no
Railway or Sentry MCP. So the actual stack trace must be pulled by
whoever has Railway/Sentry access — see "What to pull" below.

STATIC TRACE RESULT (read-only, current main): NO deterministic
unguarded passive 500 found — which matches PR #396's own conclusion
verbatim ("the audit found no deterministic unguarded crash in the
token handlers"). Specifically:
- GET /api/projects/{id}/market (market.py:108) degrades softly:
  compute_market_snapshot null-guards the project read as
  `(project or {})`, and _get_market_row returns a zero-filled dict
  when project_market_state has no row. No token => zeros, not a 500.
- GET /trades (market.py:158), /balance/{wallet} (:175),
  /candles (:447), /activity/recent-trades (:464): same soft pattern
  against project_balances / market tables; empty => empty, not a 500.
- token.py create-token (:25) and mint-tokens (:128) are OWNER-
  triggered POSTs that 400 cleanly on incomplete metadata. The only
  500 is the mint subprocess failure (token.py:208-209) — already
  sanitized by #396, and it is NOT a passive local_service read path.

INTERPRETATION: the reported "token-economy 500s for local_service"
is NOT reproducible from code or from the logs reachable here. It is
either (a) already mitigated incidentally by the soft-degrade paths
above, (b) a transient/dependency error (Supabase timeout, Solana RPC)
that surfaced as a 500 and got mis-attributed, or (c) on a code path
not yet identified. Do not write a guard against a guessed line.

WHAT TO PULL (hand to whoever has Railway/Sentry):
1. Railway deploy logs for the API service, filter: status 500 AND
   (path contains "/market" OR "/trades" OR "/candles" OR "token")
   over the window when the 500s were observed.
2. The full traceback + the request path + the project slug/id.
3. Confirm the project hit is template_type "local_service" with NULL
   token_status/token_symbol.

ONLY AFTER the real endpoint + crash line is in hand: resume at step 2
(guard/no-op) of this file. Until then this task is BLOCKED on the
prod error log — not on engineering. Flag to Julian.

---

## AUDIT 2026-06-13 (part 2) — prod signals from the browser agent

Two findings from live Railway + prod-DB access. They MATERIALLY
correct this task; read before any implementation.

FINDING A — NO CURRENT 500s. Railway HTTP logs (active deploy, PR #414)
filtered @httpStatus:500 returned ZERO results. Deploy logs show, for
the local_service project topgun-maintenance, GET .../candles, /market,
and /token-metadata all returning 200 OK right now. (Caveat: Railway's
HTTP-log view is scoped to the ~5h-old current deploy, so older 500s
from the original audit window may have rolled off retention — i.e.
"no repro" is "not firing now," not "never happened.")

FINDING B — THE NULL-TOKEN DETECTION CONDITION IS WRONG. Prod row for
slug='topgun-maintenance': template_type='local_service' BUT
token_status='inactive' and token_symbol='TOPGUN' — BOTH NON-NULL. So
the condition this doc originally proposed ("token_status IS NULL OR
token_symbol IS NULL") would NOT match this exact project and a guard
keyed on it would be a no-op in the wrong direction.

CORRECTED UNDERSTANDING OF THE READ PATHS (verified by reading the
handlers, not guessing):
The token/market READ endpoints DO NOT branch on token_status /
token_symbol at all. They degrade on absent DATA / absent mint:
- GET /token-metadata (project_tokens.py:84) — `if not mint_address:`
  returns a clean draft/simulated 200 payload. topgun has no
  token_mint_address, so it takes this branch -> 200. token_status /
  token_symbol values are irrelevant to whether it 500s.
- GET /market (market.py compute_market_snapshot) — null-guards
  `(project or {})`, _get_market_row zero-fills, is_simulated_token()
  flags simulated. 200 with zeros.
- GET /candles (market.py:447), /trades (:158), /balance/{wallet}
  (:175) — plain selects returning `data or []` / zero. 200.
So for the PASSIVE READ surface there is nothing to guard: the code
already no-ops correctly for a local_service project, by `mint_address`
presence, NOT by NULL token fields.

REVISED DETECTION RULE (if a guard is ever added to a NEW path):
key on the REAL "no live token" signal, in priority order —
  1. `not token_mint_address` (what the read code already uses), OR
  2. template_type == 'local_service', OR
  3. token_status NOT IN the active/trading set (e.g. != 'trading_live').
NEVER on NULL token_status/token_symbol — those are populated on
local_service projects (TOPGUN / 'inactive').

STATUS CHANGE: this task is DOWNGRADED from "write a guard" to
"monitor-only." No deterministic passive 500 exists in the current
deploy; the read paths already no-op. Do NOT add a guard speculatively.
Re-open ONLY if a real @httpStatus:500 reappears on a token/market
READ path in Railway logs — then capture the path + traceback and
implement the guard using the REVISED DETECTION RULE above.

The only remaining theoretical 500 surface is the WRITE/owner paths
(POST /trade, /create-token, /mint-tokens) — but those are auth/owner-
gated and 400 cleanly on incomplete metadata / unapproved status, so
they are NOT the "visible passive 500s" this hygiene task targets.
