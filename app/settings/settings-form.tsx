'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { openBillingPortal as openPortalAction, startCheckout } from '@/lib/stripe-actions'
import { UsageIndicator } from '@/components/usage-indicator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CreditCard, Clock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import type { User } from '@supabase/supabase-js'
import { csrfFetch } from '@/lib/csrf-client'

interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

type SubscriptionTier = 'free' | 'pro'
type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing' | null

interface SubscriptionSummary {
  tier: SubscriptionTier
  status: SubscriptionStatus
  stripeCustomerId: string | null
  cancelAtPeriodEnd: boolean
  isPastDue: boolean
  canPurchaseTopup: boolean
  nextBillingDate: string | null
  periodStart: string
  periodEnd: string
  usage: {
    counted: number
    cached: number
    baseLimit: number
    baseRemaining: number
    topupCredits: number
    topupRemaining: number
    totalRemaining: number
    resetAt: string
  }
  willConsumeTopup: boolean
}

interface SettingsFormProps {
  user: User
  profile: Profile | null
  videoCount: number
  subscription: SubscriptionSummary | null
}

function formatStatus(status: SubscriptionStatus): string {
  if (!status) return 'No subscription'
  switch (status) {
    case 'active':
      return 'Active'
    case 'past_due':
      return 'Past due'
    case 'canceled':
      return 'Canceled'
    case 'incomplete':
      return 'Incomplete'
    case 'trialing':
      return 'Trialing'
    default:
      return status
  }
}

function formatDate(iso: string | null, fallback = 'Not scheduled'): string {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

export default function SettingsForm({ user, profile, videoCount, subscription }: SettingsFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [billingAction, setBillingAction] = useState<'subscription' | 'topup' | 'portal' | null>(null)

  // Poll for subscription updates after Stripe checkout
  useEffect(() => {
    const sessionId = searchParams.get('session_id')

    if (!sessionId) return

    // If already on Pro, no need to poll
    if (subscription?.tier === 'pro') {
      window.history.replaceState({}, '', '/settings')
      return
    }

    let pollInterval: NodeJS.Timeout | undefined
    let timeoutId: NodeJS.Timeout | undefined
    let processingToastShown = false
    let hasWelcomed = false

    const showProcessingToast = () => {
      if (!processingToastShown) {
        toast.loading('Processing your payment...', { id: 'stripe-processing' })
        processingToastShown = true
      }
    }

    const cleanupProcessing = () => {
      if (processingToastShown) {
        toast.dismiss('stripe-processing')
      }
      if (pollInterval) clearInterval(pollInterval)
      if (timeoutId) clearTimeout(timeoutId)
    }

    const handleActivation = () => {
      cleanupProcessing()
      if (!hasWelcomed) {
        toast.success('Welcome to Pro! Your subscription is now active.')
        hasWelcomed = true
      }
      router.refresh()
      window.history.replaceState({}, '', '/settings')
    }

    const confirmCheckout = async () => {
      showProcessingToast()
      try {
        const response = await csrfFetch.post('/api/stripe/confirm-checkout', { sessionId })

        if (!response.ok) {
          return false
        }

        const data = await response.json()

        if (data.updated && data.tier === 'pro') {
          handleActivation()
          return true
        }
      } catch (error) {
        console.error('Error confirming Stripe checkout:', error)
      }

      return false
    }

    const pollForSubscription = async () => {
      try {
        const response = await fetch('/api/subscription/status')
        if (!response.ok) return

        const data = await response.json()

        if (data.tier === 'pro') {
          handleActivation()
        }
      } catch (error) {
        console.error('Error polling subscription status:', error)
      }
    }

    const startPolling = () => {
      showProcessingToast()
      pollForSubscription()
      pollInterval = setInterval(pollForSubscription, 2000)

      timeoutId = setTimeout(() => {
        cleanupProcessing()

        if (subscription?.tier !== 'pro') {
          toast.error('Payment processing is taking longer than expected. Please refresh the page in a moment.')
        }
      }, 30000)
    }

    ;(async () => {
      const confirmed = await confirmCheckout()
      if (!confirmed) {
        startPolling()
      }
    })()

    return () => {
      cleanupProcessing()
    }
  }, [searchParams, subscription?.tier, router])

  const hasProfileChanges = useMemo(() => {
    return fullName !== (profile?.full_name || '')
  }, [fullName, profile?.full_name])

  const planLabel = subscription?.tier === 'pro' ? 'Pro Plan' : 'Free Plan'
  const planStatus = formatStatus(subscription?.status ?? null)
  const nextBillingDate = formatDate(subscription?.nextBillingDate ?? null, 'No upcoming charge')

  const handleUpdateProfile = async () => {
    if (!hasProfileChanges) {
      return
    }

    setLoading(true)

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Settings updated successfully!')
      router.refresh()
    }

    setLoading(false)
  }

  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.updateUser({
      password: newPassword
    })

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Password updated successfully!')
      setNewPassword('')
      setConfirmPassword('')
    }

    setLoading(false)
  }

  const handleCheckout = async (priceType: 'subscription' | 'topup') => {
    try {
      setBillingAction(priceType)
      await startCheckout(priceType)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error starting checkout'
      toast.error(message)
    } finally {
      setBillingAction(null)
    }
  }

  const openBillingPortal = async () => {
    try {
      setBillingAction('portal')
      await openPortalAction()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error opening billing portal'
      toast.error(message)
    } finally {
      setBillingAction(null)
    }
  }

  const subscriptionWarnings = useMemo(() => {
    if (!subscription) return []
    const warnings: Array<{ title: string; message: string; variant?: 'default' | 'destructive' }> = []

    if (subscription.isPastDue) {
      warnings.push({
        title: 'Payment required',
        message: 'Your payment method failed. Update billing details to restore full access.',
        variant: 'destructive',
      })
    }

    if (subscription.cancelAtPeriodEnd) {
      warnings.push({
        title: 'Scheduled to cancel',
        message: 'Your plan will revert to Free at the end of the current billing period.',
      })
    }

    if (subscription.willConsumeTopup) {
      warnings.push({
        title: 'Top-Up credits in use',
        message: 'The next video generation will consume Top-Up credits.',
      })
    }

    return warnings
  }, [subscription])

  const statsRows = useMemo(() => {
    const createdAt = new Date(profile?.created_at || user.created_at)
    const stats = [
      {
        label: 'Account created',
        value: createdAt.toLocaleDateString(),
      },
      {
        label: 'Videos saved',
        value: `${videoCount} ${videoCount === 1 ? 'video' : 'videos'}`,
      },
    ]

    if (subscription) {
      stats.push(
        {
          label: 'Videos this period',
          value: `${subscription.usage.counted}`,
        },
        {
          label: 'Top-Up credits',
          value: `${subscription.usage.topupCredits}`,
        }
      )
    }

    return stats
  }, [profile?.created_at, subscription, user.created_at, videoCount])

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl">Subscription</CardTitle>
          <CardDescription className="text-sm">
            View your plan, usage, and manage billing preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge variant={subscription?.tier === 'pro' ? 'default' : 'secondary'}>
                {planLabel}
              </Badge>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-4 w-4" />
                {planStatus}
              </span>
            </div>
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {nextBillingDate}
            </div>
          </div>

          {subscription ? (
            <UsageIndicator
              counted={subscription.usage.counted}
              baseLimit={subscription.usage.baseLimit}
              baseRemaining={subscription.usage.baseRemaining}
              topupRemaining={subscription.usage.topupRemaining}
              resetAt={subscription.usage.resetAt}
              warning={subscription.isPastDue ? 'PAST_DUE' : null}
            />
          ) : (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Link a payment method to unlock Pro features and detailed usage tracking.
            </div>
          )}

          {subscriptionWarnings.length > 0 && (
            <div className="space-y-3">
              {subscriptionWarnings.map((warning, index) => (
                <Alert key={index} variant={warning.variant ?? 'default'}>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{warning.title}</AlertTitle>
                  <AlertDescription>{warning.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          {subscription?.tier === 'pro' ? (
            <>
              <Button
                onClick={openBillingPortal}
                disabled={billingAction !== null}
              >
                {billingAction === 'portal' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Opening portal...
                  </>
                ) : (
                  <>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage billing
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleCheckout('topup')}
                disabled={billingAction !== null || !subscription.canPurchaseTopup}
              >
                {billingAction === 'topup' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting...
                  </>
                ) : (
                  'Buy Top-Up (+20 credits)'
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={() => handleCheckout('subscription')}
                disabled={billingAction !== null}
              >
                {billingAction === 'subscription' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting...
                  </>
                ) : (
                  'Upgrade to Pro'
                )}
              </Button>
              <Button asChild variant="outline">
                <Link href="/pricing">View pricing</Link>
              </Button>
            </>
          )}
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Profile information</CardTitle>
          <CardDescription className="text-sm">
            Update your personal information and preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={user.email}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button 
            onClick={handleUpdateProfile} 
            disabled={loading || !hasProfileChanges}
            size="default"
            className="min-w-[140px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Change password</CardTitle>
          <CardDescription className="text-sm">
            Update your password to keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button
            onClick={handleUpdatePassword}
            disabled={loading || !newPassword || !confirmPassword}
            size="default"
            className="min-w-[160px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              'Update password'
            )}
          </Button>
        </CardFooter>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">Account statistics</CardTitle>
          <CardDescription className="text-sm">
            Key usage metrics and account milestones.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {statsRows.map((row, index) => (
              <div key={row.label}>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-muted-foreground">{row.label}</span>
                  <span className="text-sm font-semibold">{row.value}</span>
                </div>
                {index < statsRows.length - 1 && (
                  <Separator className="bg-border/50" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
