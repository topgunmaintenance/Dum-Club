# Implementation Log — IVS Real-Time Live Auctions

## Entry 1 — Branch Created
- Branch: `feature/ivs-realtime-live-auctions`
- Created from: latest `main` at commit `7429f6c`
- Audit agent launched to inspect full live streaming codebase

## Entry 2 — Prior Knowledge (from this session)
From building the current live system across this session, I know:
- **Mux integration**: `backend/services/mux_live.py` creates RTMP live streams
- **WebSocket relay**: `backend/api/routes/live_relay.py` pipes MediaRecorder→ffmpeg→Mux RTMP
- **Frontend**: `startLiveFromCamera()` in project page creates Mux stream, opens WS, starts MediaRecorder
- **Latency**: Mux HLS delivers ~5-15 second latency — too slow for live auctions
- **Auction system**: exists in `backend/api/routes/auctions.py` with 6-state lifecycle
- **LiveChat**: uses Supabase Realtime broadcast channels
- **Auth**: Privy-based, `authUser.privyId` passed via headers
- **Database**: projects table has `is_live`, `stream_url`, `live_provider`, `live_playback_id`, `live_stream_key`, `live_ingest_url`, `active_auction_id`
- **Deploy**: Railway (backend Docker), Vercel (frontend Next.js)

Waiting for audit agent to confirm details before writing plan docs.
