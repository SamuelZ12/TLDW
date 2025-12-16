import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export async function POST() {
  const supabase = await createClient()
  
  // Sign out server-side
  await supabase.auth.signOut()
  
  // Explicitly clear all Supabase auth cookies
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()
  
  const response = NextResponse.json({ success: true })
  
  // Delete all sb-* cookies (Supabase auth cookies)
  allCookies
    .filter(cookie => cookie.name.startsWith('sb-'))
    .forEach(cookie => {
      response.cookies.delete(cookie.name)
    })
  
  return response
}
