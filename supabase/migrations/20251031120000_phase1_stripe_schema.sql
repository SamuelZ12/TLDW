-- Phase 1: Stripe subscription schema changes

-- Add subscription-related columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON public.profiles (stripe_customer_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier SET DEFAULT 'free';

UPDATE public.profiles
SET subscription_tier = 'free'
WHERE subscription_tier IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_subscription_tier_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_subscription_tier_check
      CHECK (subscription_tier IN ('free', 'pro'));
  END IF;
END
$$;

ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier SET NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_subscription_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_subscription_status_check
      CHECK (
        subscription_status IS NULL
        OR subscription_status IN (
          'active',
          'past_due',
          'canceled',
          'incomplete',
          'trialing'
        )
      );
  END IF;
END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_current_period_start timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean;

ALTER TABLE public.profiles
  ALTER COLUMN cancel_at_period_end SET DEFAULT false;

UPDATE public.profiles
SET cancel_at_period_end = false
WHERE cancel_at_period_end IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN cancel_at_period_end SET NOT NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS topup_credits integer;

ALTER TABLE public.profiles
  ALTER COLUMN topup_credits SET DEFAULT 0;

UPDATE public.profiles
SET topup_credits = 0
WHERE topup_credits IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_topup_credits_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_topup_credits_check
      CHECK (topup_credits >= 0);
  END IF;
END
$$;

ALTER TABLE public.profiles
  ALTER COLUMN topup_credits SET NOT NULL;

-- Track individual video generations for usage calculations
CREATE TABLE IF NOT EXISTS public.video_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  identifier text NOT NULL,
  youtube_id text NOT NULL,
  video_id uuid REFERENCES public.video_analyses (id) ON DELETE SET NULL,
  counted_toward_limit boolean NOT NULL DEFAULT true,
  subscription_tier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_generations_user_created_at
  ON public.video_generations (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_video_generations_identifier_created_at
  ON public.video_generations (identifier, created_at);

-- Record Stripe top-up purchases
CREATE TABLE IF NOT EXISTS public.topup_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  stripe_payment_intent_id text NOT NULL UNIQUE,
  credits_purchased integer NOT NULL CHECK (credits_purchased > 0),
  amount_paid integer NOT NULL CHECK (amount_paid >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topup_purchases_user_created_at
  ON public.topup_purchases (user_id, created_at);
