TASK: mux-viewer-cap

Apply the per-tier viewer cap to the Mux (native_mux) watch path.
Today the cap only exists where a viewer must mint an IVS token, so
the actively-running provider has NO per-viewer gate at all.

Problem:
The per-tier max_concurrent viewer cap is enforced exclusively on
the IVS viewer-token mint path. A native_mux stream's playback id is
returned in the public project payload and played directly by the
Mux player; no token, no gate, no count. Mux delivery is billed per
minute streamed per viewer, so viewer count on the Mux path is an
unbounded platform cost. This silently invalidates the per-tier
profitability math: the 3x hard-block ceiling assumes viewer-hours
are bounded by max_concurrent x stream duration.

Evidence:
- Viewer cap enforced ONLY at the IVS token mint:
  backend/api/routes/ivs.py:611-642 (distinct viewer_id projected
  count vs limits.max_concurrent_viewers -> 503 viewer_cap_reached)
- Mux is the actively-running provider today (IVS flag off):
  backend/api/routes/projects.py:2495-2498
- Mux playback id stored on the project row and served publicly:
  backend/api/routes/projects.py:2475-2481 (live_playback_id set at
  go-live), frontend/lib/discover/types.ts:37 (in public payload)
- Mux billed per minute streamed (cost acknowledgement, no gate):
  backend/api/routes/live_relay.py:11-16
- In-memory 50-viewer global backstop exists but only fires where
  add_viewer() is called, which the Mux watch path never does:
  backend/services/live_limits.py:192-197

Proposed approach:
1. Introduce a watch-session check for the Mux path. The cleanest
   shape mirrors the IVS gate: a lightweight viewer registration
   endpoint the player calls before mounting (and on a keepalive
   cadence), which derives a stable viewer_id via the existing
   services/viewer_identity.py helper, writes viewer_session_events,
   and refuses with the same viewer_cap_reached / monthly_hard_block
   codes the IVS path uses.
2. Frontend: the Mux player component mounts only after the
   registration call succeeds; on 503 it renders the existing
   cap-reached message. Graceful degradation: if the endpoint is
   unreachable, fall back to current behavior (fail open) so a
   backend hiccup never blanks a working stream - log loudly.
3. Reuse resolve_merchant_limits_by_privy_did and
   check_monthly_hard_block verbatim; no new resolution logic.
4. Signed playback (Mux signed URLs) is the airtight long-term
   answer; note it as a follow-up, do not attempt it in this task.

Cost risk this closes:
Without it, one viral Mux stream can deliver unlimited viewer-
minutes against a $39 subscription. With it, the worst case returns
to the bounded per-tier table (included_vh x hard_block_multiplier).

Risks:
- A pre-mount gate adds one round trip before video start; keep it
  fast (single resolver + single count query, same as IVS path).
- Fail-open fallback means the gate is best-effort, not airtight,
  until signed playback ships. Document that explicitly in the PR.
- Do not break manual_embed: third-party embeds cost us nothing and
  must stay ungated.

No migration expected (viewer_session_events and stream_sessions
already exist). If a schema change turns out to be needed, STOP and
queue it under the normal migration gate first. No prod config
changes without explicit go.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
