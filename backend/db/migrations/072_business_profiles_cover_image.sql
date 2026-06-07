-- Migration 072: business_profiles.cover_image_url
--
-- Adds an optional cover image URL to business_profiles so storefronts
-- (and discover surfaces) can render an image-forward hero banner per
-- merchant. Pairs with the already-existing logo_url (migration 014)
-- to give merchants both a small brand mark and a wide hero image.
--
-- Forward-only, idempotent, NULLABLE, no backfill. Existing merchants
-- continue to render exactly as before — the column is absent on every
-- existing row until they (or an operator) supply a value. Follows the
-- §014 / §035 additive-column pattern.
--
-- Run in Supabase SQL Editor (or via Supabase MCP apply_migration).

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
