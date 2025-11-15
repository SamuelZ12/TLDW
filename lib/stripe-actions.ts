'use client'

import { csrfFetch } from '@/lib/csrf-client'

type PriceType = 'subscription' | 'subscription_annual' | 'topup'

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
      // Check if response body has already been consumed (shouldn't happen with fixed CSRF logic)
      if (response.bodyUsed) {
        console.error('Response body already consumed - this indicates a bug in request handling')
        throw new Error('Response body unavailable')
      }
      const data = await response.json()
      if (data?.error) {
        message = data.error
      }
    } catch (error) {
      // Log parse errors for debugging but continue with fallback message
      if (error instanceof Error && !error.message.includes('Response body')) {
        console.error('Failed to parse error response:', error)
      }
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
      // Check if response body has already been consumed
      if (response.bodyUsed) {
        console.error('Response body already consumed - this indicates a bug in request handling')
        throw new Error('Response body unavailable')
      }
      const data = await response.json()
      // Use the detailed message if available, otherwise fall back to error field
      if (data?.message) {
        message = data.message
      } else if (data?.error) {
        message = data.error
      }
    } catch (error) {
      // Log parse errors for debugging but continue with fallback message
      if (error instanceof Error && !error.message.includes('Response body')) {
        console.error('Failed to parse error response:', error)
      }
    }
    throw new Error(message)
  }

  const { url } = await response.json()

  window.location.href = url
}
