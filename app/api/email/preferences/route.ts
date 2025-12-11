/**
 * Email Preferences API
 *
 * Authenticated endpoint for users to manage their email preferences.
 *
 * GET /api/email/preferences
 * - Returns user's current email preferences
 *
 * PATCH /api/email/preferences
 * - Updates user's email preferences
 * - Body: { marketing_emails_enabled: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Get user's email preferences
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's profile with email preferences
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('marketing_emails_enabled, marketing_email_unsubscribed_at')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching user profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to fetch email preferences' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      marketing_emails_enabled: profile.marketing_emails_enabled,
      unsubscribed_at: profile.marketing_email_unsubscribed_at,
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/email/preferences:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Update user's email preferences
 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { marketing_emails_enabled } = body;

    // Validate input
    if (typeof marketing_emails_enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid input: marketing_emails_enabled must be a boolean' },
        { status: 400 }
      );
    }

    // Update preferences based on the value
    if (marketing_emails_enabled) {
      // Re-enable marketing emails
      const { data, error } = await supabase.rpc(
        'resubscribe_to_marketing_emails',
        {
          p_user_id: user.id,
        }
      );

      if (error) {
        console.error('Error resubscribing user:', error);
        return NextResponse.json(
          { error: 'Failed to update email preferences' },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Failed to update email preferences' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        marketing_emails_enabled: true,
        message: 'Successfully subscribed to product update emails',
      });
    } else {
      // Disable marketing emails
      const { error } = await supabase
        .from('profiles')
        .update({
          marketing_emails_enabled: false,
          marketing_email_unsubscribed_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) {
        console.error('Error unsubscribing user:', error);
        return NextResponse.json(
          { error: 'Failed to update email preferences' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        marketing_emails_enabled: false,
        message: 'Successfully unsubscribed from product update emails',
      });
    }
  } catch (error) {
    console.error('Unexpected error in PATCH /api/email/preferences:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
