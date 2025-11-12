import { createServiceRoleClient } from '../lib/supabase/admin';
import { mapStripeSubscriptionToProfileUpdate } from '../lib/subscription-manager';
import type Stripe from 'stripe';

async function testCancellationWebhook(subscriptionId: string) {
  const supabase = createServiceRoleClient();

  console.log(`\n🧪 Testing cancellation webhook for subscription: ${subscriptionId}\n`);

  // Find the user
  const { data: profile, error: findError } = await supabase
    .from('profiles')
    .select('id, email, subscription_tier, subscription_status, cancel_at_period_end')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (findError || !profile) {
    console.error('❌ Could not find user with this subscription:', findError);
    return;
  }

  console.log(`👤 Found user: ${profile.email || profile.id}`);
  console.log('📊 Current state:');
  console.log(`   Tier: ${profile.subscription_tier}`);
  console.log(`   Status: ${profile.subscription_status}`);
  console.log(`   Cancel at period end: ${profile.cancel_at_period_end}\n`);

  // Simulate a Stripe subscription object with cancel_at_period_end = true
  const mockCancelledSubscription: Partial<Stripe.Subscription> = {
    id: subscriptionId,
    status: 'active',
    cancel_at_period_end: true,
    current_period_start: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
    current_period_end: Math.floor(Date.now() / 1000) + (29 * 86400), // 29 days from now
  } as any;

  console.log('🔄 Simulating subscription.updated webhook with cancellation...');
  console.log('   Simulated data:');
  console.log(`     status: active`);
  console.log(`     cancel_at_period_end: true`);
  console.log(`     period_end: ${new Date(mockCancelledSubscription.current_period_end! * 1000).toISOString()}\n`);

  // Map to database update (same as webhook handler does)
  const updatePayload = mapStripeSubscriptionToProfileUpdate(mockCancelledSubscription as Stripe.Subscription);

  console.log('📝 Update payload:', JSON.stringify(updatePayload, null, 2), '\n');

  // Apply the update
  const { error: updateError } = await supabase
    .from('profiles')
    .update(updatePayload)
    .eq('id', profile.id);

  if (updateError) {
    console.error('❌ Failed to update database:', updateError);
    return;
  }

  console.log('✅ Database updated successfully!\n');

  // Verify the update
  const { data: updated } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, cancel_at_period_end, subscription_current_period_end')
    .eq('id', profile.id)
    .single();

  console.log('✅ New state in database:');
  console.log(`   Tier: ${updated?.subscription_tier}`);
  console.log(`   Status: ${updated?.subscription_status}`);
  console.log(`   Cancel at period end: ${updated?.cancel_at_period_end}`);
  console.log(`   Period end: ${updated?.subscription_current_period_end}`);

  console.log('\n🎯 Expected UI behavior:');
  if (updated?.cancel_at_period_end) {
    const endDate = new Date(updated.subscription_current_period_end!);
    console.log(`   - Status should show: "Cancels on ${endDate.toLocaleDateString()}"`);
    console.log(`   - Warning alert should appear`);
    console.log(`   - AlertCircle icon should display`);
  } else {
    console.log(`   - Status should show: "Active"`);
  }

  console.log('\n✅ Test complete! Refresh your settings page to see the changes.\n');
}

// Get subscription ID from command line
const subscriptionId = process.argv[2];

if (!subscriptionId) {
  console.error('❌ Usage: npx tsx scripts/test-cancellation-webhook.ts <subscription_id>');
  console.error('\nAvailable subscriptions:');
  console.error('  sub_1SS3LGFxv4zxL2QR05DuM6ot (zzzsamuel12@gmail.com)');
  console.error('  sub_1SRbo8Fxv4zxL2QRUQXccAVA (zhangsamuel1221@gmail.com)');
  console.error('  sub_1SQpNGFxv4zxL2QR0WpzRd7G (zhangsamuel12@gmail.com)');
  console.error('  sub_1SRyYRFxv4zxL2QRAjDUSWf5 (thatzara@gmail.com)');
  process.exit(1);
}

testCancellationWebhook(subscriptionId).catch(console.error);
