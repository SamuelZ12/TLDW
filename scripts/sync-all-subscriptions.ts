import { getStripeClient } from '../lib/stripe-client';
import { createServiceRoleClient } from '../lib/supabase/admin';
import { mapStripeSubscriptionToProfileUpdate } from '../lib/subscription-manager';

async function syncAllSubscriptions() {
  const stripe = getStripeClient();
  const supabase = createServiceRoleClient();

  console.log('\n🔄 Syncing all subscriptions from Stripe to database...\n');

  // Get all pro users from database
  const { data: profiles, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, subscription_tier, subscription_status, cancel_at_period_end, stripe_subscription_id')
    .eq('subscription_tier', 'pro')
    .not('stripe_subscription_id', 'is', null);

  if (fetchError || !profiles) {
    console.error('❌ Failed to fetch profiles:', fetchError);
    return;
  }

  console.log(`Found ${profiles.length} pro subscriptions in database\n`);

  let synced = 0;
  let errors = 0;
  let mismatches = 0;

  for (const profile of profiles) {
    try {
      console.log(`\n📊 Processing: ${profile.email || profile.id}`);
      console.log(`   Subscription ID: ${profile.stripe_subscription_id}`);

      // Fetch from Stripe
      const subscription = await stripe.subscriptions.retrieve(profile.stripe_subscription_id!);

      const dbCancelFlag = Boolean(profile.cancel_at_period_end);
      const stripeCancelFlag = Boolean(subscription.cancel_at_period_end);

      console.log(`   Stripe: status=${subscription.status}, cancel_at_period_end=${stripeCancelFlag}`);
      console.log(`   DB: status=${profile.subscription_status}, cancel_at_period_end=${dbCancelFlag}`);

      // Check if there's a mismatch
      const hasMismatch =
        profile.subscription_status !== subscription.status ||
        dbCancelFlag !== stripeCancelFlag;

      if (hasMismatch) {
        mismatches++;
        console.log(`   ⚠️  MISMATCH DETECTED - syncing...`);

        const updatePayload = mapStripeSubscriptionToProfileUpdate(subscription);

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updatePayload)
          .eq('id', profile.id);

        if (updateError) {
          console.error(`   ❌ Update failed:`, updateError.message);
          errors++;
        } else {
          console.log(`   ✅ Synced successfully`);
          synced++;
        }
      } else {
        console.log(`   ✓ Already in sync`);
      }

    } catch (error: any) {
      console.error(`   ❌ Error:`, error.message);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 Sync Summary:`);
  console.log(`   Total subscriptions: ${profiles.length}`);
  console.log(`   Mismatches found: ${mismatches}`);
  console.log(`   Successfully synced: ${synced}`);
  console.log(`   Errors: ${errors}`);
  console.log('\n' + '='.repeat(60) + '\n');
}

syncAllSubscriptions().catch(console.error);
