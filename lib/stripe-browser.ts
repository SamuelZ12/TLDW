import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';

export type StripeBrowserClient = StripeJs;

let stripePromise: Promise<StripeBrowserClient | null> | null = null;

// Capture the key at module load time for proper Next.js build-time replacement
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * Loads and returns the Stripe.js client instance.
 * This function is memoized to ensure Stripe.js is only loaded once.
 *
 * @throws {Error} If NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured
 * @returns Promise resolving to Stripe client or null if loading fails
 */
export async function getStripe(): Promise<StripeBrowserClient | null> {
  if (!stripePromise) {
    // Runtime fallback: check environment variable again if module-level constant is undefined
    // This handles cases where dev server started before .env.local was configured
    const key = publishableKey || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!key) {
      const errorMsg =
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set. ' +
        'Please add it to your .env.local file and restart the dev server.';
      console.error('[Stripe Browser] Configuration error:', errorMsg);
      throw new Error(errorMsg);
    }

    // Validate key format
    if (!key.startsWith('pk_')) {
      const errorMsg = `Invalid Stripe publishable key format. Expected key to start with 'pk_', got: ${key.substring(0, 10)}...`;
      console.error('[Stripe Browser] Configuration error:', errorMsg);
      throw new Error(errorMsg);
    }

    console.log('[Stripe Browser] Loading Stripe.js with key:', key.substring(0, 20) + '...');

    try {
      stripePromise = loadStripe(key);
    } catch (error) {
      const errorMsg = `Failed to initialize Stripe.js: ${error instanceof Error ? error.message : String(error)}`;
      console.error('[Stripe Browser] Initialization error:', errorMsg, error);
      throw new Error(errorMsg);
    }
  }

  try {
    const stripe = await stripePromise;

    if (!stripe) {
      const errorMsg =
        'Stripe.js failed to load from CDN. ' +
        'This could be due to network issues, ad blockers, or Content Security Policy restrictions. ' +
        'Please check your browser console for more details.';
      console.error('[Stripe Browser] Loading error:', errorMsg);
      throw new Error(errorMsg);
    }

    return stripe;
  } catch (error) {
    console.error('[Stripe Browser] Error loading Stripe.js:', error);
    throw error;
  }
}
