import { getStripeClient } from '../lib/stripe-client';
import { createServiceRoleClient } from '../lib/supabase/admin';
import { mapStripeSubscriptionToProfileUpdate } from '../lib/subscription-manager';

async function revertTestCancellation(subscriptionId: string) {
  const stripe = getStripeClient();
  const supabase = createServiceRoleClient();

  console.log(`\n🔄 Reverting test cancellation for subscription: ${subscriptionId}\n`);

  // Fetch actual state from Stripe
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  console.log('📊 Actual Stripe state:');
  console.log(`   status: ${subscription.status}`);
  console.log(`   cancel_at_period_end: ${subscription.cancel_at_period_end}\n`);

  // Find the user
  const { data: profile, error: findError } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (findError || !profile) {
    console.error('❌ Could not find user');
    return;
  }

  // Sync with real Stripe data
  const updatePayload = mapStripeSubscriptionToProfileUpdate(subscription);

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', profile.id);

  if (updateError) {
    console.error('❌ Failed to update:', updateError);
    return;
  }

  console.log('✅ Database synced with actual Stripe state\n');
}

const subscriptionId = process.argv[2] || 'sub_1SS3LGFxv4zxL2QR05DuM6ot';
revertTestCancellation(subscriptionId).catch(console.error);
