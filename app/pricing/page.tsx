import { createClient } from '@/lib/supabase/server'
import PricingContent from './pricing-content'
import { getUserSubscriptionStatus } from '@/lib/subscription-manager'
import type { SubscriptionStatus, SubscriptionTier } from '@/lib/subscription-manager'

export default async function PricingPage() {
  const supabase = await createClient()

  const {
    data: { user }
  } = await supabase.auth.getUser()

  let tier: SubscriptionTier | 'anonymous' = 'anonymous'
  let status: SubscriptionStatus = null

  if (user) {
    tier = 'free'

    const subscription = await getUserSubscriptionStatus(user.id, { client: supabase })
    if (subscription) {
      tier = subscription.tier
      status = subscription.status
    }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 sm:py-16">
      <PricingContent isAuthenticated={Boolean(user)} tier={tier} status={status} />
    </div>
  )
}
