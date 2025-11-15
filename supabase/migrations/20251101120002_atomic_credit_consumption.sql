-- Migration: Atomic credit consumption to prevent race conditions
-- Created: 2025-11-01
-- Purpose: Wrap credit checking and consumption in atomic database transaction

-- =====================================================
-- Function: consume_video_credit_atomically
-- Purpose: Atomically check limits and consume credits in single transaction
-- Returns: JSON with { allowed, reason, generation_id, used_topup }
-- =====================================================
CREATE OR REPLACE FUNCTION consume_video_credit_atomically(
  p_user_id uuid,
  p_youtube_id text,
  p_identifier text,
  p_subscription_tier text,
  p_base_limit integer,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_video_id uuid DEFAULT NULL,
  p_counted boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_counted_usage integer;
  v_topup_credits integer;
  v_base_remaining integer;
  v_total_remaining integer;
  v_generation_id uuid;
  v_used_topup boolean := false;
BEGIN
  -- Lock the user's profile row for update to prevent concurrent modifications
  SELECT topup_credits
  INTO v_topup_credits
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'NO_SUBSCRIPTION',
      'error', 'Profile not found'
    );
  END IF;

  -- Count usage in the current period (excluding cached videos)
  SELECT COUNT(*)
  INTO v_counted_usage
  FROM video_generations
  WHERE user_id = p_user_id
    AND created_at >= p_period_start
    AND created_at <= p_period_end
    AND counted_toward_limit = true;

  -- Calculate remaining credits
  v_base_remaining := GREATEST(0, p_base_limit - v_counted_usage);
  v_total_remaining := v_base_remaining + v_topup_credits;

  -- Check if user has reached limit
  IF p_counted AND v_total_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'LIMIT_REACHED',
      'base_remaining', v_base_remaining,
      'topup_remaining', v_topup_credits,
      'total_remaining', v_total_remaining
    );
  END IF;

  -- Insert video generation record
  INSERT INTO video_generations (
    user_id,
    identifier,
    youtube_id,
    video_id,
    counted_toward_limit,
    subscription_tier
  ) VALUES (
    p_user_id,
    p_identifier,
    p_youtube_id,
    p_video_id,
    p_counted,
    p_subscription_tier
  )
  RETURNING id INTO v_generation_id;

  -- If this generation counts toward limit, consume credit
  IF p_counted THEN
    -- If base credits exhausted, consume top-up credit
    IF v_base_remaining <= 0 AND v_topup_credits > 0 THEN
      UPDATE profiles
      SET topup_credits = topup_credits - 1
      WHERE id = p_user_id
        AND topup_credits > 0;

      IF FOUND THEN
        v_used_topup := true;
        v_topup_credits := v_topup_credits - 1;
      END IF;
    END IF;
  END IF;

  -- Return success with updated values
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'OK',
    'generation_id', v_generation_id,
    'used_topup', v_used_topup,
    'base_remaining', GREATEST(0, v_base_remaining - (CASE WHEN p_counted AND NOT v_used_topup THEN 1 ELSE 0 END)),
    'topup_remaining', v_topup_credits,
    'total_remaining', v_total_remaining - (CASE WHEN p_counted THEN 1 ELSE 0 END)
  );
END;
$$;

COMMENT ON FUNCTION consume_video_credit_atomically IS
  'Atomically checks credit availability and consumes credit in single transaction. ' ||
  'Prevents race conditions by locking profile row during check-and-consume operation.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION consume_video_credit_atomically TO authenticated;
GRANT EXECUTE ON FUNCTION consume_video_credit_atomically TO service_role;

-- =====================================================
-- Function: check_video_generation_allowed
-- Purpose: Read-only check without consuming credits (for pre-flight checks)
-- =====================================================
CREATE OR REPLACE FUNCTION check_video_generation_allowed(
  p_user_id uuid,
  p_base_limit integer,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_counted_usage integer;
  v_topup_credits integer;
  v_base_remaining integer;
  v_total_remaining integer;
  v_will_consume_topup boolean;
BEGIN
  -- Get current top-up credits
  SELECT topup_credits
  INTO v_topup_credits
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'NO_SUBSCRIPTION'
    );
  END IF;

  -- Count usage in the current period
  SELECT COUNT(*)
  INTO v_counted_usage
  FROM video_generations
  WHERE user_id = p_user_id
    AND created_at >= p_period_start
    AND created_at <= p_period_end
    AND counted_toward_limit = true;

  -- Calculate remaining credits
  v_base_remaining := GREATEST(0, p_base_limit - v_counted_usage);
  v_total_remaining := v_base_remaining + v_topup_credits;
  v_will_consume_topup := (v_base_remaining <= 0 AND v_topup_credits > 0);

  RETURN jsonb_build_object(
    'allowed', v_total_remaining > 0,
    'reason', CASE WHEN v_total_remaining > 0 THEN 'OK' ELSE 'LIMIT_REACHED' END,
    'base_remaining', v_base_remaining,
    'topup_remaining', v_topup_credits,
    'total_remaining', v_total_remaining,
    'will_consume_topup', v_will_consume_topup
  );
END;
$$;

COMMENT ON FUNCTION check_video_generation_allowed IS
  'Read-only check of credit availability without consuming credits. ' ||
  'Use for pre-flight checks and UI display.';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_video_generation_allowed TO authenticated;
GRANT EXECUTE ON FUNCTION check_video_generation_allowed TO service_role;
