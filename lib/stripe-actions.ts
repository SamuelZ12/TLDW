'use client'

import { getStripe } from '@/lib/stripe-browser'

type PriceType = 'subscription' | 'topup'

async function fetchJson(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    let message = 'Request failed'
    try {
      const data = await response.json()
      if (data?.error) {
        message = data.error
      }
    } catch {
      // ignore JSON parse error and use fallback message
    }
    throw new Error(message)
  }

  return response.json()
}

export async function startCheckout(priceType: PriceType): Promise<void> {
  const { sessionId } = await fetchJson('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceType }),
  })

  const stripeClient = await getStripe()

  if (!stripeClient) {
    throw new Error('Stripe.js failed to load')
  }

  const { error } = await (stripeClient as any).redirectToCheckout({ sessionId })

  if (error) {
    throw new Error(error.message)
  }
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await fetchJson('/api/stripe/create-portal-session', {
    method: 'POST',
  })

  window.location.href = url
}
