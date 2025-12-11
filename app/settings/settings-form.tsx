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
import { Switch } from '@/components/ui/switch'
import { Loader2, AlertCircle, CreditCard, Sparkles, Mail } from 'lucide-react'
import { toast } from 'sonner'
import type { User } from '@supabase/supabase-js'
import { csrfFetch, getCSRFToken } from '@/lib/csrf-client'
import { cn } from '@/lib/utils'

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

interface SubscriptionStatusResponse {
  tier: SubscriptionTier
  status: SubscriptionStatus
  stripeCustomerId: string | null
  cancelAtPeriodEnd: boolean
  isPastDue: boolean
  canPurchaseTopup: boolean
  nextBillingDate: string | null
  period?: {
    start: string | null
    end: string | null
  } | null
  usage?: {
    counted: number
    cached: number
    baseLimit: number
    baseRemaining: number
    topupCredits: number
    topupRemaining: number
    totalRemaining: number
    resetAt: string
  } | null
  willConsumeTopup: boolean
}

function mapToSubscriptionSummary(payload: SubscriptionStatusResponse): SubscriptionSummary {
  return {
    tier: payload.tier,
    status: payload.status,
    stripeCustomerId: payload.stripeCustomerId,
    cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
    isPastDue: payload.isPastDue,
    canPurchaseTopup: payload.canPurchaseTopup,
    nextBillingDate: payload.nextBillingDate,
    periodStart: payload.period?.start ?? '',
    periodEnd: payload.period?.end ?? '',
    usage: {
      counted: payload.usage?.counted ?? 0,
      cached: payload.usage?.cached ?? 0,
      baseLimit: payload.usage?.baseLimit ?? 0,
      baseRemaining: payload.usage?.baseRemaining ?? 0,
      topupCredits: payload.usage?.topupCredits ?? 0,
      topupRemaining: payload.usage?.topupRemaining ?? 0,
      totalRemaining: payload.usage?.totalRemaining ?? 0,
      resetAt: payload.usage?.resetAt ?? '',
    },
    willConsumeTopup: payload.willConsumeTopup,
  }
}

interface SettingsFormProps {
  user: User
  profile: Profile | null
  videoCount: number
  subscription: SubscriptionSummary | null
}

function formatCancellationDate(periodEnd: string | null | undefined): string | null {
  if (!periodEnd) {
    return null
  }

  const cancellationDate = new Date(periodEnd)

  if (Number.isNaN(cancellationDate.valueOf())) {
    return null
  }

  return cancellationDate.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatStatus(subscription: SubscriptionSummary | null): string {
  if (!subscription) {
    return 'No subscription'
  }

  const { status, cancelAtPeriodEnd, periodEnd, nextBillingDate } = subscription

  if (cancelAtPeriodEnd) {
    const cancellationCopy = formatCancellationDate(nextBillingDate ?? periodEnd)
    return cancellationCopy ? `Cancels on ${cancellationCopy}` : 'Scheduled to cancel'
  }

  if (!status) {
    return 'No subscription'
  }

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

export default function SettingsForm({ user, profile, videoCount, subscription }: SettingsFormProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [loading, setLoading] = useState(false)
  const [billingAction, setBillingAction] = useState<'subscription' | 'topup' | 'portal' | null>(null)
  const [pendingSubscription, setPendingSubscription] = useState<SubscriptionSummary | null>(null)

  // Email preferences state
  const [marketingEmailsEnabled, setMarketingEmailsEnabled] = useState(true)
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(true)

  const currentSubscription = pendingSubscription ?? subscription

  // Pre-fetch CSRF token in background for faster checkout (PERFORMANCE OPTIMIZATION)
  // This saves ~100-200ms on first Stripe action by caching the token before user clicks
  useEffect(() => {
    getCSRFToken().catch((error) => {
      console.error('Failed to pre-fetch CSRF token:', error)
    })
  }, [])

  // Fetch email preferences on mount
  useEffect(() => {
    const fetchEmailPreferences = async () => {
      try {
        const response = await fetch('/api/email/preferences')
        if (response.ok) {
          const data = await response.json()
          setMarketingEmailsEnabled(data.marketing_emails_enabled ?? true)
        }
      } catch (error) {
        console.error('Error fetching email preferences:', error)
      } finally {
        setEmailPrefsLoading(false)
      }
    }

    fetchEmailPreferences()
  }, [])

  useEffect(() => {
    if (subscription?.tier === 'pro') {
      setPendingSubscription(null)
    }
  }, [subscription?.tier])

  // Poll for subscription updates after Stripe checkout
  useEffect(() => {
    const sessionId = searchParams.get('session_id')

    if (!sessionId) return

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

    const fetchSubscriptionStatus = async (): Promise<SubscriptionSummary | null> => {
      try {
        const response = await fetch('/api/subscription/status', {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
          },
        })

        if (!response.ok) return null

        const payload: SubscriptionStatusResponse = await response.json()
        return mapToSubscriptionSummary(payload)
      } catch (error) {
        console.error('Error fetching subscription status:', error)
        return null
      }
    }

    const syncSubscriptionSnapshot = async (summary?: SubscriptionSummary | null) => {
      const nextSummary = summary ?? await fetchSubscriptionStatus()

      if (nextSummary?.tier === 'pro') {
        setPendingSubscription(nextSummary)
      }

      return nextSummary ?? null
    }

    const handleActivation = (nextSummary?: SubscriptionSummary | null) => {
      cleanupProcessing()
      if (!hasWelcomed) {
        toast.success('Welcome to Pro! Your subscription is now active.')
        hasWelcomed = true
      }
      void syncSubscriptionSnapshot(nextSummary)
      router.refresh()
      window.history.replaceState({}, '', '/settings')
    }

    const handleTopupSuccess = (data: {
      creditsAdded?: number
      totalCredits?: number | null
      alreadyApplied?: boolean
      updated?: boolean
    }) => {
      cleanupProcessing()

      if (data.alreadyApplied) {
        toast.success('Top-Up credits already applied to your account.')
      } else if (data.updated && (data.creditsAdded ?? 0) > 0) {
        const totalCopy =
          typeof data.totalCredits === 'number'
            ? `You now have ${data.totalCredits} top-up credits available.`
            : 'Your credits are ready to use.'

        toast.success(
          `Added ${data.creditsAdded} Top-Up credits! ${totalCopy}`.trim()
        )
      } else {
        toast.success('Top-Up purchase recorded. Your credits will reflect shortly.')
      }

      void syncSubscriptionSnapshot()
      router.refresh()
      window.history.replaceState({}, '', '/settings')
    }

    const confirmCheckout = async (): Promise<'handled' | 'subscription_pending'> => {
      showProcessingToast()
      try {
        const response = await csrfFetch.post('/api/stripe/confirm-checkout', { sessionId })

        if (!response.ok) {
          return 'subscription_pending'
        }

        const data = await response.json()

        if (data.type === 'topup') {
          handleTopupSuccess(data)
          return 'handled'
        }

        if (data.type === 'subscription' || !data.type) {
          if (data.updated && data.tier === 'pro') {
            handleActivation()
            return 'handled'
          }

          return 'subscription_pending'
        }
      } catch (error) {
        console.error('Error confirming Stripe checkout:', error)
      }

      return 'subscription_pending'
    }

    const pollForSubscription = async () => {
      const summary = await fetchSubscriptionStatus()

      if (summary?.tier === 'pro') {
        handleActivation(summary)
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
      const result = await confirmCheckout()

      if (result === 'subscription_pending') {
        if (subscription?.tier === 'pro') {
          cleanupProcessing()
          window.history.replaceState({}, '', '/settings')
        } else {
          startPolling()
        }
      }
    })()

    return () => {
      cleanupProcessing()
    }
  }, [searchParams, subscription?.tier, router])

  const hasProfileChanges = useMemo(() => {
    return fullName !== (profile?.full_name || '')
  }, [fullName, profile?.full_name])

  const planLabel = currentSubscription?.tier === 'pro' ? 'Pro Plan' : 'Free Plan'
  const planStatus = formatStatus(currentSubscription)
  const isCancellationScheduled = Boolean(currentSubscription?.cancelAtPeriodEnd)
  const isPastDue = Boolean(currentSubscription?.isPastDue)
  const StatusIcon = isCancellationScheduled ? AlertCircle : isPastDue ? AlertCircle : Sparkles

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

  const handleEmailPreferenceChange = async (enabled: boolean) => {
    const previousValue = marketingEmailsEnabled
    setMarketingEmailsEnabled(enabled)

    try {
      const response = await fetch('/api/email/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketing_emails_enabled: enabled,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update email preferences')
      }

      const data = await response.json()
      toast.success(data.message || 'Email preferences updated successfully')
    } catch (error) {
      // Revert on error
      setMarketingEmailsEnabled(previousValue)
      const message = error instanceof Error ? error.message : 'Failed to update email preferences'
      toast.error(message)
    }
  }

  const subscriptionWarnings = useMemo(() => {
    if (!currentSubscription) return []
    const warnings: Array<{ title: string; message: string; variant?: 'default' | 'destructive' }> = []

    if (currentSubscription.isPastDue) {
      warnings.push({
        title: 'Payment required',
        message: 'Your payment method failed. Update billing details to restore full access.',
        variant: 'destructive',
      })
    }

    if (currentSubscription.willConsumeTopup) {
      warnings.push({
        title: 'Top-Up credits in use',
        message: 'The next video generation will consume Top-Up credits.',
      })
    }

    return warnings
  }, [currentSubscription])

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

    return stats
  }, [profile?.created_at, user.created_at, videoCount])

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
          <div className="flex items-center gap-3">
            <Badge variant={currentSubscription?.tier === 'pro' ? 'default' : 'secondary'}>
              {planLabel}
            </Badge>
            <span
              className={cn(
                'text-sm flex items-center gap-1',
                isPastDue ? 'text-amber-600 dark:text-amber-500' :
                isCancellationScheduled ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <StatusIcon className="h-4 w-4" />
              {planStatus}
            </span>
          </div>

          {currentSubscription ? (
            <UsageIndicator
              counted={currentSubscription.usage.counted}
              baseLimit={currentSubscription.usage.baseLimit}
              baseRemaining={currentSubscription.usage.baseRemaining}
              topupRemaining={currentSubscription.usage.topupRemaining}
              resetAt={currentSubscription.usage.resetAt}
              warning={currentSubscription.isPastDue ? 'PAST_DUE' : null}
            />
          ) : (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Usage tracking will appear here once your account is fully set up.
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
          {currentSubscription?.tier === 'pro' ? (
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
                disabled={billingAction !== null || !currentSubscription?.canPurchaseTopup}
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
          <CardTitle className="text-xl">Email preferences</CardTitle>
          <CardDescription className="text-sm">
            Manage your email communication preferences.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between space-x-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="marketing-emails" className="text-base font-medium">
                  Product updates
                </Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Receive monthly emails about new features, improvements, and product announcements.
              </p>
            </div>
            <Switch
              id="marketing-emails"
              checked={marketingEmailsEnabled}
              onCheckedChange={handleEmailPreferenceChange}
              disabled={emailPrefsLoading}
            />
          </div>
        </CardContent>
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
