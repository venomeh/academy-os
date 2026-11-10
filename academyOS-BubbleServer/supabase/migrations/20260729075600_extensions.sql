-- =============================================================================
-- AcademyOS — Extensions
-- Migration 000: Ensure required extensions exist
-- These are also enabled via Supabase dashboard, but this makes the repo
-- self-contained for `supabase db reset` and new team members.
--
-- NOTE: pg_net may fail if the migration role lacks CREATE EXTENSION privileges.
-- In that case, enable it manually via the Supabase dashboard (Database > Extensions).
-- This is documented as a known manual step.
-- =============================================================================

create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "pg_net" with schema "extensions";
-- pg_cron is managed by Supabase infrastructure and cannot be created via migration.
-- It must be enabled via the Supabase dashboard (Database > Extensions).
