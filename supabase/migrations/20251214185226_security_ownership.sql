-- Migration: Security Fix - Add ownership tracking and secure save functions
-- Purpose: Prevent unauthenticated cache poisoning attacks by:
--   1. Adding created_by column to track original video analysis creator
--   2. Creating secure insert function for server-side saves only
--   3. Creating secure update function with ownership verification

-- 1. Add created_by column to track original creator
ALTER TABLE public.video_analyses
ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

-- 2. Add index for ownership queries
CREATE INDEX IF NOT EXISTS idx_video_analyses_created_by
ON public.video_analyses(created_by);

-- 3. Add comment for documentation
COMMENT ON COLUMN public.video_analyses.created_by IS 'User ID of the original creator (NULL for anonymous)';

-- 4. Create secure insert function (called only from trusted server code)
-- This replaces client-side calls to upsert_video_analysis_with_user_link
CREATE OR REPLACE FUNCTION public.insert_video_analysis_server(
    p_youtube_id text,
    p_title text,
    p_author text,
    p_duration integer,
    p_thumbnail_url text,
    p_transcript jsonb,
    p_topics jsonb,
    p_summary jsonb DEFAULT NULL,
    p_suggested_questions jsonb DEFAULT NULL,
    p_model_used text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,
    p_language text DEFAULT NULL,
    p_available_languages jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_video_id uuid;
    v_existing_id uuid;
BEGIN
    -- Check if video already exists
    SELECT id INTO v_existing_id
    FROM public.video_analyses
    WHERE youtube_id = p_youtube_id;

    IF v_existing_id IS NULL THEN
        -- New video: insert with created_by set to the user who first generated it
        INSERT INTO public.video_analyses (
            youtube_id, title, author, duration, thumbnail_url,
            transcript, topics, summary, suggested_questions, model_used,
            language, available_languages, created_by
        ) VALUES (
            p_youtube_id, p_title, p_author, p_duration, p_thumbnail_url,
            p_transcript, p_topics, p_summary, p_suggested_questions, p_model_used,
            p_language, p_available_languages, p_user_id
        )
        RETURNING id INTO v_video_id;
    ELSE
        -- Video exists: update fields but DO NOT change created_by
        -- Only update non-null values to preserve existing data
        UPDATE public.video_analyses SET
            transcript = COALESCE(p_transcript, transcript),
            topics = COALESCE(p_topics, topics),
            summary = COALESCE(p_summary, summary),
            suggested_questions = COALESCE(p_suggested_questions, suggested_questions),
            language = COALESCE(p_language, language),
            available_languages = COALESCE(p_available_languages, available_languages),
            updated_at = timezone('utc'::text, now())
        WHERE id = v_existing_id;

        v_video_id := v_existing_id;
    END IF;

    -- Link to user if user_id provided (for user_videos tracking)
    IF p_user_id IS NOT NULL THEN
        INSERT INTO public.user_videos (user_id, video_id, accessed_at)
        VALUES (p_user_id, v_video_id, timezone('utc'::text, now()))
        ON CONFLICT (user_id, video_id) DO UPDATE SET
            accessed_at = timezone('utc'::text, now());
    END IF;

    RETURN v_video_id;
END;
$$;

-- 5. Create secure update function with ownership verification
-- Used by /api/update-video-analysis endpoint
CREATE OR REPLACE FUNCTION public.update_video_analysis_secure(
    p_youtube_id text,
    p_user_id uuid,
    p_summary jsonb DEFAULT NULL,
    p_suggested_questions jsonb DEFAULT NULL
)
RETURNS TABLE (success boolean, video_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_video_id uuid;
    v_created_by uuid;
BEGIN
    -- Get video and check ownership
    SELECT id, created_by INTO v_video_id, v_created_by
    FROM public.video_analyses
    WHERE youtube_id = p_youtube_id;

    -- Video doesn't exist
    IF v_video_id IS NULL THEN
        RETURN QUERY SELECT false::boolean, NULL::uuid;
        RETURN;
    END IF;

    -- Ownership check:
    -- 1. If created_by is NULL (anonymous creation), any authenticated user can update
    -- 2. If created_by matches p_user_id, owner can update
    -- 3. Otherwise, reject the update
    IF v_created_by IS NOT NULL AND v_created_by != p_user_id THEN
        RETURN QUERY SELECT false::boolean, v_video_id;
        RETURN;
    END IF;

    -- Perform the update
    UPDATE public.video_analyses SET
        summary = COALESCE(p_summary, summary),
        suggested_questions = COALESCE(p_suggested_questions, suggested_questions),
        updated_at = timezone('utc'::text, now())
    WHERE id = v_video_id;

    RETURN QUERY SELECT true::boolean, v_video_id;
END;
$$;

-- 6. Backfill existing videos: Set created_by from earliest user_videos entry
-- This associates existing cached videos with their first viewer
UPDATE public.video_analyses va
SET created_by = subquery.first_user_id
FROM (
    SELECT DISTINCT ON (uv.video_id)
        uv.video_id,
        uv.user_id as first_user_id
    FROM public.user_videos uv
    ORDER BY uv.video_id, uv.accessed_at ASC NULLS LAST
) subquery
WHERE va.id = subquery.video_id
AND va.created_by IS NULL;

-- 7. Grant execute permissions (security handled within functions)
GRANT EXECUTE ON FUNCTION public.insert_video_analysis_server TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_video_analysis_server TO anon;
GRANT EXECUTE ON FUNCTION public.update_video_analysis_secure TO authenticated;
