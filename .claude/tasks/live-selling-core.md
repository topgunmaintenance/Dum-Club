# Task batch: live-selling-core (L1–L6)

DUM Club's live-selling core — the surface that makes us competitive
vs Whatnot (8%) and CommentSold. One task = one commit, each verified
with `next build` + `npm run check:human-copy`, pushed to the working
branch. Run in order; L1 unblocks the host panel, L2 broadcasts, L3
lets buyers watch, L4 chat, L5 the sales mechanic, L6 discovery.

## HARD CONSTRAINTS (L2 / L3)

- Use the EXISTING Amazon IVS live-streaming integration already in the
  codebase. Do NOT add any new streaming provider, new SDK, or new
  billing-bearing API keys.
- BEFORE writing any L2/L3 code: report exactly what Amazon/IVS (and
  Mux) integration already exists — env vars, ingest/playback
  endpoints, components, and whether IVS or Mux is the active path. If
  both exist, prefer the already-wired-and-working one (Amazon IVS) and
  say so.

---

## L1 — Fix live-host ↔ featured-offer state desync (bug, P0)

On `/project/[id]` the seller live-host panel is out of sync with the
featured-offer state.

Repro: with NO featured offer, one path shows a blank/crash. After
pinning an offer (correctly shown as FEATURED OFFER on the right, e.g.
"T-shirts · $1"), the LEFT live-host panel still shows "Pick what
you're selling first / Pin a featured item →" and never advances to
the Start camera step. The panel's "is an item pinned?" check reads a
different source of truth than the featured-offer state.

Fix so that:
(a) when a featured offer IS set, the panel advances to Start camera;
(b) when none is set, it shows the pin prompt (never a blank page);
(c) there's no crash.

Also root-cause the related `[seller-orders] fetch failed: TypeError:
Failed to fetch` console error on that page. Find the cause, not a
symptom patch.

**Status: DONE.** Two root causes, two fixes:
1. Desync/crash — the live-host panel (`IVSStageHost`) gated on the raw
   `project.pinned_offer_id` while the FEATURED display renders the
   resolved offer object (`pinnedOffer = offers.find(...)`). They could
   disagree (e.g. a pinned id whose offer isn't loaded/active). Now the
   host receives `pinnedOffer?.id` — the SAME resolved source — so it
   advances to Start camera iff a real featured offer is shown, and
   shows the pin prompt otherwise. Hardened `hasPinnedOffer` to require
   a non-empty string so a non-string id can't throw on `.trim()` and
   blank the panel (all 7 host statuses already render a branch, so no
   blank state remains).
2. seller-orders — `loadSellerOrders` fetched
   `/api/checkout/orders/seller/{id}` using the route param `id`, which
   is a SLUG on slug-routed pages (`/project/topgun-maintenance`). The
   backend looks the project up by UUID, so the slug failed the
   lookup. Now uses the canonical `project.id`, matching every other
   fetch on the page.
Files: `frontend/app/project/[id]/page.tsx`,
`frontend/components/IVSStageHost.tsx`.

## L2 — Start-camera / WebRTC broadcast (host side)

Make the "Start camera" step capture camera+mic and broadcast over the
EXISTING Amazon IVS path. Host goes live reliably, stays live
(heartbeat), with clear error states. No new streaming provider.

**Status: DONE (IVS path, IVSStageHost only).** The capture→preview→
go-live pipeline already existed (getUserMedia + per-error recovery,
create-stage → Stage.join → CONNECTED → heartbeat → end-stage). Added
the two missing reliability pieces: (1) a 20s connect-timeout safety
net so a stuck handshake no longer strands the host on "Connecting…"
forever (tears down + retryable error); (2) unexpected-DISCONNECTED
handling so a dropped stage stops the heartbeat and shows a clear "Tap
Try Again to reconnect" instead of a false "live". Guarded with
endingRef so the host's own End Stream isn't flagged as a drop. No
backend, no new deps. File: `frontend/components/IVSStageHost.tsx`.

## L3 — Buyer live viewer page

When `is_live`, non-owner viewers get the live player (Amazon IVS
playback), live badge, pinned-product buy card, and chat — and can buy
the featured item live. Reuse `buyOffer`. No new streaming provider.

**Status: DONE.** The buyer live view was already built (IVSStageViewer
player, LIVE badge + viewer count wired from LiveChatIVS + sold
counter, Featured-Product buy card via buyOffer gated to !isOwner,
LiveChatIVS chat). Fixed the one real gap: the viewer live-poll
(`refreshLiveStateForViewer`) merged `live_provider` but NOT
`ivs_stage_arn`, and the IVS player only mounts when
`isIVSSession(project) && project.ivs_stage_arn`. So a viewer who
opened the page before the host went live got the provider but a stale
null ARN — the player never rendered and they couldn't watch. Now the
poll merges `ivs_stage_arn`. IVS path, frontend-only.
File: `frontend/app/project/[id]/page.tsx`.

## L4 — Real-time live chat

Ensure live chat messages flow in real time between host and viewers
(presence, ordering, reconnect), building on the existing `LiveChat`
(auth + moderation, #328/#329). Verify what's real-time vs persisted
and complete the gap.

**Status: DONE.** `LiveChatIVS` (the IVS-path chat) is genuinely
real-time — authenticated WebSocket to `/api/auction-ws/events/{id}`
with viewer-count presence, send cooldown, and host ban. Completed two
robustness gaps: (1) reconnect was a FIXED 2s retry that hammered the
relay every 2s through an entire outage — now exponential backoff (2s,
4s, 8s … cap 30s), reset to 0 on a successful open; (2) added message
dedup by id so a reconnect that replays recent history can't
double-post a message or collide React keys. IVS path, frontend-only.
File: `frontend/components/LiveChatIVS.tsx`.

## L5 — Live auction / flash-sale countdown + buy-now

Turn the `active_auction_id` path into a timed event: countdown timer,
current price/high bid, prominent Buy-Now/Bid button, auto-close →
winner/checkout.

**Status: DONE.** The live auction is already fully built — start
(host), 1s countdown display, 3s state poll, current/high bid + bid
count + bidder, bid inputs, highest-bidder state, timer auto-close,
winner Pay-Now, and ended/awaiting/paid states. Fixed the real gap in
the auto-close: the backend has no server-side expiry close, so the
client closes the auction — but the 1s tick re-POSTed `/close` every
second from every viewer tab between expiry and the 3s poll flipping
status to "ended". Now the timer-expiry close fires at most once per
auction per tab (`autoCloseFiredRef`). Frontend-only.
File: `frontend/app/project/[id]/page.tsx`.

## L6 — Discover "Live Now" wiring

On `/discover`, surface currently-live merchants in a real "Live Now"
rail/filter wired to actual `is_live` state.

**Status: RESOLVED-BY-EXISTING (no code change).** The Live Now wiring
is already complete end-to-end and keyed to real `is_live`:
- Backend `/api/projects/discover` (+ `/public` fallback) return
  `is_live` and attach `viewer_count` for live projects, with
  heartbeat-staleness auto-clear so a host that dropped flips offline.
- `useProjects` polls every 20s (+ on tab refocus) so `is_live` stays
  fresh; `liveOnly` filter + `hasAnyLive` are wired to the filter bar.
- `/discover` renders a prominent "Live Now · N" section above the
  business grid whenever any merchant is live (not just when filtered).
- `ListingCard` shows a "Live now · N watching" badge, a live-context
  CTA, and a `?live=1` deep link.
Verified by reading the hook, page, card, and backend listing
endpoints — nothing was stubbed. No change needed.

---

> Do not modify any code outside the named files for this task.
> If more files are needed, stop and ask first.
