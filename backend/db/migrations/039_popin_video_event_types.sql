-- 039_popin_video_event_types.sql
-- DUM Pop-In Seller Mode B (Recorded Video) — extend
-- merchant_analytics_events.event_type CHECK constraint to add the
-- 3 new video-specific events fired by the in-bubble <video> player.
--
-- popin_video_view  — fires once when the bubble shows with a video
--                     (parallel to popin_view; both fire so the
--                     funnel can compare video-vs-static impressions)
-- popin_video_play  — fires on the first user interaction that
--                     unmutes / explicitly starts the clip
-- popin_video_click — generic click on the video tile (e.g. tap to
--                     unmute, future tap-to-expand) — analogous to
--                     popin_click for the avatar / chip targets

ALTER TABLE merchant_analytics_events
  DROP CONSTRAINT IF EXISTS merchant_analytics_events_event_type_check;

ALTER TABLE merchant_analytics_events
  ADD CONSTRAINT merchant_analytics_events_event_type_check
  CHECK (event_type IN (
    'embed_view',
    'project_view',
    'offer_view',
    'checkout_start',
    'purchase_completed',
    'live_view',
    'return_visit',
    'popin_view',
    'popin_click',
    'popin_dismiss',
    'popin_offer_click',
    'popin_video_view',
    'popin_video_play',
    'popin_video_click'
  ));
