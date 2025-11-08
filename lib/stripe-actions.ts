'use client'

import { csrfFetch } from '@/lib/csrf-client'

type PriceType = 'subscription' | 'topup'

/**
 * Initiates a Stripe Checkout session for subscription or top-up purchase.
 * Creates a checkout session and redirects to the Stripe-hosted checkout page.
 *
 * @param priceType - Type of purchase: 'subscription' or 'topup'
 * @throws {Error} If checkout session creation fails
 */
export async function startCheckout(priceType: PriceType): Promise<void> {
  const response = await csrfFetch.post('/api/stripe/create-checkout-session', { priceType })

  if (!response.ok) {
    let message = 'Failed to create checkout session'
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

  const { url } = await response.json()

  // Redirect to Stripe Checkout
  window.location.href = url
}

export async function openBillingPortal(): Promise<void> {
  const response = await csrfFetch.post('/api/stripe/create-portal-session', {})

  if (!response.ok) {
    let message = 'Request failed'
    try {
      const data = await response.json()
      // Use the detailed message if available, otherwise fall back to error field
      if (data?.message) {
        message = data.message
      } else if (data?.error) {
        message = data.error
      }
    } catch {
      // ignore JSON parse error and use fallback message
    }
    throw new Error(message)
  }

  const { url } = await response.json()

  window.location.href = url
}
