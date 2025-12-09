import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';

/**
 * Admin endpoint to manually create users
 *
 * IMPORTANT: This endpoint should be protected with authentication
 * or removed after use. Currently it requires an admin secret.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin secret (you should set this in your environment)
    const adminSecret = request.headers.get('x-admin-secret');
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { email, password, metadata } = await request.json();

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Create user using service role client (bypasses email confirmation)
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: metadata || {},
    });

    if (error) {
      console.error('Error creating user:', error);
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    console.log('✅ User created successfully:', {
      id: data.user.id,
      email: data.user.email,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        created_at: data.user.created_at,
      },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
