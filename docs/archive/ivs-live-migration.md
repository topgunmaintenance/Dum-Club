# Live IVS Migration — File-Level Impact Analysis

## Current Live Flow (Mux-based)

```
Owner: Go Live → getUserMedia → preview → Mux API create stream →
       WebSocket relay → MediaRecorder chunks → ffmpeg → RTMP → Mux →
       HLS CDN → MuxPlayer (viewer)
Latency: 5-15 seconds
```

## New IVS Real-Time Flow

```
Owner: Go Live → getUserMedia → preview → IVS create stage (backend) →
       IVS SDK publish directly to AWS stage →
       Viewer: IVS SDK subscribe → WebRTC playback
Latency: <300ms
```

## Files Affected

### New Files (IVS-specific)

| File | Purpose |
|---|---|
| `backend/services/ivs_realtime.py` | AWS IVS service: create stage, create tokens, delete stage |
| `backend/api/routes/ivs.py` | API endpoints: POST /create-stage, POST /host-token, POST /viewer-token |
| `frontend/lib/liveProvider.ts` | Feature flag + provider detection helper |
| `frontend/components/IVSStageHost.tsx` | Host camera→IVS publish component |
| `frontend/components/IVSStageViewer.tsx` | Viewer IVS subscribe component |
| `backend/db/migrations/024_ivs_live_fields.sql` | Add IVS-specific columns to projects |

### Modified Files

| File | Change |
|---|---|
| `backend/main.py` | Register IVS router |
| `backend/requirements-prod.txt` | Add `boto3` |
| `frontend/package.json` | Add `amazon-ivs-web-broadcast` |
| `frontend/app/project/[id]/page.tsx` | Branch Go Live on provider, render IVS components |

### Untouched Files (Preserved)

| File | Why Preserved |
|---|---|
| `backend/services/mux_live.py` | Legacy fallback — used when IVS disabled |
| `backend/api/routes/live_relay.py` | Legacy fallback — Mux WebSocket relay |
| `backend/api/routes/auctions.py` | Auction logic unchanged — works with any live provider |
| `frontend/components/LiveChat.tsx` | Chat unchanged — works independently of video provider |
| `frontend/components/RewardToast.tsx` | Rewards unchanged |
| `backend/api/routes/checkout.py` | Checkout unchanged |

## What is Being Replaced vs Preserved

### Replaced (when IVS flag is ON)
- Mux stream creation → IVS stage creation
- MediaRecorder → WebSocket → ffmpeg → RTMP pipeline → IVS SDK direct publish
- MuxPlayer HLS playback → IVS SDK WebRTC subscription
- 5-15s latency → <300ms latency

### Preserved (always)
- LiveChat (Supabase Realtime — independent of video)
- Auction system (works with any `is_live` state)
- Buy Now / checkout flow
- Reward system
- Discover page LIVE badges
- `is_live` flag as the master switch
- Owner auth verification

### Preserved (when IVS flag is OFF)
- Full Mux flow — completely untouched
- Manual embed fallback
- camera://local fallback

## User-Facing Changes

### When IVS is enabled:
- **Host**: Same "Go Live" button → camera preview → "Start Live" → now publishes via IVS (no visible difference to user)
- **Viewer**: Video appears faster (~300ms vs ~10 seconds)
- **Auctions**: Timer and bids are now truly synchronized
- **No new UI concepts** — just faster

### When IVS is disabled:
- **Identical to current production** — no changes visible

## Database Changes

New columns on `projects` table:

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ivs_stage_arn TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS ivs_stage_id TEXT;
```

These are additive — no existing columns modified or removed.

## Technical Migration Notes

1. The `live_provider` field gains a new value: `"ivs_realtime"` (alongside existing `"native_mux"` and `"manual_embed"`)
2. The go-live endpoint checks the feature flag and routes to IVS or Mux accordingly
3. The frontend detects the provider from project data and renders the appropriate component
4. IVS participant tokens are short-lived and generated per-connection — no persistent state
5. Stages are deleted on end-stream — no AWS resource accumulation
