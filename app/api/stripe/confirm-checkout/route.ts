import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { stripe } from '@/lib/stripe-client';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { withSecurity, SECURITY_PRESETS } from '@/lib/security-middleware';
import { mapStripeSubscriptionToProfileUpdate } from '@/lib/subscription-manager';

const requestSchema = z.object({
  sessionId: z.string().min(1, 'Missing checkout session'),
});

async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId } = requestSchema.parse(body);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (!session) {
      return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 });
    }

    const sessionUserId = session.metadata?.userId;
    if (!sessionUserId || sessionUserId !== user.id) {
      return NextResponse.json({ error: 'Session does not belong to this user' }, { status: 403 });
    }

    if (session.mode !== 'subscription' || !session.subscription) {
      return NextResponse.json({ status: 'noop', updated: false });
    }

    const subscription =
      typeof session.subscription === 'string'
        ? await stripe.subscriptions.retrieve(session.subscription)
        : session.subscription;

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription details unavailable' }, { status: 404 });
    }

    const serviceClient = createServiceRoleClient();

    const updatePayload = {
      ...mapStripeSubscriptionToProfileUpdate(subscription),
      stripe_customer_id:
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null,
    };

    const { error } = await serviceClient
      .from('profiles')
      .update(updatePayload)
      .eq('id', user.id);

    if (error) {
      console.error('Failed to persist subscription via confirmation endpoint:', error);
      return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
    }

    return NextResponse.json({
      updated: true,
      tier: 'pro',
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      currentPeriodStart: subscription.current_period_start
        ? new Date(subscription.current_period_start * 1000).toISOString()
        : null,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    console.error('Error confirming checkout session:', error);
    return NextResponse.json({ error: 'Failed to confirm subscription' }, { status: 500 });
  }
}

export const POST = withSecurity(handler, SECURITY_PRESETS.AUTHENTICATED);

