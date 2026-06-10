# Guest Chat — Backend + Inbox Spec (DRAFT)

> Status: **DRAFT for review.** Companion to draft migration
> `backend/db/migrations/076_guest_chat.sql`. Nothing here is built or
> applied yet.

Guest chat lets an unauthenticated storefront visitor message a merchant
from a project page, and lets the merchant read and reply from a
dashboard inbox. Visitors never sign in; they appear to the merchant as a
fixed **"Guest Customer"**.

---

## 1. Data model

Two tables (see migration 076 for exact DDL):

- `guest_conversations` — one thread per visitor on a project.
  - `project_id` → `projects(id)` (the storefront the guest is on).
  - `merchant_id` — **linkage unresolved** (nullable uuid, no FK in the
    draft). Ownership is authoritatively derived via the project join
    `project_id → projects.business_profile_id → business_profiles`, not
    via this column. `merchant_id` is a denormalized convenience only.
  - `status` default `open` (`open` / `closed`).
  - `last_message_at` bumped on every new message for inbox sorting.
- `guest_messages` — `sender in ('guest','merchant')`, `body`, timestamps.

All access is **server-mediated via the service_role key**. RLS is
enabled with deny-all; the tables are never hit directly by the browser
through PostgREST.

---

## 2. Public endpoint — `POST /api/guest-chat/message`

Unauthenticated. Creates-or-links a conversation and appends a guest
message in one call.

### Request body

```json
{
  "project_id": "<uuid-or-slug>",
  "conversation_id": "<uuid|null>",
  "body": "the message text",
  "website": ""
}
```

- `project_id` — required. Accept slug OR uuid and resolve to the
  canonical project uuid server-side (reuse the existing
  `resolve_project_uuid` helper — same slug-or-uuid path as the AI-chat
  routes).
- `conversation_id` — optional. When present and valid **for this
  project**, append to it; otherwise start a new conversation.
- `body` — required, trimmed, length-capped (see hardening).
- `website` — **honeypot**. Must be empty. Any non-empty value =
  silently accept-and-drop (return a 200 success shape, write nothing).

### Server flow

1. **Honeypot check.** If `website` is non-empty → return a normal 200
   success body, persist nothing. (Do not reveal it was rejected.)
2. **Rate limit** (reuse `services/live_limits.enforce_rate_limit`,
   the same in-memory limiter PR-3 used; documented per-process caveat):
   - per IP: e.g. `enforce_rate_limit(client_ip, "guest-chat-ip", 10)`
   - per project: e.g.
     `enforce_rate_limit(f"guest-chat-proj:{project_uuid}", "guest-chat-project", 60)`
   Both before any DB write. On exceed → `429`.
3. **Validate + cap.** Trim `body`; reject empty. Enforce a hard length
   cap (suggest **2000 chars**); reject longer with a clean `400`.
4. **Resolve project.** slug-or-uuid → uuid. Unknown → `404`.
5. **Create or link conversation.**
   - If `conversation_id` given AND it belongs to `project_id` → use it.
     If it does not belong to the project → ignore it and start fresh
     (never let a guest write into another project's thread).
   - Else INSERT a new `guest_conversations` row (`status='open'`,
     `merchant_id` resolved from the project's owner if/when OQ1 is
     settled, else left NULL).
6. **Insert message** with `sender='guest'`.
7. **Bump** `guest_conversations.last_message_at = now()`.
8. Return `{ "ok": true, "conversation_id": "<uuid>" }`.

### Display name

The merchant-facing display name is **hardcoded "Guest Customer"** in the
inbox UI. `guest_name` / `guest_email` columns exist for optional future
capture but are NOT surfaced as the label and NOT required.

### Error shape

Clean, human-readable `detail` only — never raw exception text (follow
the PR-8 hygiene pattern; log the full exception server-side).

---

## 3. Merchant inbox — `GET /api/guest-chat/conversations`

Authenticated (Privy bearer, `get_current_user`).

- Returns conversations for projects the caller owns, newest activity
  first (`ORDER BY last_message_at DESC NULLS LAST`).
- **Bounded** — `limit`/`offset` query params, default 50, max 200
  (same pattern as the `/orders` endpoints from PR-7). No unbounded list.
- Ownership is verified with the canonical 3-strategy owner check used by
  `seller_orders` / `update_order_status`, resolved through
  `project_id → projects.business_profile_id → business_profiles`.
- Each row: `id`, `project_id`, display name ("Guest Customer"),
  `status`, `last_message_at`, and an unread/most-recent-snippet if
  cheap to compute.

### `GET /api/guest-chat/conversations/{conversation_id}/messages`

- Authenticated; verify the caller owns the conversation's project
  (same join) before returning anything — **fail-closed** 403 otherwise.
- Bounded `limit`/`offset`, oldest-first
  (`idx_guest_messages_conversation` covers `(conversation_id, created_at)`).

---

## 4. Merchant reply — `POST /api/guest-chat/conversations/{conversation_id}/reply`

Authenticated.

1. Verify ownership of the conversation's project (3-strategy, fail-closed).
2. Trim + length-cap `body` (same 2000-char cap).
3. INSERT `guest_messages` with `sender='merchant'`.
4. Bump `last_message_at`.
5. Optionally allow `status` transition `open`/`closed` via a separate
   small PATCH, owner-checked the same way.

Merchant replies are NOT rate-limited the same way as guest posts (they
are authenticated and owner-scoped), though a light per-user cap is fine.

---

## 5. Abuse / safety summary

| Control | Where | Notes |
|---|---|---|
| Honeypot (`website`) | guest POST | non-empty → accept-and-drop, write nothing |
| Rate limit per IP | guest POST | reuse in-memory limiter (per-process caveat; Redis later) |
| Rate limit per project | guest POST | caps a single storefront being flooded |
| Length cap | guest POST + reply | suggest 2000 chars, clean 400 over |
| Ownership check | all merchant routes | 3-strategy via project → business_profile, fail-closed |
| RLS deny-all | DB | all access server-mediated under service_role |
| No raw errors | all routes | clean `detail`, full exception to server log (PR-8 pattern) |

---

## 6. Open questions (carried from migration 076)

1. **`merchant_id` linkage** — which table is canonical:
   `merchants(id)`, `business_profiles(id)`, or `accounts(id)`? Until
   decided, `merchant_id` stays a nullable uuid with no FK and all
   ownership runs through the project join.
2. **Direct-PostgREST scoped RLS** — only needed if Supabase-side JWTs
   are ever minted for these tables; the commented policies in 076 carry
   a `<privy_did_claim>` placeholder to fill in at that point.
3. **Notifications** — should a new guest message notify the merchant
   (email / in-app)? Out of scope for this draft.
