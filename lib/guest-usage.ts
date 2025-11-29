import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const GUEST_TOKEN_COOKIE = 'tldw_guest_token'
const GUEST_USED_COOKIE = 'tldw_guest_analysis_used'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5 // 5 years
const GUEST_RATE_KEY = 'guest-analysis'

export type GuestAccessState = {
  token: string
  tokenNeedsSet: boolean
  used: boolean
  identifiers: string[]
}

async function getIpHash(): Promise<string | null> {
  const headerList = await headers()
  const forwardedFor = headerList.get('x-forwarded-for')
  const realIp = headerList.get('x-real-ip')
  const rawIp = forwardedFor?.split(',')[0]?.trim() || realIp || null

  if (!rawIp) return null

  return crypto.createHash('sha256').update(rawIp).digest('hex').slice(0, 32)
}

export async function getGuestAccessState(options?: {
  supabase?: SupabaseClient
}): Promise<GuestAccessState> {
  const supabase = options?.supabase ?? (await createClient())
  const cookieStore = await cookies()

  const existingToken = cookieStore.get(GUEST_TOKEN_COOKIE)?.value
  const token = existingToken || crypto.randomUUID()
  const tokenNeedsSet = !existingToken

  const ipHash = await getIpHash()
  const identifiers = [token]
  if (ipHash) {
    identifiers.push(`ip:${ipHash}`)
  }

  const usedCookie = cookieStore.get(GUEST_USED_COOKIE)?.value === '1'
  let used = usedCookie

  if (!used) {
    const { data, error } = await supabase
      .from('rate_limits')
      .select('id')
      .eq('key', GUEST_RATE_KEY)
      .in('identifier', identifiers)
      .limit(1)

    if (error) {
      console.error('Failed to read guest usage:', error)
    }

    used = Boolean(data?.length)
  }

  return {
    token,
    tokenNeedsSet,
    used,
    identifiers
  }
}

export function setGuestCookies(
  response: NextResponse,
  state: GuestAccessState,
  options?: { markUsed?: boolean }
): void {
  const cookieConfig = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE
  }

  if (state.tokenNeedsSet) {
    response.cookies.set(GUEST_TOKEN_COOKIE, state.token, cookieConfig)
  }

  if (options?.markUsed) {
    response.cookies.set(GUEST_USED_COOKIE, '1', cookieConfig)
  }
}

export async function recordGuestUsage(
  state: GuestAccessState,
  options?: { supabase?: SupabaseClient }
): Promise<void> {
  const supabase = options?.supabase ?? (await createClient())

  const rows = state.identifiers.map((identifier) => ({
    key: GUEST_RATE_KEY,
    identifier,
    timestamp: new Date().toISOString()
  }))

  const { error } = await supabase.from('rate_limits').insert(rows)

  if (error) {
    console.error('Failed to record guest usage:', error)
  }
}
