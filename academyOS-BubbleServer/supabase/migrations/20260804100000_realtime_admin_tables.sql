-- =============================================================================
-- AcademyOS — Enable Realtime on Admin-Managed Tables
-- Migration 005: Adds profiles, students, guardians, batches, enrollments,
--                batch_teachers, subjects to supabase_realtime publication
--                so the Bubble UI updates live without page refresh.
--
-- SAFE: ALTER PUBLICATION ... ADD TABLE is idempotent-safe on Supabase.
-- If a table is already in the publication, it's a no-op (no error).
-- Existing realtime subscriptions (attendance, ledger_entries, vouchers)
-- are unaffected.
-- =============================================================================

-- Tables already in publication (included here for completeness / idempotency):
-- attendance, ledger_entries, vouchers

-- New tables for live admin UI updates:
ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE students;
ALTER PUBLICATION supabase_realtime ADD TABLE guardians;
ALTER PUBLICATION supabase_realtime ADD TABLE batches;
ALTER PUBLICATION supabase_realtime ADD TABLE enrollments;
ALTER PUBLICATION supabase_realtime ADD TABLE batch_teachers;
ALTER PUBLICATION supabase_realtime ADD TABLE subjects;
