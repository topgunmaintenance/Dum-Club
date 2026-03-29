-- Add media fields to offers table
-- Run in Supabase SQL Editor

ALTER TABLE offers ADD COLUMN IF NOT EXISTS primary_image_url TEXT DEFAULT NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT NULL;
