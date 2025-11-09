import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { getStripeClient, STRIPE_PRICE_IDS } from '@/lib/stripe-client';
import {
  createOrRetrieveStripeCustomer,
  hasProSubscription,
} from '@/lib/subscription-manager';
import { formatValidationError } from '@/lib/validation';

/**
 * Request schema for creating a checkout session
 */
const createCheckoutSessionSchema = z.object({
  priceType: z.enum(['subscription', 'subscription_annual', 'topup']),
});

/**
 * POST /api/stripe/create-checkout-session
 *
 * Creates a Stripe Checkout session for Pro subscription or Top-Up credits purchase
 *
 * Request body:
 * {
 *   priceType: 'subscription' | 'topup'
 * }
 *
 * Response:
 * {
 *   url: string  // Stripe Checkout hosted page URL
 * }
 */
async function handler(req: NextRequest) {
  // Declare variables outside try block so they're accessible in catch block
  let priceId: string | undefined;
  let validatedData: z.infer<typeof createCheckoutSessionSchema> | undefined;

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

    // Get user email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    const userEmail = user.email || profile?.email;

    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email not found' },
        { status: 400 }
      );
    }

    // Validate request body
    const body = await req.json();
    validatedData = createCheckoutSessionSchema.parse(body);

    // For top-up purchases, verify user has Pro subscription
    if (validatedData.priceType === 'topup') {
      const isPro = await hasProSubscription(user.id);

      if (!isPro) {
        return NextResponse.json(
          {
            error: 'Top-Up credits are only available for Pro subscribers',
            message: 'Upgrade to Pro first to purchase Top-Up credits',
          },
          { status: 403 }
        );
      }
    }

    // Create or retrieve Stripe customer
    const { customerId, error: customerError } = await createOrRetrieveStripeCustomer(
      user.id,
      userEmail
    );

    if (customerError || !customerId) {
      console.error('Failed to create/retrieve Stripe customer:', customerError);
      return NextResponse.json(
        { error: 'Unable to process payment setup' },
        { status: 500 }
      );
    }

    // Determine the price ID and mode based on priceType
    const isSubscription =
      validatedData.priceType === 'subscription' || validatedData.priceType === 'subscription_annual';
    priceId = (() => {
      switch (validatedData.priceType) {
        case 'subscription':
          return STRIPE_PRICE_IDS.PRO_SUBSCRIPTION;
        case 'subscription_annual':
          return STRIPE_PRICE_IDS.PRO_SUBSCRIPTION_ANNUAL;
        default:
          return STRIPE_PRICE_IDS.TOPUP_CREDITS;
      }
    })();

    const mode = isSubscription ? 'subscription' : 'payment';

    // Debug logging
    console.log('Creating checkout session:', {
      priceType: validatedData.priceType,
      priceId,
      mode,
      userId: user.id,
    });

    // Validate price ID exists
    if (!priceId) {
      const errorMessage = validatedData.priceType === 'subscription_annual'
        ? 'Annual subscription price not configured. Please check STRIPE_PRO_ANNUAL_PRICE_ID environment variable.'
        : `Price ID not configured for ${validatedData.priceType}`;
      console.error(errorMessage);
      return NextResponse.json(
        { error: 'Subscription configuration error. Please contact support.' },
        { status: 500 }
      );
    }

    // Create Stripe Checkout session
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: mode,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?canceled=true`,
      metadata: {
        userId: user.id,
        priceType: validatedData.priceType,
      },
      // Allow promotion codes
      allow_promotion_codes: true,
      // For subscriptions, set billing cycle anchor
      ...(mode === 'subscription' && {
        subscription_data: {
          metadata: {
            userId: user.id,
            billingPeriod: validatedData.priceType === 'subscription_annual' ? 'annual' : 'monthly',
          },
        },
      }),
    });

    return NextResponse.json({
      url: session.url,
    });
  } catch (error) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: formatValidationError(error),
        },
        { status: 400 }
      );
    }

    // Handle Stripe errors
    if (error && typeof error === 'object' && 'type' in error) {
      const stripeError = error as any;
      console.error('Stripe API error:', {
        type: stripeError.type,
        code: stripeError.code,
        message: stripeError.message,
        param: stripeError.param,
        requestId: stripeError.requestId,
      });

      // Provide more specific error messages for common issues
      let errorMessage = 'Payment processing error. Please try again.';

      if (stripeError.code === 'resource_missing') {
        const isTestKey = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
        const mode = isTestKey ? 'test' : 'live';

        console.error('❌ Stripe Price ID Not Found:', {
          priceId,
          priceType: validatedData?.priceType,
          stripeMode: mode,
          error: stripeError.message,
          hint: `The price ID '${priceId}' does not exist in ${mode} mode. Check your .env.local configuration.`,
        });

        // Check if the error message mentions mode mismatch
        if (stripeError.message?.includes('similar object exists in')) {
          const oppositeMode = isTestKey ? 'live' : 'test';
          errorMessage = `Configuration error: This price exists in ${oppositeMode} mode, but you're using ${mode} mode keys. Please update your environment variables to use the correct price IDs for ${mode} mode.`;
        } else {
          errorMessage = 'Invalid payment configuration. The selected plan is not available. Please contact support.';
        }
      }

      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    console.error('Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.AUTHENTICATED);
