import Stripe from 'stripe';

/**
 * Server-side Stripe client for API operations
 * This should only be used in API routes or server components
 *
 * @throws Error if STRIPE_SECRET_KEY is not configured
 */
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    'STRIPE_SECRET_KEY is not set. Please add it to your .env.local file.\n' +
    'Get your test key from: https://dashboard.stripe.com/test/apikeys'
  );
}

/**
 * Singleton Stripe instance for server-side operations
 *
 * Configuration:
 * - API version: Latest (automatically uses newest API version)
 * - TypeScript: Enabled for type-safe operations
 * - App info: Identifies requests as coming from TLDW
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20',
  typescript: true,
  appInfo: {
    name: 'TLDW',
    version: '1.0.0',
    url: 'https://github.com/yourusername/tldw',
  },
});

/**
 * Stripe Price IDs from environment variables
 * These are configured in .env.local and created in the Stripe Dashboard
 */
export const STRIPE_PRICE_IDS = {
  /** Pro subscription: $5/month recurring */
  PRO_SUBSCRIPTION: process.env.STRIPE_PRO_PRICE_ID!,

  /** Top-Up credits: $3 one-time for +20 video credits */
  TOPUP_CREDITS: process.env.STRIPE_TOPUP_PRICE_ID!,
} as const;

/**
 * Validates that all required Stripe configuration is present
 * Call this during app initialization or in API routes to fail fast
 *
 * @throws Error if any required config is missing
 */
export function validateStripeConfig(): void {
  const missing: string[] = [];

  if (!process.env.STRIPE_SECRET_KEY) {
    missing.push('STRIPE_SECRET_KEY');
  }

  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    missing.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    missing.push('STRIPE_WEBHOOK_SECRET');
  }

  if (!process.env.STRIPE_PRO_PRICE_ID) {
    missing.push('STRIPE_PRO_PRICE_ID');
  }

  if (!process.env.STRIPE_TOPUP_PRICE_ID) {
    missing.push('STRIPE_TOPUP_PRICE_ID');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required Stripe configuration: ${missing.join(', ')}\n` +
      'Please add these to your .env.local file.\n' +
      'Get your keys from: https://dashboard.stripe.com/test/apikeys\n' +
      'Get your webhook secret from: https://dashboard.stripe.com/test/webhooks'
    );
  }
}
