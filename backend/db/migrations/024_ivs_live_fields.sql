-- 024_ivs_live_fields.sql
-- Add IVS Real-Time stage fields to projects

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS ivs_stage_arn TEXT;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS ivs_stage_id TEXT;
