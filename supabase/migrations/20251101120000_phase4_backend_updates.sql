-- Phase 4+: Backend primitives for Stripe subscriptions

-- Track processed Stripe webhook events for idempotency
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure quick lookups by creation time
CREATE INDEX IF NOT EXISTS idx_stripe_events_created_at
  ON public.stripe_events (created_at DESC);

-- Increment top-up credits via RPC
CREATE OR REPLACE FUNCTION public.increment_topup_credits(
  p_user_id uuid,
  p_amount integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE NOTICE 'increment_topup_credits called with non-positive amount: %', p_amount;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET topup_credits = GREATEST(topup_credits + p_amount, 0)
  WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_topup_credits(uuid, integer)
  TO authenticated, service_role;

-- Decrement a single top-up credit if available
CREATE OR REPLACE FUNCTION public.consume_topup_credit(
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated integer;
BEGIN
  UPDATE public.profiles
  SET topup_credits = topup_credits - 1
  WHERE id = p_user_id
    AND topup_credits > 0;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_topup_credit(uuid)
  TO authenticated, service_role;

-- Aggregate usage in a window for faster API queries
CREATE OR REPLACE FUNCTION public.get_usage_breakdown(
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  subscription_tier text,
  counted integer,
  cached integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    subscription_tier,
    COUNT(*) FILTER (WHERE counted_toward_limit) AS counted,
    COUNT(*) FILTER (WHERE NOT counted_toward_limit) AS cached
  FROM public.video_generations
  WHERE user_id = p_user_id
    AND created_at >= p_start
    AND created_at < p_end
  GROUP BY subscription_tier;
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_breakdown(uuid, timestamptz, timestamptz)
  TO authenticated, service_role;

-- Harden RLS on usage tables
ALTER TABLE public.video_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topup_purchases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_generations'
      AND policyname = 'video_generations_select_own'
  ) THEN
    CREATE POLICY video_generations_select_own
      ON public.video_generations
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_generations'
      AND policyname = 'video_generations_insert_own'
  ) THEN
    CREATE POLICY video_generations_insert_own
      ON public.video_generations
      FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_generations'
      AND policyname = 'video_generations_update_own'
  ) THEN
    CREATE POLICY video_generations_update_own
      ON public.video_generations
      FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'topup_purchases'
      AND policyname = 'topup_purchases_select_own'
  ) THEN
    CREATE POLICY topup_purchases_select_own
      ON public.topup_purchases
      FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END
$$;
