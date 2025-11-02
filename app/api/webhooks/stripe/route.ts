import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe-client';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { addTopupCredits, mapStripeSubscriptionToProfileUpdate } from '@/lib/subscription-manager';
import { AuditLogger, AuditAction } from '@/lib/audit-logger';

export const runtime = 'nodejs';

const DUPLICATE_EVENT_CODE = '23505';

async function handler(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const supabase = createServiceRoleClient();
  let eventId: string | null = null;
  let eventLocked = false;

  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing stripe-signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    eventId = event.id;

    eventLocked = await lockStripeEvent(event.id, supabase);
    if (!eventLocked) {
      console.log(`Stripe event ${event.id} already processed. Skipping.`);
      return NextResponse.json({ received: true });
    }

    console.log(`Received Stripe webhook: ${event.type} (${event.id})`);
    await dispatchStripeEvent(event, supabase);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);

    if (eventLocked && eventId) {
      await releaseStripeEvent(eventId, supabase);
    }

    return NextResponse.json({ received: true });
  }
}

async function dispatchStripeEvent(event: Stripe.Event, supabase: SupabaseClient<any, string, any>) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, supabase);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, supabase);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice, supabase);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, supabase);
      break;
    default:
      console.log(`Unhandled Stripe event type: ${event.type}`);
  }
}

/**
 * Extracts top-up credit and amount values from Stripe price metadata
 * Falls back to default values (20 credits, $3) if metadata is missing
 */
async function extractTopupValuesFromSession(
  session: Stripe.Checkout.Session
): Promise<{ credits: number; amountCents: number }> {
  const DEFAULT_CREDITS = 20;
  const DEFAULT_AMOUNT_CENTS = 300;

  try {
    // Expand line items to get price details
    const sessionWithItems = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'line_items.data.price'],
    });

    const lineItem = sessionWithItems.line_items?.data[0];
    if (!lineItem || !lineItem.price) {
      console.warn('No line items found in checkout session, using defaults');
      return { credits: DEFAULT_CREDITS, amountCents: DEFAULT_AMOUNT_CENTS };
    }

    const price = lineItem.price as Stripe.Price;

    // Extract from price metadata
    const creditsFromMetadata = price.metadata?.credits;
    const credits = creditsFromMetadata ? parseInt(creditsFromMetadata, 10) : DEFAULT_CREDITS;

    // Amount is already in cents in Stripe
    const amountCents = typeof price.unit_amount === 'number' ? price.unit_amount : DEFAULT_AMOUNT_CENTS;

    console.log(`Top-up values extracted: ${credits} credits for ${amountCents} cents`);
    return { credits, amountCents };
  } catch (error) {
    console.error('Failed to extract top-up values from Stripe, using defaults:', error);
    return { credits: DEFAULT_CREDITS, amountCents: DEFAULT_AMOUNT_CENTS };
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  supabase: SupabaseClient<any, string, any>
) {
  const userId = session.metadata?.userId;

  if (!userId) {
    console.error('No userId metadata on checkout session');
    return;
  }

  if (session.mode === 'subscription' && session.subscription) {
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    const updatePayload = {
      ...mapStripeSubscriptionToProfileUpdate(subscription),
      stripe_customer_id: session.customer as string,
    };

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    if (error) {
      console.error('Failed to update subscription after checkout:', error);
    } else {
      await AuditLogger.log({
        userId,
        action: AuditAction.SUBSCRIPTION_CREATED,
        resourceType: 'subscription',
        resourceId: subscriptionId,
        details: { tier: 'pro', status: subscription.status },
      });
    }
  }

  if (session.mode === 'payment' && session.payment_intent) {
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent.id;

    if (session.metadata?.priceType === 'topup') {
      // Extract credit and amount values from Stripe price metadata
      const { credits, amountCents } = await extractTopupValuesFromSession(session);

      const result = await addTopupCredits(userId, credits, { client: supabase });

      if (result.success) {
        const { error } = await supabase.from('topup_purchases').insert({
          user_id: userId,
          stripe_payment_intent_id: paymentIntentId,
          credits_purchased: credits,
          amount_paid: amountCents,
        });

        if (error) {
          console.error('Failed to store top-up purchase:', error);
        } else {
          await AuditLogger.log({
            userId,
            action: AuditAction.TOPUP_PURCHASED,
            resourceType: 'topup',
            resourceId: paymentIntentId,
            details: { credits, amount: amountCents },
          });
        }
      } else {
        console.error('Failed to add top-up credits:', result.error);
      }
    }
  }
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient<any, string, any>
) {
  const userId = subscription.metadata?.userId ?? (await getUserIdBySubscription(subscription.id, supabase));

  if (!userId) {
    console.error('Unable to resolve user for subscription update:', subscription.id);
    return;
  }

  const updatePayload = mapStripeSubscriptionToProfileUpdate(subscription);

  const { error } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', userId);

  if (error) {
    console.error('Failed to sync subscription update:', error);
  } else {
    await AuditLogger.log({
      userId,
      action: AuditAction.SUBSCRIPTION_UPDATED,
      resourceType: 'subscription',
      resourceId: subscription.id,
      details: {
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    });
  }
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient<any, string, any>
) {
  const userId = await getUserIdBySubscription(subscription.id, supabase);

  if (!userId) {
    console.error('Unable to resolve user for canceled subscription:', subscription.id);
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_tier: 'free',
      subscription_status: null,
      stripe_subscription_id: null,
      subscription_current_period_start: null,
      subscription_current_period_end: null,
      cancel_at_period_end: false,
    })
    .eq('id', userId);

  if (error) {
    console.error('Failed to downgrade user after cancellation:', error);
  } else {
    await AuditLogger.log({
      userId,
      action: AuditAction.SUBSCRIPTION_CANCELED,
      resourceType: 'subscription',
      resourceId: subscription.id,
      details: { downgradedToFree: true },
    });
  }
}

async function handleInvoicePaymentSucceeded(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient<any, string, any>
) {
  const subscriptionRef = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  }).subscription;

  if (!subscriptionRef) {
    return;
  }

  const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
  const userId = await getUserIdBySubscription(subscriptionId, supabase);

  if (!userId) {
    console.error('Unable to resolve user for invoice:', invoice.id);
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ subscription_status: 'active' })
    .eq('id', userId);

  if (error) {
    console.error('Failed to mark subscription as active:', error);
  }
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: SupabaseClient<any, string, any>
) {
  const subscriptionRef = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  }).subscription;

  if (!subscriptionRef) {
    return;
  }

  const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
  const userId = await getUserIdBySubscription(subscriptionId, supabase);

  if (!userId) {
    console.error('Unable to resolve user for failed invoice:', invoice.id);
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ subscription_status: 'past_due' })
    .eq('id', userId);

  if (error) {
    console.error('Failed to mark subscription as past_due:', error);
  } else {
    await AuditLogger.log({
      userId,
      action: AuditAction.PAYMENT_FAILED,
      resourceType: 'invoice',
      resourceId: invoice.id,
      details: { subscriptionId },
    });
  }
}

async function getUserIdBySubscription(
  subscriptionId: string,
  supabase: SupabaseClient<any, string, any>
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (error) {
    console.error('Failed to locate user by subscription:', error);
    return null;
  }

  return data?.id ?? null;
}

async function lockStripeEvent(eventId: string, supabase: SupabaseClient<any, string, any>): Promise<boolean> {
  const { error } = await supabase
    .from('stripe_events')
    .insert({ event_id: eventId });

  if (!error) {
    return true;
  }

  if ('code' in error && error.code === DUPLICATE_EVENT_CODE) {
    return false;
  }

  throw error;
}

async function releaseStripeEvent(eventId: string, supabase: SupabaseClient<any, string, any>): Promise<void> {
  const { error } = await supabase
    .from('stripe_events')
    .delete()
    .eq('event_id', eventId);

  if (error) {
    console.error('Failed to release Stripe event lock:', error);
  }
}

export const POST = handler;
