-- ============================================================================
-- Add Email Preferences for Broadcast Emails
-- ============================================================================
-- This migration adds email preference fields to the profiles table
-- to support broadcast/marketing emails (e.g., monthly product updates)
-- ============================================================================

-- Add email preference columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS marketing_emails_enabled boolean DEFAULT true NOT NULL,
ADD COLUMN IF NOT EXISTS marketing_email_token uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
ADD COLUMN IF NOT EXISTS marketing_email_unsubscribed_at timestamp with time zone;

-- Create index for quick token lookups (for unsubscribe links)
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_email_token
  ON public.profiles(marketing_email_token);

-- Add comments for documentation
COMMENT ON COLUMN public.profiles.marketing_emails_enabled IS 'User preference for receiving marketing/product update emails';
COMMENT ON COLUMN public.profiles.marketing_email_token IS 'Unique token for unsubscribe links in broadcast emails';
COMMENT ON COLUMN public.profiles.marketing_email_unsubscribed_at IS 'Timestamp when user unsubscribed from marketing emails';

-- ============================================================================
-- Function: unsubscribe_from_marketing_emails
-- Purpose: Allow users to unsubscribe via token-based link
-- ============================================================================
CREATE OR REPLACE FUNCTION public.unsubscribe_from_marketing_emails(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated integer;
BEGIN
    UPDATE public.profiles
    SET marketing_emails_enabled = false,
        marketing_email_unsubscribed_at = timezone('utc'::text, now())
    WHERE marketing_email_token = p_token
      AND marketing_emails_enabled = true;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- Grant execution to public (unauthenticated users can unsubscribe)
GRANT EXECUTE ON FUNCTION public.unsubscribe_from_marketing_emails(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.unsubscribe_from_marketing_emails IS 'Unsubscribe user from marketing emails using token from email link';

-- ============================================================================
-- Function: resubscribe_to_marketing_emails
-- Purpose: Allow authenticated users to re-enable marketing emails
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resubscribe_to_marketing_emails(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_updated integer;
BEGIN
    -- Only allow if called by the user themselves
    IF auth.uid() != p_user_id THEN
        RETURN false;
    END IF;

    UPDATE public.profiles
    SET marketing_emails_enabled = true,
        marketing_email_unsubscribed_at = NULL
    WHERE id = p_user_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- Grant execution to authenticated users only
GRANT EXECUTE ON FUNCTION public.resubscribe_to_marketing_emails(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.resubscribe_to_marketing_emails IS 'Allow authenticated users to re-enable marketing emails';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
