# Environment Variable Additions — IVS Real-Time

## Backend (Railway)

| Variable | Where Used | Example Value | Secret? | Required? |
|---|---|---|---|---|
| `AWS_ACCESS_KEY_ID` | `backend/services/ivs_realtime.py` | `AKIAIOSFODNN7EXAMPLE` | Yes | Yes |
| `AWS_SECRET_ACCESS_KEY` | `backend/services/ivs_realtime.py` | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | Yes | Yes |
| `AWS_REGION` | `backend/services/ivs_realtime.py` | `us-east-1` | No | Yes |
| `ENABLE_IVS_REALTIME_BACKEND` | `backend/services/ivs_realtime.py` | `true` | No | No (defaults to `false`) |

## Frontend (Vercel)

| Variable | Where Used | Example Value | Secret? | Required? |
|---|---|---|---|---|
| `NEXT_PUBLIC_ENABLE_IVS_REALTIME` | `frontend/lib/liveProvider.ts` | `true` | No | No (defaults to `false`) |

## Existing Variables (Unchanged)

| Variable | Status |
|---|---|
| `MUX_TOKEN_ID` | Kept as legacy/fallback — used when IVS is disabled |
| `MUX_TOKEN_SECRET` | Kept as legacy/fallback |
| `NEXT_PUBLIC_API_URL` | Unchanged — used by `lib/apiBase.ts` |
| `NEXT_PUBLIC_SUPABASE_URL` | Unchanged — used for LiveChat |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Unchanged — used for LiveChat |

## AWS IAM Policy (Least Privilege)

The IAM user/role needs only these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ivs:CreateStage",
        "ivs:DeleteStage",
        "ivs:GetStage",
        "ivs:ListStages",
        "ivs:CreateParticipantToken",
        "ivs:DisconnectParticipant",
        "ivs:ListParticipants"
      ],
      "Resource": "*"
    }
  ]
}
```

## Notes

- AWS credentials must NEVER be exposed to the frontend
- Participant tokens are generated server-side and passed to the frontend
- Tokens are short-lived (default: 60 minutes) and scoped to specific stages
- The `ENABLE_IVS_REALTIME_BACKEND` flag allows the new path to be disabled without removing code
