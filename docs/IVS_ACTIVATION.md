# IVS Real-Time activation runbook

What's required to safely flip `NEXT_PUBLIC_ENABLE_IVS_REALTIME=true` in
production, and how to roll back if something goes wrong.

The code path is fully built (`services/ivs_realtime.py`,
`api/routes/ivs.py`, `IVSStageHost.tsx`, `IVSStageViewer.tsx`,
migration `024`). This document is what stands between "code is there"
and "real merchants can use it without us paying for orphaned AWS
stages."

## 1. AWS prep

### IAM policy

Create an IAM user (or role) for the backend. Attach this policy to it
and create an access key for the user — that's what the backend will
authenticate with.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "ivs:CreateStage",
      "ivs:DeleteStage",
      "ivs:CreateParticipantToken",
      "ivs:DisconnectParticipant",
      "ivs:GetStage",
      "ivs:ListStages"
    ],
    "Resource": "*"
  }]
}
```

`GetStage` + `ListStages` are read-only and not strictly needed by the
current code path; include them for debugging headroom.

### Region

Pick a region that supports IVS Real-Time (`us-east-1` is the safe
default the code already targets). Confirm region availability in the
AWS console for the IVS Real-Time service before committing.

### Local permission probe (before any deploy)

From a terminal with the production AWS credentials:

```bash
aws ivs-realtime create-stage --name dum-club-probe --region us-east-1
# expect: 200 with a stage ARN
aws ivs-realtime delete-stage --arn <arn-from-above> --region us-east-1
# expect: 200
```

If either fails, fix IAM before continuing.

## 2. Env vars

Set these on the **backend** (Railway). Setting them with the frontend
flag still `false` is a no-op — none of the existing user flows call
`/api/ivs/*`, so the backend can be "ready" without any user impact.

```
AWS_ACCESS_KEY_ID            = <from the IAM user above>
AWS_SECRET_ACCESS_KEY        = <from the IAM user above>
AWS_REGION                   = us-east-1
ENABLE_IVS_REALTIME_BACKEND  = true
```

Optional (already defaults to 60):

```
HEARTBEAT_STALE_AFTER_SECONDS = 60
```

When you're ready to expose the path to merchants, set on **Vercel**:

```
NEXT_PUBLIC_ENABLE_IVS_REALTIME = true
```

## 3. Smoke tests (do NOT flip the frontend flag in prod until these pass on a preview)

Run on a Vercel preview branch with the env above plus the frontend flag.

1. **Backend boot** — Railway deploys cleanly with the new envs. The
   smoke-import guard from PR #226 catches any import-time issue here.
2. **Merchant Go Live** — auth as the founding merchant; click Go Live
   on `/project/<slug>`. Camera permission fires once. `/create-stage`
   returns 200 within ~5s. The preview shows the camera. DB row:
   `is_live=true`, `live_provider='ivs_realtime'`, `ivs_stage_arn=arn:…`.
3. **Anonymous viewer** — open `/project/<slug>` in incognito.
   `IVSStageViewer` mounts, `/viewer-token` returns 200, video plays
   within ~3–5s.
4. **Authenticated viewer** — repeat as a different logged-in user.
5. **Viewer count** — multiple viewers; host's viewer count ticks up
   via the chat WebSocket.
6. **Chat during live** — viewer sends a message; host sees it.
7. **End live (clean path)** — host clicks End; AWS stage is deleted
   (verify in the AWS console); DB cleared; viewer client shows the
   ended state.
8. **Stale-heartbeat scenario** — host force-closes the tab without
   ending. Wait 70+s. Hit `/discover`; the project should flip to
   `is_live=false`. **Verify the AWS stage is also deleted in the AWS
   console.** This is the path the orphan-stage hotfix in
   `_delete_orphan_ivs_stage` is meant to cover; this test is the
   regression guard.
9. **Reconnect after end** — host clicks Go Live again. New stage is
   created cleanly.
10. **Mobile** — iOS Safari (15.6+) host AND viewer; Android Chrome
    host AND viewer.
11. **Checkout during live** — buy a pinned offer while the stream is
    running. Stripe path is provider-agnostic; must still work.
12. **Stripe-not-verified gate** — `/create-stage` as a merchant whose
    Stripe Connect isn't verified must return 402 with the
    `merchant_stripe_not_verified` shape.

## 4. Rollback

### Instant (frontend only)

Set on Vercel:

```
NEXT_PUBLIC_ENABLE_IVS_REALTIME = false
```

Frontend reverts to the Mux UI on the next page load. In-flight IVS
sessions stay alive on the AWS side until the host ends them or the
stale-clear path fires (the hotfix in this PR ensures that path
deletes the AWS stage, not just the DB flag).

### Backend kill-switch

If something on the backend is misbehaving:

```
ENABLE_IVS_REALTIME_BACKEND = false
```

`/api/ivs/*` returns 503. DB state stays consistent.

### Why there's no DB rollback

Migration `024` only adds nullable columns. There's nothing destructive
to undo. Existing `live_provider='ivs_realtime'` rows resolve naturally
as the stale-clear path runs.

## 5. Known gaps (acceptable for MVP)

- **No livestream replay/recording.** IVS Real-Time supports
  `AutoParticipantRecordingConfiguration` writing to S3, but the code
  doesn't configure it. Sessions end → video is gone. Decide explicitly
  whether to ship without replay or add composition before going broad.
- **No reconciliation job.** If AWS and DB state diverge in a way the
  stale-clear path doesn't catch, there's no scheduled cleanup. Worth
  adding once IVS is live and there's signal that orphans accumulate.
- **`live_limits.py` daily-stream limits and viewer counts live in
  process memory.** Single-replica Railway = fine. If you scale to
  multiple replicas, the counters become per-replica.

## 6. After IVS is proven in prod

Once IVS has been running cleanly with real merchants for a few weeks,
the Mux removal cleanup from the earlier Mux audit becomes safe to
ship. It deletes `backend/services/mux_live.py`,
`backend/api/routes/live_relay.py`, the `native_mux` branch in
`/go-live`, `@mux/mux-player-react`, and the related state/UI on the
project page. Until then, Mux stays — it's still the only active live
provider with the frontend flag off.
