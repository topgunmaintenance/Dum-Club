# Video architecture: passive-viewer playback — DECISION DOC

One-line summary: keep Option A (every viewer subscribes to the
Real-Time stage) until shows sustain roughly 100+ concurrent passive
viewers; at that point Option B (stage Composition -> Low-Latency
channel -> HLS for passives) starts saving money, at the cost of a
metering rework and a playback-URL migration.

Status: decision doc only. Nothing here is built. No branch, no SQL,
no app-code changes. Numbers marked ASSUMED need confirmation against
the AWS pricing page / dashboard before being treated as real.

---

## 1. The two options

**OPTION A — as-built.** Every passive viewer joins the IVS Real-Time
stage as a SUBSCRIBER participant:
- Token mint: POST /api/ivs/viewer-token -> role="SUBSCRIBER"
  (backend/api/routes/ivs.py:654)
- Player: components/IVSStageViewer.tsx — stage.join(), remote WebRTC
  track into <video>.srcObject
- Surfaces: storefront live view (app/project/[id]/page.tsx:4190,
  post-#409) and embed bubble (app/embed/[businessId]/page.tsx:1055)
- Latency: sub-300ms WebRTC for everyone
- Cost: every viewer is a billed Real-Time participant

**OPTION B — split active/passive.** Add server-side Composition on
the Real-Time stage that mixes the stage output and broadcasts it to
an IVS Low-Latency CHANNEL. Passive viewers pull ordinary HLS channel
playback; only the host (and future active bidders / co-hosts) stay
on the Real-Time stage.
- New AWS pieces: one Composition per live show + one Low-Latency
  channel (created at go-live or once per merchant)
- New player: HLS playback (the IVS player web SDK or hls.js-class
  playback) on passive surfaces
- Latency: ~2-5s for passives (typical low-latency HLS), sub-300ms
  retained for stage participants — fine for watching, NOT fine for
  auction bidders (auction flow stays Real-Time)
- Side benefit: the composed output is the natural recording/replay
  source — the "no livestream replay" known gap in
  docs/IVS_ACTIVATION.md:154-157 gets a path for free

## 2. AWS cost shape (1-hour show, host publishing the whole hour)

Rates used — every one of these is an assumption to confirm:
- RT participant: $0.10/participant-hour. Source: the comment at
  backend/services/merchant_limits.py:263-268. LIST-PRICE ASSUMPTION,
  not measured; confirm the real per-participant-minute rate, region,
  and whether host publish minutes bill differently.
- Composition: ASSUMED ~$3.00/hour of composition (encoder-time
  billing). CONFIRM — IVS server-side composition is billed per
  composition-minute and the rate depends on output resolution.
- Low-Latency channel input: ASSUMED $2.00/hr Standard channel
  (multi-rendition). A Basic channel (~$0.20/hr ASSUMED, single
  quality) may be acceptable for phone-camera shows. CONFIRM.
- HLS delivery: ASSUMED ~$0.05/viewer-hour blended. CONFIRM — actual
  output pricing tiers by resolution and monthly volume.

Cost at V concurrent passive viewers, 1-hour show:
- Option A: 0.10 x (V + 1 host)
- Option B (Standard): 0.10 (host RT) + 3.00 (composition)
  + 2.00 (channel input) + 0.05 x V  =  5.10 + 0.05V
- Option B (Basic):    3.30 + 0.05V

| Concurrent passive viewers | Option A | Option B (Standard) | Option B (Basic) |
|---|---|---|---|
| 10    | $1.10   | $5.60  | $3.80  |
| 100   | $10.10  | $10.10 | $8.30  |
| 1,000 | $100.10 | $55.10 | $53.30 |

Break-even (Standard): 5.10 + 0.05V = 0.10V + 0.10
-> V = 5.00 / 0.05 = **100 concurrent passive viewers**.
Break-even (Basic): 3.20 / 0.05 = **64 viewers**.
Sensitivity: if HLS delivery is really $0.03/vh the deltas improve
(~71 / ~46); if it's $0.08/vh they collapse (~250 / ~160). This is
why the rates must be confirmed before acting.

## 3. Viewer-cap enforcement changes under Option B

Today every cap keys off PARTICIPANT TOKEN MINTS:
- Per-viewer mint budget + distinct-viewer cap at mint time:
  backend/api/routes/ivs.py:574-642 (viewer_session_events rows,
  projected distinct count vs limits.max_concurrent_viewers)
- Usage metering: services/stream_telemetry.py — on_viewer_token
  writes the event row (:93-117); on_stream_end estimates
  viewer_seconds = duration x unique_viewers (:192-211) into
  merchant_monthly_usage, which the monthly hard block reads
  (services/merchant_limits.py:285-342).

HLS viewers mint NO participant token — under Option B the entire
enforcement + metering chain goes blind for passives. Replacement
hooks (pick at build time):
1. **Playback-authorization tokens** (IVS private channels): backend
   mints a short-lived playback JWT per viewer — a near drop-in
   replacement for the mint hook; viewer_session_events keeps working
   with a source field. Preferred: keeps fail-closed semantics.
2. **CloudWatch ConcurrentViews / stream-session metrics** polled per
   live channel: true concurrency for enforcement + reconciliation of
   the viewer_seconds estimate (today's duration x unique over-counts;
   channel metrics would meter closer to actual delivery).
3. A viewer heartbeat endpoint (like the host's /api/ivs/heartbeat,
   ivs.py:96) — weakest, client-trusting; backstop only.
Also: the no-double-bill + overage math (services/overage_billing.py)
reads merchant_monthly_usage and does not care which hook fills it —
unchanged either way.

## 4. Migration needs for Option B (DRAFT list only — no SQL here)

On projects (or a new live_sessions table at build time):
- live_playback_url TEXT NULL — the channel's HLS playback URL the
  passive surfaces read (the field that does not exist today; only
  ivs_stage_arn / ivs_stage_id exist, migration 024)
- ivs_channel_arn TEXT NULL — channel identity for cleanup/metrics
- ivs_composition_arn TEXT NULL — active composition for stop/cleanup
- optional: live_passive_mode TEXT ('realtime' | 'channel') so the
  frontend can branch without inferring, and rollout can be per-
  merchant / flag-gated
All additive, NULL-safe: NULL means "behave exactly as today"
(Option A). Normal migration gate applies when this is built.

## 5. Surface swap map under Option B

Swap to HLS channel playback:
- Storefront live view: app/project/[id]/page.tsx:4190-4194 (the
  IVSStageViewer branch; was ~4509 pre-#409)
- Embed bubble: app/embed/[businessId]/page.tsx:1055-1056
- Homepage: nothing to swap today — LiveRail cards are static by
  design (components/discover/LiveRail.tsx:4-8); if a live preview
  thumbnail is ever added, it would be the HLS poster/preview, which
  is only sanely possible under Option B.

Stays on the Real-Time stage (IVSStageViewer / IVSStageHost):
- Host broadcast + self-monitor: components/IVSStageHost.tsx
- Future active participants: auction bidders (sub-second latency is
  the point of the auction loop), invited co-hosts / guest cam.
- A "raise hand / join" upgrade path can promote an HLS viewer to a
  stage participant by minting the existing SUBSCRIBER/PUBLISHER
  token — both paths coexist.

## 6. Scale trigger — this is not urgent

At current scale (13 total prod streams, peak concurrent viewers in
the single digits — stream_sessions telemetry), Option A's cost is
negligible: a 1-hour show with 5 viewers costs ~$0.60. Option B would
cost MORE today (its ~$3-5/hr fixed composition+input floor exceeds
the entire Real-Time bill of every show we have ever run).

**Recommendation:** stay on Option A. Re-open this doc and build
Option B when EITHER:
- shows sustain **~100 concurrent passive viewers** (Standard-channel
  break-even at the assumed rates; ~64 if Basic suffices), i.e. when
  any merchant regularly fills a large fraction of Growth's 600
  viewer ceiling — set the practical trigger at **100 concurrent**;
- OR replay/recording becomes a product priority (composition gives
  it nearly free, shifting the break-even well below 100);
- OR confirmed AWS rates move the math materially (recompute the
  break-even with real numbers first — section 2 sensitivity).

Until then the cheap wins are operational: confirm the real
Real-Time rate in the AWS dashboard, and keep the viewer-cap /
hard-block enforcement (which makes Option A's worst case bounded)
exactly as is.

---

## Update 2026-06-12: homepage previews shipped on Option A

The LIVE NOW rail now embeds muted autoplay previews on the first 2
live cards (PR #413), each joining the Real-Time stage as a
SUBSCRIBER tagged context:"homepage_preview". Cost impact: up to TWO
extra Real-Time participants (~$0.10/viewer-hour list each) per
homepage visitor while a merchant is live. This RAISES the priority
of the Option B decision in proportion to homepage traffic: the
break-even arithmetic in section 6 now includes homepage
impressions, not just intentional watch-view viewers. Re-run the
break-even with real homepage session counts once live shows become
regular; the context tag in viewer-token logs is the measurement
hook.
