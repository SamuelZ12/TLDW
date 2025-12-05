-- Analytics Dashboard Migration
-- This migration creates materialized views and helper functions for analytics dashboards
-- Author: Analytics Dashboard Setup
-- Date: 2025-12-02

-- ============================================================================
-- MATERIALIZED VIEW 1: User Activity Summary
-- Tracks daily active users and activity patterns
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS user_activity_summary AS
WITH user_daily_activity AS (
  -- Activity from video accesses
  SELECT
    user_id,
    DATE(accessed_at) as activity_date,
    COUNT(*) as video_accesses
  FROM user_videos
  WHERE user_id IS NOT NULL AND accessed_at IS NOT NULL
  GROUP BY user_id, DATE(accessed_at)

  UNION ALL

  -- Activity from video generations
  SELECT
    user_id,
    DATE(created_at) as activity_date,
    COUNT(*) as generations
  FROM video_generations
  WHERE user_id IS NOT NULL
  GROUP BY user_id, DATE(created_at)

  UNION ALL

  -- Activity from notes
  SELECT
    user_id,
    DATE(created_at) as activity_date,
    COUNT(*) as notes_created
  FROM user_notes
  WHERE user_id IS NOT NULL
  GROUP BY user_id, DATE(created_at)

  UNION ALL

  -- Activity from audit logs (broader activity tracking)
  SELECT
    user_id,
    DATE(created_at) as activity_date,
    COUNT(*) as actions
  FROM audit_logs
  WHERE user_id IS NOT NULL
  GROUP BY user_id, DATE(created_at)
)
SELECT
  user_id,
  activity_date,
  SUM(video_accesses) as total_activity_count,
  MAX(activity_date) as last_active_date
FROM user_daily_activity
GROUP BY user_id, activity_date;

-- Create index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_activity_summary_user_date
  ON user_activity_summary(user_id, activity_date);
CREATE INDEX IF NOT EXISTS idx_user_activity_summary_date
  ON user_activity_summary(activity_date);

-- ============================================================================
-- MATERIALIZED VIEW 2: User Growth Metrics
-- Tracks daily signups and tier distribution
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS user_growth_metrics AS
WITH daily_signups AS (
  SELECT
    DATE(created_at) as signup_date,
    COUNT(*) as new_users,
    COUNT(*) FILTER (WHERE subscription_tier = 'free') as new_free_users,
    COUNT(*) FILTER (WHERE subscription_tier = 'pro') as new_pro_users
  FROM profiles
  WHERE created_at IS NOT NULL
  GROUP BY DATE(created_at)
),
cumulative_totals AS (
  SELECT
    signup_date,
    new_users,
    new_free_users,
    new_pro_users,
    SUM(new_users) OVER (ORDER BY signup_date) as total_users,
    SUM(new_free_users) OVER (ORDER BY signup_date) as total_free_users,
    SUM(new_pro_users) OVER (ORDER BY signup_date) as total_pro_users
  FROM daily_signups
)
SELECT
  signup_date as date,
  new_users,
  new_free_users,
  new_pro_users,
  total_users,
  total_free_users,
  total_pro_users,
  CASE
    WHEN total_users > 0 THEN (new_pro_users::numeric / new_users::numeric) * 100
    ELSE 0
  END as daily_conversion_rate
FROM cumulative_totals
ORDER BY signup_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_growth_metrics_date
  ON user_growth_metrics(date);

-- ============================================================================
-- MATERIALIZED VIEW 3: Revenue Metrics
-- Tracks MRR, subscriptions, and top-up purchases
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS revenue_metrics AS
WITH daily_subscriptions AS (
  SELECT
    DATE(COALESCE(subscription_current_period_start, created_at)) as date,
    COUNT(*) FILTER (
      WHERE subscription_status = 'active'
      AND subscription_tier = 'pro'
    ) as active_pro_subscriptions,
    COUNT(*) FILTER (
      WHERE subscription_status = 'canceled'
      AND subscription_tier = 'pro'
    ) as canceled_subscriptions,
    COUNT(*) FILTER (
      WHERE subscription_status = 'past_due'
    ) as past_due_subscriptions
  FROM profiles
  WHERE subscription_current_period_start IS NOT NULL
    OR (subscription_tier = 'pro' AND created_at IS NOT NULL)
  GROUP BY DATE(COALESCE(subscription_current_period_start, created_at))
),
daily_topups AS (
  SELECT
    DATE(created_at) as date,
    COUNT(*) as topup_count,
    SUM(amount_paid) as topup_revenue_cents,
    SUM(credits_purchased) as credits_sold
  FROM topup_purchases
  GROUP BY DATE(created_at)
),
subscription_prices AS (
  -- Assuming Pro subscription is $10/month (update this value as needed)
  SELECT 1000 as pro_price_cents -- $10.00 in cents
)
SELECT
  COALESCE(s.date, t.date) as date,
  COALESCE(s.active_pro_subscriptions, 0) as active_subscriptions,
  COALESCE(s.canceled_subscriptions, 0) as canceled_subscriptions,
  COALESCE(s.past_due_subscriptions, 0) as past_due_subscriptions,
  COALESCE(s.active_pro_subscriptions, 0) * sp.pro_price_cents as mrr_cents,
  COALESCE(t.topup_count, 0) as topup_count,
  COALESCE(t.topup_revenue_cents, 0) as topup_revenue_cents,
  COALESCE(t.credits_sold, 0) as credits_sold,
  (COALESCE(s.active_pro_subscriptions, 0) * sp.pro_price_cents + COALESCE(t.topup_revenue_cents, 0)) as total_revenue_cents
FROM daily_subscriptions s
FULL OUTER JOIN daily_topups t ON s.date = t.date
CROSS JOIN subscription_prices sp
ORDER BY COALESCE(s.date, t.date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_metrics_date
  ON revenue_metrics(date);

-- ============================================================================
-- MATERIALIZED VIEW 4: Video Usage Metrics
-- Tracks video generations, caching, and popular content
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS video_usage_metrics AS
WITH daily_generations AS (
  SELECT
    DATE(created_at) as date,
    COUNT(*) as total_generations,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(*) FILTER (WHERE counted_toward_limit = true) as counted_generations,
    COUNT(*) FILTER (WHERE counted_toward_limit = false) as cached_generations,
    COUNT(*) FILTER (WHERE subscription_tier = 'free') as free_tier_generations,
    COUNT(*) FILTER (WHERE subscription_tier = 'pro') as pro_tier_generations
  FROM video_generations
  GROUP BY DATE(created_at)
),
popular_videos AS (
  SELECT
    vg.youtube_id,
    COUNT(*) as generation_count,
    va.title,
    va.author,
    va.duration
  FROM video_generations vg
  LEFT JOIN video_analyses va ON vg.video_id = va.id
  GROUP BY vg.youtube_id, va.title, va.author, va.duration
  ORDER BY generation_count DESC
  LIMIT 100
)
SELECT
  dg.*,
  (SELECT json_agg(pv.* ORDER BY pv.generation_count DESC)
   FROM popular_videos pv) as popular_videos_json
FROM daily_generations dg
ORDER BY dg.date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_usage_metrics_date
  ON video_usage_metrics(date);

-- ============================================================================
-- MATERIALIZED VIEW 5: Feature Adoption Metrics
-- Tracks feature usage patterns
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS feature_adoption_metrics AS
WITH generation_modes AS (
  SELECT
    DATE(p.created_at) as date,
    COUNT(*) FILTER (WHERE p.topic_generation_mode = 'smart') as smart_mode_users,
    COUNT(*) FILTER (WHERE p.topic_generation_mode = 'fast') as fast_mode_users,
    COUNT(*) as total_users_with_preference
  FROM profiles p
  WHERE p.topic_generation_mode IS NOT NULL
  GROUP BY DATE(p.created_at)
),
note_usage AS (
  SELECT
    DATE(created_at) as date,
    COUNT(*) as notes_created,
    COUNT(DISTINCT user_id) as users_creating_notes,
    COUNT(*) FILTER (WHERE source = 'chat') as chat_notes,
    COUNT(*) FILTER (WHERE source = 'transcript') as transcript_notes,
    COUNT(*) FILTER (WHERE source = 'takeaways') as takeaway_notes,
    COUNT(*) FILTER (WHERE source = 'custom') as custom_notes
  FROM user_notes
  GROUP BY DATE(created_at)
),
favorite_usage AS (
  SELECT
    DATE(uv.created_at) as date,
    COUNT(*) FILTER (WHERE uv.is_favorite = true) as favorites_added,
    COUNT(DISTINCT uv.user_id) as users_favoriting
  FROM user_videos uv
  WHERE uv.is_favorite = true
  GROUP BY DATE(uv.created_at)
),
image_generations AS (
  SELECT
    DATE(created_at) as date,
    COUNT(*) as image_generations,
    COUNT(DISTINCT user_id) as users_generating_images
  FROM image_generations
  GROUP BY DATE(created_at)
)
SELECT
  COALESCE(gm.date, nu.date, fu.date, ig.date) as date,
  COALESCE(gm.smart_mode_users, 0) as smart_mode_users,
  COALESCE(gm.fast_mode_users, 0) as fast_mode_users,
  COALESCE(nu.notes_created, 0) as notes_created,
  COALESCE(nu.users_creating_notes, 0) as users_creating_notes,
  COALESCE(nu.chat_notes, 0) as chat_notes,
  COALESCE(nu.transcript_notes, 0) as transcript_notes,
  COALESCE(nu.takeaway_notes, 0) as takeaway_notes,
  COALESCE(fu.favorites_added, 0) as favorites_added,
  COALESCE(fu.users_favoriting, 0) as users_favoriting,
  COALESCE(ig.image_generations, 0) as image_generations,
  COALESCE(ig.users_generating_images, 0) as users_generating_images
FROM generation_modes gm
FULL OUTER JOIN note_usage nu ON gm.date = nu.date
FULL OUTER JOIN favorite_usage fu ON COALESCE(gm.date, nu.date) = fu.date
FULL OUTER JOIN image_generations ig ON COALESCE(gm.date, nu.date, fu.date) = ig.date
ORDER BY COALESCE(gm.date, nu.date, fu.date, ig.date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_adoption_metrics_date
  ON feature_adoption_metrics(date);

-- ============================================================================
-- HELPER FUNCTION: Refresh All Analytics Views
-- Run this daily via cron or manually after significant data changes
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_activity_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_growth_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY revenue_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY video_usage_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY feature_adoption_metrics;

  RAISE NOTICE 'All analytics materialized views refreshed successfully at %', NOW();
END;
$$;

-- Grant execute permission to authenticated users (you can restrict this further)
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: Calculate User Retention Cohorts
-- Returns retention rates for user cohorts by signup week
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_retention_cohorts(
  cohort_weeks INTEGER DEFAULT 12
)
RETURNS TABLE (
  cohort_week DATE,
  users_in_cohort INTEGER,
  week_0_active INTEGER,
  week_1_active INTEGER,
  week_2_active INTEGER,
  week_3_active INTEGER,
  week_4_active INTEGER,
  week_0_retention NUMERIC,
  week_1_retention NUMERIC,
  week_2_retention NUMERIC,
  week_3_retention NUMERIC,
  week_4_retention NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH cohorts AS (
    SELECT
      p.id as user_id,
      DATE_TRUNC('week', p.created_at)::DATE as cohort_week,
      p.created_at
    FROM profiles p
    WHERE p.created_at >= NOW() - (cohort_weeks || ' weeks')::INTERVAL
  ),
  activity AS (
    SELECT DISTINCT
      user_id,
      DATE_TRUNC('week', activity_date)::DATE as activity_week
    FROM user_activity_summary
  )
  SELECT
    c.cohort_week,
    COUNT(DISTINCT c.user_id)::INTEGER as users_in_cohort,
    COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week THEN c.user_id END)::INTEGER as week_0_active,
    COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '1 week' THEN c.user_id END)::INTEGER as week_1_active,
    COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '2 weeks' THEN c.user_id END)::INTEGER as week_2_active,
    COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '3 weeks' THEN c.user_id END)::INTEGER as week_3_active,
    COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '4 weeks' THEN c.user_id END)::INTEGER as week_4_active,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week THEN c.user_id END) /
          NULLIF(COUNT(DISTINCT c.user_id), 0), 2) as week_0_retention,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '1 week' THEN c.user_id END) /
          NULLIF(COUNT(DISTINCT c.user_id), 0), 2) as week_1_retention,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '2 weeks' THEN c.user_id END) /
          NULLIF(COUNT(DISTINCT c.user_id), 0), 2) as week_2_retention,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '3 weeks' THEN c.user_id END) /
          NULLIF(COUNT(DISTINCT c.user_id), 0), 2) as week_3_retention,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN a.activity_week = c.cohort_week + INTERVAL '4 weeks' THEN c.user_id END) /
          NULLIF(COUNT(DISTINCT c.user_id), 0), 2) as week_4_retention
  FROM cohorts c
  LEFT JOIN activity a ON c.user_id = a.user_id
  GROUP BY c.cohort_week
  ORDER BY c.cohort_week DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_retention_cohorts(INTEGER) TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: Calculate Weekly/Monthly Active Users (WAU/MAU)
-- Returns DAU, WAU, and MAU for a given date range
-- ============================================================================

CREATE OR REPLACE FUNCTION get_active_users_metrics(
  start_date DATE DEFAULT CURRENT_DATE - INTERVAL '90 days',
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  metric_date DATE,
  dau INTEGER,
  wau INTEGER,
  mau INTEGER,
  dau_wau_ratio NUMERIC,
  wau_mau_ratio NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(start_date, end_date, '1 day'::INTERVAL)::DATE as metric_date
  )
  SELECT
    ds.metric_date,
    (SELECT COUNT(DISTINCT user_id)::INTEGER
     FROM user_activity_summary
     WHERE activity_date = ds.metric_date) as dau,
    (SELECT COUNT(DISTINCT user_id)::INTEGER
     FROM user_activity_summary
     WHERE activity_date BETWEEN ds.metric_date - INTERVAL '6 days' AND ds.metric_date) as wau,
    (SELECT COUNT(DISTINCT user_id)::INTEGER
     FROM user_activity_summary
     WHERE activity_date BETWEEN ds.metric_date - INTERVAL '29 days' AND ds.metric_date) as mau,
    ROUND(
      (SELECT COUNT(DISTINCT user_id)::NUMERIC
       FROM user_activity_summary
       WHERE activity_date = ds.metric_date) /
      NULLIF((SELECT COUNT(DISTINCT user_id)::NUMERIC
              FROM user_activity_summary
              WHERE activity_date BETWEEN ds.metric_date - INTERVAL '6 days' AND ds.metric_date), 0),
      3
    ) as dau_wau_ratio,
    ROUND(
      (SELECT COUNT(DISTINCT user_id)::NUMERIC
       FROM user_activity_summary
       WHERE activity_date BETWEEN ds.metric_date - INTERVAL '6 days' AND ds.metric_date) /
      NULLIF((SELECT COUNT(DISTINCT user_id)::NUMERIC
              FROM user_activity_summary
              WHERE activity_date BETWEEN ds.metric_date - INTERVAL '29 days' AND ds.metric_date), 0),
      3
    ) as wau_mau_ratio
  FROM date_series ds
  ORDER BY ds.metric_date;
END;
$$;

GRANT EXECUTE ON FUNCTION get_active_users_metrics(DATE, DATE) TO authenticated;

-- ============================================================================
-- INITIAL DATA POPULATION
-- Refresh all views with existing data
-- ============================================================================

SELECT refresh_analytics_views();

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON MATERIALIZED VIEW user_activity_summary IS
  'Aggregates user activity from multiple sources (video accesses, generations, notes, audit logs) by date';

COMMENT ON MATERIALIZED VIEW user_growth_metrics IS
  'Tracks daily and cumulative user signups with tier distribution';

COMMENT ON MATERIALIZED VIEW revenue_metrics IS
  'Calculates MRR, subscription counts, top-up revenue, and total revenue by date';

COMMENT ON MATERIALIZED VIEW video_usage_metrics IS
  'Tracks video generation patterns, caching efficiency, and popular content';

COMMENT ON MATERIALIZED VIEW feature_adoption_metrics IS
  'Monitors adoption of features like smart/fast mode, notes, favorites, and image generation';

COMMENT ON FUNCTION refresh_analytics_views() IS
  'Refreshes all analytics materialized views. Run daily via cron or manually when needed.';

COMMENT ON FUNCTION get_user_retention_cohorts(INTEGER) IS
  'Calculates weekly cohort retention rates. Parameter: number of weeks to look back.';

COMMENT ON FUNCTION get_active_users_metrics(DATE, DATE) IS
  'Calculates DAU, WAU, MAU and engagement ratios for a date range.';
