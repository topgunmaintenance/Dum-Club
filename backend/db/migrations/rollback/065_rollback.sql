-- 065_rollback.sql — drops the live_reminders table.
--
-- Safe to run at any time. The table is leaf — nothing FKs INTO
-- live_reminders. Cascading the drop on projects (via
-- ON DELETE CASCADE) only flows IN, not out.
--
-- After rollback the storefront "Remind me when live" form will get
-- HTTP 5xx from the backend (the table no longer exists). The frontend
-- form should be reverted in lockstep if rollback is permanent.

BEGIN;

DROP TABLE IF EXISTS public.live_reminders;

COMMIT;
