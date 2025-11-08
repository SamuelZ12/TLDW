import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { getStripeClient } from '@/lib/stripe-client';
import { getUserSubscriptionStatus } from '@/lib/subscription-manager';

/**
 * POST /api/stripe/create-portal-session
 *
 * Creates a Stripe Customer Portal session for managing subscription
 * Users can update payment methods, view invoices, and cancel subscriptions
 *
 * Response:
 * {
 *   url: string  // Stripe Customer Portal URL
 * }
 */
async function handler(req: NextRequest) {
  try {
    // Get authenticated user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get user's subscription status to retrieve Stripe customer ID
    const subscription = await getUserSubscriptionStatus(user.id);

    if (!subscription?.stripeCustomerId) {
      return NextResponse.json(
        {
          error: 'No subscription found',
          message: 'You need to subscribe first before accessing the billing portal',
        },
        { status: 404 }
      );
    }

    // Create Stripe billing portal session
    const stripe = getStripeClient();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings`,
    });

    return NextResponse.json({
      url: portalSession.url,
    });
  } catch (error) {
    // Handle Stripe errors
    if (error && typeof error === 'object' && 'type' in error) {
      const stripeError = error as any;
      console.error('Stripe error:', stripeError);

      // Check if it's a portal configuration error
      if (
        stripeError.type === 'StripeInvalidRequestError' &&
        stripeError.message?.includes('No configuration')
      ) {
        // Determine if we're in test mode
        const isTestMode = process.env.STRIPE_SECRET_KEY?.includes('_test_');
        const dashboardUrl = isTestMode
          ? 'https://dashboard.stripe.com/test/settings/billing/portal'
          : 'https://dashboard.stripe.com/settings/billing/portal';

        return NextResponse.json(
          {
            error: 'Customer Portal not configured',
            message:
              'The Stripe Customer Portal needs to be set up before you can manage your billing. ' +
              'Please contact support or run the setup script: npm run stripe:setup-portal',
            setupUrl: dashboardUrl,
            isConfigError: true,
          },
          { status: 500 }
        );
      }

      // Generic Stripe error
      return NextResponse.json(
        {
          error: 'Unable to access billing portal',
          message: 'There was an error accessing the billing portal. Please try again.',
        },
        { status: 500 }
      );
    }

    console.error('Error creating portal session:', error);
    return NextResponse.json(
      { error: 'Failed to create billing portal session' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.AUTHENTICATED);
