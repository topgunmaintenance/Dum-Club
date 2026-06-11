-- Migration 076: guest chat (storefront visitor -> merchant messaging)
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only. Do NOT run this
--     against any database until the file is approved.
--
-- WHY
-- ---
-- Lets an unauthenticated storefront visitor ("guest") start a message
-- thread with the merchant from a project page, and lets the merchant
-- read + reply from a dashboard inbox. Guests are never asked to sign
-- in; they are shown a fixed "Guest Customer" display name (the
-- guest_name / guest_email columns exist for optional capture but the
-- UI label is hardcoded server-side — see docs/guest-chat-spec.md).
--
-- TABLES
-- ------
--   guest_conversations — one row per visitor thread on a project
--   guest_messages      — individual messages, sender in (guest, merchant)
--
-- SECURITY POSTURE (matches migrations 061/062)
-- ---------------------------------------------
-- RLS is ENABLED with a deny_all policy on both tables. All guest-chat
-- access is SERVER-MEDIATED via the service_role key (which BYPASSES
-- RLS). The guest POST path is rate-limited + honeypotted + length-capped
-- at the application layer (see the spec). The scoped merchant policies
-- at the bottom are COMMENTED OUT and only become relevant if these
-- tables are ever exposed directly to anon/authenticated PostgREST.
--
-- DECISION 1 — no merchant_id column.
-- A conversation's owning merchant is derived authoritatively through the
-- project join projects.business_profile_id -> business_profiles, which is
-- exactly what the inbox endpoints use. The earlier denormalized
-- merchant_id column (and its three candidate FK targets) is dropped as
-- unused — there is no second source of truth to keep in sync.
--
-- DECISION 2 — status domain is enforced.
-- status is NOT NULL DEFAULT 'open' with a CHECK constraint covering
-- ('open', 'closed', 'spam'). 'spam' is written by the abuse heuristics in
-- the guest POST endpoint (honeypot / min-time / link-stuffing), so it is
-- part of the allowed domain.
--
-- Forward-only. Idempotent via IF NOT EXISTS so a re-run is a no-op.

-- ── guest_conversations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    guest_name      text,
    guest_email     text,
    status          text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closed', 'spam')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_message_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_guest_conversations_project
    ON public.guest_conversations (project_id);
CREATE INDEX IF NOT EXISTS idx_guest_conversations_last_message
    ON public.guest_conversations (last_message_at DESC);

-- ── guest_messages ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.guest_conversations(id) ON DELETE CASCADE,
    sender          text NOT NULL CHECK (sender IN ('guest', 'merchant')),
    body            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Primary read pattern: all messages in a conversation, oldest first.
CREATE INDEX IF NOT EXISTS idx_guest_messages_conversation
    ON public.guest_messages (conversation_id, created_at);

-- ── RLS: enable + deny-all (mirrors migrations 061/062) ──────────────
ALTER TABLE public.guest_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_messages       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON public.guest_conversations;
CREATE POLICY deny_all ON public.guest_conversations
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.guest_messages;
CREATE POLICY deny_all ON public.guest_messages
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────────────
-- SCOPED MERCHANT POLICIES — COMMENTED OUT, FOR REVIEW. DO NOT ENABLE
-- without the identity note below.
--
-- IDENTITY NOTE: this app authenticates with Privy, not Supabase Auth,
-- and the backend uses the service_role key (BYPASSES RLS). So today the
-- ONLY active policy needed is deny_all above; every read/write goes
-- through the server endpoints in docs/guest-chat-spec.md. These scoped
-- policies are drafted so the "direct PostgREST" path is ready IF you
-- ever mint Supabase-side JWTs. `<privy_did_claim>` MUST be replaced with
-- whatever JWT claim actually carries the Privy DID before enabling.
--
-- OWNERSHIP JOIN (the sole source of truth — there is no merchant_id
-- column; see DECISION 1):
--     guest_conversations.project_id
--       -> projects.business_profile_id     <-- THE JOIN
--       -> business_profiles.owner_privy_id  (Privy DID = identity)
--
-- -- Merchant reads conversations for projects they own:
-- CREATE POLICY merchant_read_conversations ON public.guest_conversations
--   FOR SELECT TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1
--       FROM public.projects p
--       JOIN public.business_profiles bp ON bp.id = p.business_profile_id
--       WHERE p.id = guest_conversations.project_id
--         AND bp.owner_privy_id = (auth.jwt() ->> '<privy_did_claim>')
--     )
--   );
--
-- -- Merchant updates (e.g. close) their own conversations:
-- CREATE POLICY merchant_write_conversations ON public.guest_conversations
--   FOR UPDATE TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1
--       FROM public.projects p
--       JOIN public.business_profiles bp ON bp.id = p.business_profile_id
--       WHERE p.id = guest_conversations.project_id
--         AND bp.owner_privy_id = (auth.jwt() ->> '<privy_did_claim>')
--     )
--   )
--   WITH CHECK (
--     EXISTS (
--       SELECT 1
--       FROM public.projects p
--       JOIN public.business_profiles bp ON bp.id = p.business_profile_id
--       WHERE p.id = guest_conversations.project_id
--         AND bp.owner_privy_id = (auth.jwt() ->> '<privy_did_claim>')
--     )
--   );
--
-- -- Merchant reads messages in their own conversations:
-- CREATE POLICY merchant_read_messages ON public.guest_messages
--   FOR SELECT TO authenticated
--   USING (
--     EXISTS (
--       SELECT 1
--       FROM public.guest_conversations c
--       JOIN public.projects p           ON p.id  = c.project_id
--       JOIN public.business_profiles bp ON bp.id = p.business_profile_id
--       WHERE c.id = guest_messages.conversation_id
--         AND bp.owner_privy_id = (auth.jwt() ->> '<privy_did_claim>')
--     )
--   );
--
-- -- Merchant inserts a reply (sender='merchant') into their own convo:
-- CREATE POLICY merchant_reply_messages ON public.guest_messages
--   FOR INSERT TO authenticated
--   WITH CHECK (
--     sender = 'merchant'
--     AND EXISTS (
--       SELECT 1
--       FROM public.guest_conversations c
--       JOIN public.projects p           ON p.id  = c.project_id
--       JOIN public.business_profiles bp ON bp.id = p.business_profile_id
--       WHERE c.id = guest_messages.conversation_id
--         AND bp.owner_privy_id = (auth.jwt() ->> '<privy_did_claim>')
--     )
--   );
--
-- NOTE: guest INSERTs (sender='guest') are intentionally NOT given an
-- anon policy. Guest writes go ONLY through the rate-limited, honeypotted
-- server endpoint under service_role — never direct PostgREST.
-- ─────────────────────────────────────────────────────────────────────
