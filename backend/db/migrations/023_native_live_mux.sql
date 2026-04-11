-- 023_native_live_mux.sql
-- Add native live streaming provider fields to projects

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS live_provider TEXT;
-- valid: 'native_mux', 'manual_embed', NULL

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS live_stream_id TEXT;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS live_playback_id TEXT;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS live_stream_key TEXT;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS live_ingest_url TEXT;
