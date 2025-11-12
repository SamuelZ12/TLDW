import { getStripeClient } from '../lib/stripe-client';
import { createServiceRoleClient } from '../lib/supabase/admin';
import { mapStripeSubscriptionToProfileUpdate } from '../lib/subscription-manager';

async function syncSubscriptionFromStripe(subscriptionId: string) {
  const stripe = getStripeClient();
  const supabase = createServiceRoleClient();

  console.log(`\nFetching subscription ${subscriptionId} from Stripe...`);

  try {
    // Fetch subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    console.log('\n📊 Stripe Subscription Data:');
    console.log(`  ID: ${subscription.id}`);
    console.log(`  Status: ${subscription.status}`);
    console.log(`  Cancel at period end: ${subscription.cancel_at_period_end}`);
    console.log(`  Current period end: ${subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : 'N/A'}`);

    // Find user by subscription ID
    const { data: profile, error: findError } = await supabase
      .from('profiles')
      .select('id, email, subscription_tier, subscription_status, cancel_at_period_end')
      .eq('stripe_subscription_id', subscriptionId)
      .maybeSingle();

    if (findError || !profile) {
      console.error('❌ Could not find user with this subscription:', findError);
      return;
    }

    console.log(`\n👤 Found user: ${profile.email || profile.id}`);
    console.log('  Current DB state:');
    console.log(`    Tier: ${profile.subscription_tier}`);
    console.log(`    Status: ${profile.subscription_status}`);
    console.log(`    Cancel at period end: ${profile.cancel_at_period_end}`);

    // Map Stripe data to database update
    const updatePayload = mapStripeSubscriptionToProfileUpdate(subscription);

    console.log('\n🔄 Updating database with Stripe data...');
    console.log('  Update payload:', JSON.stringify(updatePayload, null, 2));

    // Update the database
    const { error: updateError } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', profile.id);

    if (updateError) {
      console.error('❌ Failed to update database:', updateError);
      return;
    }

    console.log('✅ Successfully synced subscription from Stripe to database!');

    // Verify the update
    const { data: updated } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_status, cancel_at_period_end, subscription_current_period_end')
      .eq('id', profile.id)
      .single();

    console.log('\n✅ Updated DB state:');
    console.log(`  Tier: ${updated?.subscription_tier}`);
    console.log(`  Status: ${updated?.subscription_status}`);
    console.log(`  Cancel at period end: ${updated?.cancel_at_period_end}`);
    console.log(`  Period end: ${updated?.subscription_current_period_end}`);

  } catch (error) {
    console.error('❌ Error syncing subscription:', error);
  }
}

// Get subscription ID from command line args
const subscriptionId = process.argv[2];

if (!subscriptionId) {
  console.error('❌ Usage: npx tsx scripts/sync-subscription-from-stripe.ts <subscription_id>');
  console.error('\nExample: npx tsx scripts/sync-subscription-from-stripe.ts sub_1ABC123...');
  process.exit(1);
}

syncSubscriptionFromStripe(subscriptionId).catch(console.error);
