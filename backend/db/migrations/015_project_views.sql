-- Migration: Add view_count to projects for lightweight analytics
-- Run this in Supabase SQL Editor

ALTER TABLE projects ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0 NOT NULL;

-- Notes:
-- view_count: incremented each time the project page is loaded (public views)
-- Lightweight counter — no separate analytics table needed for v1
