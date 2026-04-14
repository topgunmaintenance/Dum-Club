# Rollback Plan — IVS Real-Time Live System

## Quick Disable (No Code Deploy)

Set these environment variables to disable IVS and revert to Mux/legacy:

### Backend (Railway)
```
ENABLE_IVS_REALTIME_BACKEND=false
```

### Frontend (Vercel)
```
NEXT_PUBLIC_ENABLE_IVS_REALTIME=false
```

Redeploy both services. The system will fall back to the existing Mux/embed live flow.

## How the Feature Flag Works

### Backend
- `backend/services/ivs_realtime.py` checks `os.getenv("ENABLE_IVS_REALTIME_BACKEND", "false")`
- When `false`: IVS endpoints return 503 with "IVS Real-Time not enabled"
- Go-live falls back to existing Mux or manual_embed path

### Frontend
- `frontend/lib/liveProvider.ts` checks `process.env.NEXT_PUBLIC_ENABLE_IVS_REALTIME`
- When `false` or missing: Go Live uses existing Mux/camera flow
- IVS SDK is not loaded, no AWS resources consumed

## Full Revert (Code Level)

If the feature branch is merged to main and needs to be fully reverted:

1. Revert the merge commit: `git revert <merge-commit-sha>`
2. Or: cherry-pick only the commits from main that exclude the IVS branch

### Key commits to identify:
- The merge commit of `feature/ivs-realtime-live-auctions` into `main`
- All IVS-specific files can be identified by path:
  - `backend/services/ivs_realtime.py`
  - `backend/api/routes/ivs.py`
  - `frontend/lib/liveProvider.ts`
  - `frontend/components/IVSStageHost.tsx`
  - `frontend/components/IVSStageViewer.tsx`
  - Any migration files with `ivs` in the name

## What Stays Working During Rollback

| System | Status |
|---|---|
| Mux live (if configured) | Works — untouched |
| Manual embed live | Works — untouched |
| LiveChat | Works — untouched |
| Auctions | Works — untouched |
| Buy Now | Works — untouched |
| Rewards | Works — untouched |
| Discover page | Works — IVS-specific UI hidden by flag |

## AWS Resource Cleanup

If fully rolling back, also:
1. Delete any IVS stages created during testing (via AWS Console → IVS → Stages)
2. Revoke/delete the IAM access key used for IVS
3. Remove `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` from Railway

## Contact Points

- IVS stages are ephemeral — they auto-delete after idle timeout
- No persistent AWS resources are created beyond stages
- No S3 buckets, databases, or VPCs are provisioned
