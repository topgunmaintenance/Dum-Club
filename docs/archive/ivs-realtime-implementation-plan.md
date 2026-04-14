# Plan — IVS Real-Time Live Auctions for DUM Club

## Current State Audit

### Live Streaming (Mux-based)
- **Backend**: `services/mux_live.py` creates RTMP live streams via Mux REST API
- **Relay**: `api/routes/live_relay.py` pipes browser MediaRecorder→ffmpeg→Mux RTMP via WebSocket
- **Frontend**: `startLiveFromCamera()` opens camera, creates Mux stream, connects WebSocket, starts MediaRecorder
- **Playback**: `@mux/mux-player-react` renders HLS playback on viewer side
- **Latency**: 5-15 seconds (Mux HLS)
- **Provider field**: `projects.live_provider` = `"native_mux"` or `"manual_embed"`

### Live Commerce
- **Buy Now**: Stripe checkout with `source: "live"` tagging
- **Auctions**: Full 6-state lifecycle (active→ended→awaiting_payment→paid→voided→closed)
- **Chat**: Supabase Realtime broadcast channels
- **Rewards**: 10-25 DUM Points per purchase (unchanged)

### Database (projects table live columns)
- `is_live` BOOLEAN
- `stream_url` TEXT
- `pinned_offer_id` UUID
- `active_auction_id` UUID
- `live_provider` TEXT (`native_mux`, `manual_embed`)
- `live_stream_id` TEXT
- `live_playback_id` TEXT
- `live_stream_key` TEXT
- `live_ingest_url` TEXT

### Auth
- Privy-based authentication
- `authUser.privyId` sent as `user_id` header on backend requests
- Owner verification via `_resolve_owner_uuid()`

### Deployment
- Backend: Railway (Docker, Python 3.11, ffmpeg installed)
- Frontend: Vercel (Next.js 14)

---

## Problem Statement

Mux HLS delivers 5-15 second latency. For live auctions with countdown timers and competitive bidding, this delay makes the experience feel broken:
- Bidder sees the item 10 seconds after the host shows it
- Timer on viewer's screen is out of sync with host
- "3, 2, 1, SOLD" moments don't land
- Cannot compete with Whatnot's sub-second experience

---

## Why Mux is Insufficient

| Requirement | Mux HLS | Needed |
|---|---|---|
| Host-to-viewer latency | 5-15 seconds | <500ms |
| Synchronized timers | Impossible at 10s delay | Required |
| Competitive bidding | Unfair — viewers see different states | Must be real-time |
| "Going once" moments | Ruined by delay | Must be synchronized |
| Browser-native publishing | Requires ffmpeg relay | Direct from browser |

---

## Why Amazon IVS Real-Time

| Feature | Amazon IVS Real-Time |
|---|---|
| Latency | <300ms (WebRTC-based) |
| Browser publishing | Native — no ffmpeg relay needed |
| Browser viewing | Native — WebRTC subscription |
| SDK | `amazon-ivs-web-broadcast` (host) + `@ivs/web-broadcast` viewer |
| Pricing | Pay-per-use, no minimum |
| Stage model | Host publishes, viewers subscribe via tokens |
| Mobile support | Works in mobile browsers |

---

## Proposed Architecture

```
Owner browser                    Backend (Railway)              AWS IVS
  getUserMedia()                                                
    → IVS SDK publish   ←──── participant token (PUBLISH) ────→ CreateStage
                                                                CreateParticipantToken
  
Viewer browser                                                 
    → IVS SDK subscribe ←──── participant token (SUBSCRIBE) ──→ (same stage)

Auction state:
  Backend WebSocket ←───── bids, timer, events ───→ All connected clients
```

### Key differences from current system:
1. **No ffmpeg relay** — browser publishes directly to IVS via WebRTC
2. **No MediaRecorder** — IVS SDK handles encoding/transport
3. **No HLS playback** — viewers get WebRTC stream directly
4. **<300ms latency** — real-time enough for auctions

---

## Frontend Changes

### New Files
- `frontend/lib/liveProvider.ts` — feature flag + provider detection
- `frontend/components/IVSStageHost.tsx` — host publishing component
- `frontend/components/IVSStageViewer.tsx` — viewer subscription component

### Modified Files
- `frontend/app/project/[id]/page.tsx` — Go Live flow branches on provider
- `frontend/app/discover/page.tsx` — no changes needed (uses `is_live` flag)

### NPM Package
- `amazon-ivs-web-broadcast` — IVS Real-Time SDK

---

## Backend Changes

### New Files
- `backend/services/ivs_realtime.py` — AWS IVS service (create stage, tokens)
- `backend/api/routes/ivs.py` — API endpoints for stage/token management

### Modified Files
- `backend/main.py` — register IVS router
- `backend/api/routes/projects.py` — go-live supports `provider: "ivs_realtime"`

### Python Package
- `boto3` — AWS SDK (likely already available or add to requirements)

---

## Auth/Security Model

- Participant tokens are generated **server-side only**
- Tokens encode: stage ARN, participant role (PUBLISH/SUBSCRIBE), duration
- Host tokens require owner verification (same auth as go-live)
- Viewer tokens are public but scoped to a specific stage
- No AWS credentials exposed to frontend
- Tokens expire after session (default 60 min)

---

## AWS Resources Needed

| Resource | Type | Lifecycle |
|---|---|---|
| IVS Stage | Created per live session | Deleted on end-stream or auto-expires |
| Participant Tokens | Generated per connection | Expire after duration |
| IAM User/Role | One-time setup | Permanent |

No persistent infrastructure — stages are ephemeral.

---

## Environment Variables

See `env.example.additions.md` for full details.

Backend: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `ENABLE_IVS_REALTIME_BACKEND`
Frontend: `NEXT_PUBLIC_ENABLE_IVS_REALTIME`

---

## Feature Flags

| Flag | Default | Effect when OFF |
|---|---|---|
| `ENABLE_IVS_REALTIME_BACKEND` | `false` | IVS endpoints return 503, Mux path used |
| `NEXT_PUBLIC_ENABLE_IVS_REALTIME` | `false` | Frontend uses Mux/camera flow |

---

## Implementation Phases

### Phase 1 — Backend IVS Foundation
- `ivs_realtime.py` service module
- `ivs.py` API routes (create stage, host token, viewer token)
- Register in `main.py`
- Feature flag gating

### Phase 2 — Frontend Host Flow
- Install IVS SDK
- `IVSStageHost.tsx` component
- Wire into Go Live flow with provider detection
- Camera preview → IVS publish → live state

### Phase 3 — Frontend Viewer Flow
- `IVSStageViewer.tsx` component
- Wire into storefront live area
- Replace MuxPlayer when IVS is active

### Phase 4 — Real-Time Auction Foundation
- WebSocket endpoint for auction events
- Server-authoritative timer
- Bid broadcast to all connected clients
- Frontend event handling scaffold

### Phase 5 — Feature Flags & Rollout
- Document flags
- Test flag-off behavior
- Rollback plan verification

---

## Testing Strategy

### Backend
- Verify stage creation returns valid ARN
- Verify token generation returns valid token
- Verify host/viewer token roles are correct
- Verify feature flag disables endpoints

### Frontend
- Host: camera preview → publish → live indicator
- Viewer: subscribe → video renders → low latency
- Disconnect: clean up tracks/stage
- Permission denied: clear error message
- Feature flag off: falls back to Mux flow

### Regression
- Existing Mux flow still works when IVS disabled
- Buy Now unaffected
- Auctions unaffected
- Rewards unaffected
- Chat unaffected

---

## Deployment Sequence

1. Merge branch to main
2. Deploy backend to Railway (no env vars yet → IVS disabled by flag)
3. Verify existing live flow still works
4. Add AWS env vars to Railway
5. Set `ENABLE_IVS_REALTIME_BACKEND=true`
6. Add `NEXT_PUBLIC_ENABLE_IVS_REALTIME=true` to Vercel
7. Redeploy frontend
8. Test IVS flow end-to-end

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| AWS credentials leak | Server-side only, never in frontend bundle |
| IVS SDK bundle size | Dynamic import, only loaded when IVS enabled |
| Stage creation failure | Graceful fallback to Mux/camera flow |
| Mobile browser compatibility | IVS SDK supports Chrome/Safari/Firefox mobile |
| Cost overrun | Stages are ephemeral, deleted on end-stream |
| Mux path breaks during migration | Feature flag ensures independent paths |
