import { createClient } from '@/lib/supabase/server';
import { resolveAppUrl } from '@/lib/utils';
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get('token_hash');
  const type = requestUrl.searchParams.get('type') as EmailOtpType | null;
  const redirect_to = requestUrl.searchParams.get('redirect_to');
  const origin = resolveAppUrl(requestUrl.origin);

  console.log('🔐 Email confirmation request:', {
    token_hash: token_hash ? 'present' : 'missing',
    type,
    redirect_to,
    origin,
  });

  if (token_hash && type) {
    const supabase = await createClient();

    try {
      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash,
      });

      if (error) {
        console.error('❌ Email confirmation error:', error);
        return NextResponse.redirect(
          `${origin}?auth_error=${encodeURIComponent(error.message)}`
        );
      }

      console.log('✅ Email confirmation successful');

      // Successful confirmation - redirect to specified URL or home
      const redirectUrl = redirect_to || origin;
      return NextResponse.redirect(redirectUrl);
    } catch (err) {
      console.error('❌ Unexpected error during email confirmation:', err);
      return NextResponse.redirect(
        `${origin}?auth_error=${encodeURIComponent('An unexpected error occurred')}`
      );
    }
  }

  // Missing required parameters
  console.error('❌ Missing required parameters:', { token_hash, type });
  return NextResponse.redirect(
    `${origin}?auth_error=${encodeURIComponent('Invalid confirmation link')}`
  );
}
