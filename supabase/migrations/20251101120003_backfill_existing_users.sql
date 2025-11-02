-- Migration: Backfill existing users with subscription defaults
-- Created: 2025-11-01
-- Purpose: Migrate existing users to new subscription system
-- IMPORTANT: Review and test this migration in staging before applying to production

-- =====================================================
-- Step 1: Set default subscription tier for existing users
-- =====================================================

-- Set all NULL subscription_tier values to 'free'
UPDATE profiles
SET subscription_tier = 'free'
WHERE subscription_tier IS NULL;

-- Set default subscription_status to 'active' for free users
UPDATE profiles
SET subscription_status = 'active'
WHERE subscription_status IS NULL
  AND subscription_tier = 'free';

-- Initialize subscription_current_period_start for users without a period
-- Use the profile creation date (created_at) or NOW() as the starting point
UPDATE profiles
SET subscription_current_period_start = COALESCE(created_at, NOW())
WHERE subscription_current_period_start IS NULL
  AND subscription_tier = 'free';

-- Set subscription_current_period_end to 30 days from period start
UPDATE profiles
SET subscription_current_period_end = subscription_current_period_start + interval '30 days'
WHERE subscription_current_period_end IS NULL
  AND subscription_current_period_start IS NOT NULL;

-- Ensure cancel_at_period_end is false by default
UPDATE profiles
SET cancel_at_period_end = false
WHERE cancel_at_period_end IS NULL;

-- Ensure topup_credits is 0 for users without credits
UPDATE profiles
SET topup_credits = 0
WHERE topup_credits IS NULL;

-- =====================================================
-- Step 2: Backfill video_generations from video_analyses
-- =====================================================

-- Insert records into video_generations for existing analyzed videos
-- These are marked as NOT counted toward limit (counted_toward_limit = false)
-- This preserves historical data without affecting current quotas
INSERT INTO video_generations (
  user_id,
  identifier,
  youtube_id,
  video_id,
  counted_toward_limit,
  subscription_tier,
  created_at
)
SELECT
  va.user_id,
  'user:' || va.user_id AS identifier,
  va.youtube_id,
  va.id AS video_id,
  false AS counted_toward_limit, -- Historical videos don't count toward current limits
  COALESCE(p.subscription_tier, 'free') AS subscription_tier,
  va.created_at
FROM video_analyses va
LEFT JOIN profiles p ON va.user_id = p.id
WHERE va.user_id IS NOT NULL
  AND NOT EXISTS (
    -- Avoid duplicates if migration is run multiple times
    SELECT 1 FROM video_generations vg
    WHERE vg.video_id = va.id
  )
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- Step 3: Validation queries (run these after migration)
-- =====================================================

-- Query 1: Check that all profiles have subscription_tier set
-- Expected: 0 rows
SELECT id, email FROM profiles WHERE subscription_tier IS NULL;

-- Query 2: Check that all profiles have period dates
-- Expected: 0 rows for free users
SELECT id, email FROM profiles
WHERE subscription_tier = 'free'
  AND (subscription_current_period_start IS NULL
       OR subscription_current_period_end IS NULL);

-- Query 3: Verify video_generations backfill count
-- Expected: Count should match or be close to video_analyses count
SELECT
  (SELECT COUNT(*) FROM video_analyses WHERE user_id IS NOT NULL) AS video_analyses_count,
  (SELECT COUNT(*) FROM video_generations WHERE counted_toward_limit = false) AS historical_generations_count;

-- Query 4: Check for users with negative or null topup_credits
-- Expected: 0 rows
SELECT id, email, topup_credits FROM profiles
WHERE topup_credits IS NULL OR topup_credits < 0;

-- =====================================================
-- Step 4: Post-migration cleanup (optional)
-- =====================================================

-- Add comments to document migration
COMMENT ON COLUMN profiles.subscription_tier IS
  'User subscription tier: free or pro. Migrated existing users to free on 2025-11-01.';

COMMENT ON COLUMN profiles.subscription_current_period_start IS
  'Start of current billing period. For migrated users, set to profile creation date or migration date.';

COMMENT ON TABLE video_generations IS
  'Tracks video generations for usage counting. Historical videos (counted_toward_limit=false) were backfilled from video_analyses.';

-- =====================================================
-- Rollback Instructions
-- =====================================================

-- To rollback this migration:
-- 1. Delete backfilled video_generations records:
--    DELETE FROM video_generations WHERE counted_toward_limit = false;
--
-- 2. Reset profiles columns to NULL (CAUTION: This will lose data):
--    UPDATE profiles SET
--      subscription_tier = NULL,
--      subscription_status = NULL,
--      subscription_current_period_start = NULL,
--      subscription_current_period_end = NULL;
--
-- Note: Only rollback in staging/dev. Do NOT rollback in production after users have started using the new system.
