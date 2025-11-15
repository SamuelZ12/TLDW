-- Ensure topic_generation_mode column exists with correct defaults and constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'topic_generation_mode'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN topic_generation_mode text;
  END IF;
END
$$;

ALTER TABLE public.profiles
  ALTER COLUMN topic_generation_mode SET DEFAULT 'smart';

UPDATE public.profiles
SET topic_generation_mode = 'smart'
WHERE topic_generation_mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_topic_generation_mode_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_topic_generation_mode_check
      CHECK (topic_generation_mode IN ('smart', 'fast'));
  END IF;
END
$$;

ALTER TABLE public.profiles
  ALTER COLUMN topic_generation_mode SET NOT NULL;

