import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';

export type StripeBrowserClient = StripeJs;

let stripePromise: Promise<StripeBrowserClient | null> | null = null;

export function getStripe(): Promise<StripeBrowserClient | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set');
    }

    stripePromise = loadStripe(publishableKey);
  }

  return stripePromise;
}
