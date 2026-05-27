# Social distribution plan

DUM Club's storefront-first model works on day one without an audience. But
a livestream that ALSO simulcasts to TikTok / Instagram / Facebook /
YouTube multiplies reach without the merchant needing a fresh audience
on dum.club. This doc ranks the implementation paths by effort vs
business impact and proposes a phased rollout.

**Last updated:** 2026-05-27.
**Status:** plan + safest paths shipped; rest sequenced for after first 10 paying merchants.

---

## What ships today

| Capability | Where | Status |
|---|---|---|
| Web Share API (native iOS/Android share sheet) on replay | `frontend/components/ReplayCard.tsx` | ✅ shipped (PR #289) |
| Web Share API on storefront URL | `frontend/app/project/[id]/page.tsx` line 4777 | ✅ shipped |
| Web Share API on DUM hub URL | `frontend/app/hub/page.tsx` line 489 | ✅ shipped |
| OG image + Twitter card metadata on storefront | `app/project/[id]/page.tsx` `generateMetadata` | ✅ shipped (PR #289) |

The native share sheet on a phone gives the merchant a one-tap path to
TikTok, Instagram, Facebook, Messages, Mail, etc. without DUM Club
implementing any platform-specific integration. Desktop falls back to
copy-link.

---

## What we will NOT build

These are over-engineering relative to current scale (<100 merchants):

- **Real-time simulcast over RTMP** to TikTok / IG / FB / YouTube from our backend. This requires running an FFmpeg fan-out for every live stream, doubling our IVS egress cost per stream, and managing per-merchant social OAuth tokens. Reconsider at 100+ merchants live regularly.
- **Automatic replay clipping with AI highlight detection**. Requires ML inference per stream + storage + a creator-review queue. Reconsider after Phase 4 doctrine unlock (CLAUDE.md §6).
- **Cross-posted comments from social back into the live chat**. Multi-platform webhook infra + spam moderation. Out of scope.
- **TikTok Shop / Instagram Shop catalog sync**. Real Shopify-class integration; multiple weeks of work per platform.

---

## Phased rollout

### Phase A — operator-driven simulcast (ship today)

**What:** a one-page doc the merchant follows to manually simulcast a
DUM Club live to one or more social platforms using off-the-shelf tools.
Zero engineering on our side. Below in this file.

**Cost:** $0 engineering. Merchants pay $5-20/mo for Larix Broadcaster
(free tier exists) or Restream (free tier 2 destinations).

**Impact:** every active merchant can reach their existing social audience
without DUM Club blocking them.

**Status:** ✅ documented in this file (next section).

---

### Phase B — RTMP forwarding (when IVS Real-Time is on)

**What:** add an "Also stream to RTMP destination" field on the
dashboard. Backend pushes the IVS stream to one merchant-configured
RTMP URL (Restream / IG Live RTMP / FB Live RTMP / YouTube Live RTMP)
in parallel.

**Why this comes second:** the current Mux setup doesn't expose an RTMP
relay endpoint cheaply. AWS IVS Real-Time (currently dormant — see
`docs/IVS_ACTIVATION.md`) does support stage→broadcast bridge to
external RTMP, billed per output minute.

**Cost:** ~$0.10/min per RTMP destination on IVS list price. For a
30-min live to 2 destinations: $6 per stream above current cost. Has
to be a paid feature (Pro tier minimum).

**Effort:** 2-3 PRs. New `merchants.rtmp_destinations` JSON column,
admin UI, IVS API call to attach destinations on stage create.

**Impact:** high. The biggest creator unlock — reach IG/TikTok/FB
audiences while keeping the buy button on DUM Club.

**Status:** 🔒 blocked on IVS Real-Time activation. Track in CLAUDE.md
Phase 4.

---

### Phase C — replay clip generator

**What:** after a stream ends, the merchant gets a one-click "Generate
shareable clip" button on the dashboard. We cut the last N seconds (or
a tagged moment) into a 15s vertical 9:16 MP4 and offer download.

**Why this comes third:** clips need FFmpeg encoding + storage + a
review UI. Lower priority than getting the merchant their first
audience via Phase A + B.

**Cost:** moderate. FFmpeg on Railway is already installed (per
backend/Dockerfile line 8: ffmpeg). New storage path on Supabase
Storage or S3. Clip jobs need a queue (Redis or Supabase queue).

**Effort:** 4-5 PRs. Heavy.

**Impact:** medium. Clips drive social discovery, but only matter once
the merchant is already creating regular content. Premature without
Phase A + B working first.

**Status:** 🔒 not started. Reconsider at Phase 4 doctrine.

---

### Phase D — creator-repost workflow

**What:** when a customer DMs the merchant on Instagram / TikTok about a
product they saw on the live, the merchant can drop a DUM Club link
that recovers context (the pinned offer, the merchant's storefront).

**This is already supported** by the Web Share button on
`/project/<slug>` plus the OG image metadata. The merchant copy/pastes
the storefront link into a DM; the recipient sees the rich preview.

No engineering needed.

**Status:** ✅ shipped via existing storefront OG metadata.

---

## Phase A — manual simulcast guide for merchants

Drop this into a merchant-help doc once `/help` or `/install/simulcast`
exists. For now it's the operator's reference.

### Option 1 — Restream (recommended; free tier covers 2 destinations)

1. Merchant signs up at restream.io (free).
2. Connects their TikTok / IG / FB / YouTube accounts via OAuth.
3. Restream gives them an RTMP URL + Stream Key.
4. On phone: install Larix Broadcaster (iOS / Android, free).
5. In Larix: paste the Restream RTMP URL + Stream Key.
6. On DUM Club dashboard: tap Go Live. Your DUM Club bubble streams via our IVS path.
7. In Larix: tap Start. The same camera feed goes to Restream → all your social platforms simultaneously.

**Caveat:** the phone records to two destinations at once, which uses
more bandwidth + battery. A merchant's phone needs to be on Wi-Fi or
strong LTE.

### Option 2 — single platform native (lower bandwidth)

If the merchant doesn't need multi-platform fan-out, just use the
platform's native app on a SECOND device while running DUM Club on
their primary phone. The second device runs Instagram Live / TikTok
Live / FB Live as normal. Both devices show the same physical scene
(set them next to each other).

**Cost:** $0. Two devices.

### Option 3 — desktop OBS for production-quality

For mechanics / boutiques who want scene transitions, lower-thirds,
title cards:

1. Open Broadcaster Software (obsproject.com, free).
2. Add a camera source + audio source.
3. Settings → Stream → Service: DUM Club (RTMP), Server: (provided by IVS once Phase B ships) OR Restream for now.
4. Click Start Streaming.

**Caveat:** desktop OBS is intimidating for a non-technical merchant.
Park this until Phase B is live and IVS provides a single RTMP push
endpoint.

---

## What to ship next (operator decision)

Three-way priority call when the team has bandwidth for social work:

| Option | Effort | Impact | Notes |
|---|---|---|---|
| **A.** Surface this doc at `/help/simulcast` as a merchant-readable page | 0.5 PR | low (educational only) | safe, fast |
| **B.** Wait for IVS activation, then ship Phase B RTMP forwarding | 3 PRs | high | the real unlock |
| **C.** Ship Phase C clip generator | 5 PRs | medium | premature without A or B |

**Recommendation:** A first (quick win, helps existing merchants today),
then B when IVS is activated (the strategic unlock), C deferred until
clip download is asked for by 3+ active merchants.

---

## Cross-link

- AWS IVS activation gate (Phase B precondition): `docs/IVS_ACTIVATION.md`
- Replay system architecture: `docs/replay-system.md`
- Doctrine on what we're NOT building today: `CLAUDE.md` §1, §6
