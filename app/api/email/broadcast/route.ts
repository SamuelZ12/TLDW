/**
 * Broadcast Email API (Admin Only)
 *
 * Admin-only endpoint for sending broadcast emails (e.g., monthly product updates).
 *
 * POST /api/email/broadcast
 * - Sends broadcast email to all opted-in users
 * - Body: { subject: string, updates: Array<{title, description, link?}>, customMessage?: string }
 *
 * Authentication:
 * - Requires admin privileges (check via email or role)
 * - Set ADMIN_EMAILS environment variable with comma-separated admin emails
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendMonthlyUpdateEmail } from '@/lib/postmark-client';
import { z } from 'zod';

// Admin email check
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'zara@longcut.ai')
  .split(',')
  .map((email) => email.trim().toLowerCase());

// Request body schema
const BroadcastRequestSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  updates: z
    .array(
      z.object({
        title: z.string().min(1, 'Update title is required'),
        description: z.string().min(1, 'Update description is required'),
        link: z.string().url().optional(),
      })
    )
    .min(1, 'At least one update is required'),
  customMessage: z.string().optional(),
});

/**
 * Send broadcast email to all opted-in users
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const userEmail = user.email?.toLowerCase();
    if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) {
      console.warn(`Non-admin user ${userEmail} attempted to send broadcast email`);
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = BroadcastRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const { subject, updates, customMessage } = validationResult.data;

    // Fetch all users who have opted in to marketing emails
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email, marketing_email_token')
      .eq('marketing_emails_enabled', true)
      .not('email', 'is', null);

    if (profilesError) {
      console.error('Error fetching opted-in users:', profilesError);
      return NextResponse.json(
        { error: 'Failed to fetch recipients' },
        { status: 500 }
      );
    }

    // Filter out invalid email addresses and prepare recipients
    const recipients = profiles
      .filter((profile) => profile.email && profile.marketing_email_token)
      .map((profile) => ({
        email: profile.email!,
        userId: profile.id,
        unsubscribeToken: profile.marketing_email_token!,
      }));

    if (recipients.length === 0) {
      return NextResponse.json(
        {
          error: 'No recipients found',
          message: 'No users have opted in to receive product update emails',
        },
        { status: 400 }
      );
    }

    // Send broadcast email via Postmark
    console.log(`Sending broadcast email to ${recipients.length} recipients...`);
    const result = await sendMonthlyUpdateEmail({
      recipients,
      subject,
      updates,
      customMessage,
    });

    console.log(`Broadcast email sent: ${result.sent} succeeded, ${result.failed} failed`);

    // Return result
    return NextResponse.json({
      success: result.success,
      sent: result.sent,
      failed: result.failed,
      total: recipients.length,
      errors: result.errors,
    });
  } catch (error) {
    console.error('Unexpected error in POST /api/email/broadcast:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * Get broadcast email statistics (admin only)
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const userEmail = user.email?.toLowerCase();
    if (!userEmail || !ADMIN_EMAILS.includes(userEmail)) {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    // Get email subscription statistics
    const { data: stats, error: statsError } = await supabase
      .from('profiles')
      .select('marketing_emails_enabled')
      .not('email', 'is', null);

    if (statsError) {
      console.error('Error fetching email stats:', statsError);
      return NextResponse.json(
        { error: 'Failed to fetch statistics' },
        { status: 500 }
      );
    }

    const totalUsers = stats.length;
    const optedIn = stats.filter((s) => s.marketing_emails_enabled).length;
    const optedOut = totalUsers - optedIn;

    return NextResponse.json({
      totalUsers,
      optedIn,
      optedOut,
      optInRate: totalUsers > 0 ? ((optedIn / totalUsers) * 100).toFixed(1) : '0',
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/email/broadcast:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
