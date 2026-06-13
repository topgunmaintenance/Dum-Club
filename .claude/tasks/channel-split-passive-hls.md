TASK: channel-split-passive-hls

Gate 2 — video cost. Route PASSIVE viewers (feed previews + storefront
watchers) to IVS Low-Latency HLS playback; reserve the Real-Time stage
for the host and ACTIVE participants (auction bidders, future co-hosts).

This is the implementation task for "Option B" in the decision doc
.claude/tasks/video-architecture-passive-playback.md (read it first —
this file is the build plan, that file is the cost model + trigger).

VIDEO COST — MODELED vs VALIDATED (audit, 2026-06-13):
- Modeled: $0.10/viewer-hour IVS Real-Time participant, a LIST-PRICE
  assumption living only in a code comment (merchant_limits.py ~263).
  The Option B arithmetic (composition + channel + HLS egress) in the
  decision doc is built on further ASSUMED rates, all flagged CONFIRM.
- Validated: NOTHING. There is no real invoice data in the repo or the
  model. Mux was removed in #409 (no Mux billing data remains, and Mux
  is not the path). No AWS IVS invoice has been reconciled against the
  stream_sessions telemetry. So the entire cost case is unvalidated
  assumption — pull one real AWS IVS bill before trusting break-evens.

ARCHITECTURE (proposal — confirm rates before building):
Today every viewer is a Real-Time SUBSCRIBER participant (billed per
participant-minute). Option B adds, per live show:
1. An IVS Low-Latency CHANNEL + a server-side Composition that mixes
   the Real-Time stage and broadcasts to the channel.
2. Passive surfaces play the channel's HLS playback URL (IVS player web
   SDK / hls.js-class), NOT a stage subscription:
   - Feed preview tiles (components/discover/LiveRail.tsx, first 2)
   - Storefront watch view (the IVSStageViewer branch in
     app/project/[id]/page.tsx live module)
   - Embed bubble (app/embed/[businessId]/page.tsx)
3. Real-Time stage stays for: the host (IVSStageHost) and ACTIVE
   participants only — auction bidders (sub-second latency is the point)
   and any future invited co-host/guest-cam. A "raise hand / join"
   path promotes an HLS viewer to a stage participant by minting the
   existing SUBSCRIBER/PUBLISHER token.

DB (additive, NULL-safe — own migration, normal gate):
- projects.live_playback_url TEXT NULL (channel HLS URL)
- projects.ivs_channel_arn TEXT NULL
- projects.ivs_composition_arn TEXT NULL
- optional projects.live_passive_mode TEXT ('realtime'|'channel') for
  per-merchant/flagged rollout. NULL = behave exactly as today (every
  viewer on Real-Time), so the rollout is reversible per project.

ENFORCEMENT/METERING IMPACT (must be solved in the same task):
HLS viewers mint NO participant token, so the current viewer-cap +
viewer_seconds metering (which keys off viewer-token mints,
ivs.py + stream_telemetry.py) goes blind for passives. Replace with
playback-authorization tokens (IVS private channel) so
viewer_session_events keeps a per-viewer hook with a source field, OR
CloudWatch ConcurrentViews polling. Pick at build time; keep fail-
closed semantics. Cross-reference the decision doc section 3.

Side benefit: the composed channel output is the natural recording/
replay source (closes the "no replay" gap, docs/IVS_ACTIVATION.md).

HUMAN-REVIEW POINT / GATE: do NOT build until (1) a real AWS IVS
invoice is reconciled and the break-even in the decision doc is
recomputed with confirmed rates, AND (2) traffic actually approaches
the trigger (~100 concurrent passive viewers, or replay becomes a
priority). At today's single-digit concurrency Option B costs MORE
than Option A — see decision doc section 6. This file exists so the
build is ready to trigger when the trigger fires; it is read-only
architecture until then.

Do not implement now. No migration, no IVS infra, no code. File only.
