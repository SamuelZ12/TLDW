import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const error = requestUrl.searchParams.get('error')
  const errorDescription = requestUrl.searchParams.get('error_description')
  const origin = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin

  // Handle OAuth errors
  if (error) {
    console.error('OAuth error:', error, errorDescription)
    // Redirect to home with error parameter
    return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent(errorDescription || error)}`)
  }

  if (code) {
    try {
      const supabase = await createClient()
      const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code)

      if (sessionError) {
        console.error('Session exchange error:', sessionError)
        return NextResponse.redirect(`${origin}?auth_error=${encodeURIComponent(sessionError.message)}`)
      }
    } catch (err) {
      console.error('Unexpected error during auth callback:', err)
      return NextResponse.redirect(`${origin}?auth_error=Authentication%20failed`)
    }
  }

  // URL to redirect to after sign in process completes
  // The pending video will be linked via the useEffect in page.tsx
  return NextResponse.redirect(origin)
}