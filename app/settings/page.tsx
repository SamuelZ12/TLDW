import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUsageStats, getUserSubscriptionStatus } from '@/lib/subscription-manager'
import SettingsForm from './settings-form'

// Force dynamic rendering to prevent caching of subscription status
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const { count: videoCount } = await supabase
    .from('user_videos')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const subscription = await getUserSubscriptionStatus(user.id, { client: supabase })
  const usage = subscription
    ? await getUsageStats(user.id, { client: supabase })
    : null

  const subscriptionSummary = subscription && usage
    ? {
        tier: subscription.tier,
        status: subscription.status,
        stripeCustomerId: subscription.stripeCustomerId,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        isPastDue: subscription.status === 'past_due',
        canPurchaseTopup: subscription.tier === 'pro',
        nextBillingDate: subscription.currentPeriodEnd
          ? subscription.currentPeriodEnd.toISOString()
          : null,
        periodStart: usage.periodStart.toISOString(),
        periodEnd: usage.periodEnd.toISOString(),
        usage: {
          counted: usage.counted,
          cached: usage.cached,
          baseLimit: usage.baseLimit,
          baseRemaining: usage.baseRemaining,
          topupCredits: usage.topupCredits,
          topupRemaining: usage.topupRemaining,
          totalRemaining: usage.totalRemaining,
          resetAt: usage.resetAt,
        },
        willConsumeTopup: usage.baseRemaining <= 0 && usage.topupRemaining > 0,
      }
    : null

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <SettingsForm
        user={user}
        profile={profile}
        videoCount={videoCount ?? 0}
        subscription={subscriptionSummary}
      />
    </div>
  )
}
