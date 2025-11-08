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
  priceType: z.enum(['subscription', 'topup']),
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
    const validatedData = createCheckoutSessionSchema.parse(body);

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
    const priceId =
      validatedData.priceType === 'subscription'
        ? STRIPE_PRICE_IDS.PRO_SUBSCRIPTION
        : STRIPE_PRICE_IDS.TOPUP_CREDITS;

    const mode = validatedData.priceType === 'subscription' ? 'subscription' : 'payment';

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
      console.error('Stripe error:', error);
      return NextResponse.json(
        { error: 'Payment processing error. Please try again.' },
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
