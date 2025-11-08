'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import { startCheckout, openBillingPortal } from '@/lib/stripe-actions'
import type { SubscriptionStatus, SubscriptionTier } from '@/lib/subscription-manager'
import { toast } from 'sonner'
import { ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PricingContentProps {
  isAuthenticated: boolean
  tier: SubscriptionTier | 'anonymous'
  status: SubscriptionStatus
}

type BillingPeriod = 'monthly' | 'annual'

export default function PricingContent({ isAuthenticated, tier, status }: PricingContentProps) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<'subscription' | 'topup' | 'portal' | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('annual')

  const currentTier: SubscriptionTier | 'anonymous' = tier
  const isPro = currentTier === 'pro'
  const isFreeUser = currentTier === 'free'

  const freeFeatures = [
    '5 videos / month',
    'AI highlight reels',
    'Chat with transcripts',
    'Save notes',
  ]

  const proFeatures = [
    '40 videos / month',
    'Everything from Basic',
    'Export transcripts',
    'Transcript translation',
  ]

  const heroDescription = (() => {
    if (!isAuthenticated) {
      return 'Create a free account to get started, or upgrade when you need more headroom.'
    }
    if (isPro) {
      return 'You’re currently on Pro. Manage billing or adjust your plan below.'
    }
    if (isFreeUser) {
      return 'You’re currently on the Free plan. Upgrade whenever you need more throughput.'
    }
    return 'Select the plan that fits your workflow.'
  })()

  const handleAuthRedirect = () => {
    router.push('/?auth=signup')
  }

  const handleUpgrade = async (period: BillingPeriod) => {
    if (!isAuthenticated) {
      handleAuthRedirect()
      return
    }

    try {
      setPendingAction('subscription')
      await startCheckout(period === 'annual' ? 'subscription_annual' : 'subscription')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout'
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  const handleTopup = async () => {
    if (!isAuthenticated) {
      handleAuthRedirect()
      return
    }

    if (!isPro) {
      toast.info('Top-Up credits are available for Pro members. Upgrade to unlock them!')
      return
    }

    try {
      setPendingAction('topup')
      await startCheckout('topup')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout'
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  const handlePortal = async () => {
    try {
      setPendingAction('portal')
      await openBillingPortal()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open billing portal'
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="space-y-12">
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.5rem]">Plan</h1>
        <p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">{heroDescription}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-border/60 bg-background/80 shadow-sm backdrop-blur">
          <CardHeader className="p-8 pb-6">
            <div className="rounded-[24px] bg-muted/60 p-6 text-left">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Basic</p>
                <h2 className="text-4xl font-semibold">Free</h2>
                <p className="text-xs text-muted-foreground">
                  Try TLDW for free, no credit card required
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-8 py-6">
            <PlanFeaturesList features={freeFeatures} />
          </CardContent>
          <CardFooter className="flex flex-col gap-2 px-8 pb-8 pt-0">
            <Button
              onClick={isAuthenticated ? undefined : handleAuthRedirect}
              disabled={isAuthenticated}
              variant={isFreeUser ? 'secondary' : 'outline'}
              className={cn(
                'w-full rounded-full',
                isAuthenticated && 'cursor-not-allowed opacity-80',
                isFreeUser && 'bg-muted text-muted-foreground'
              )}
            >
              {isAuthenticated ? (isFreeUser ? 'Current plan' : 'Included with Pro') : 'Create free account'}
            </Button>
          </CardFooter>
        </Card>

        <Card className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-transparent bg-gradient-to-br from-primary/10 via-card to-card shadow-xl shadow-primary/20">
          <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
          <CardHeader className="p-8 pb-6">
            <div className="rounded-[24px] bg-background/80 p-6 text-left shadow-sm ring-1 ring-white/60 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-2">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Pro</p>
                    {billingPeriod === 'annual' && (
                      <span className="block text-xs text-muted-foreground line-through">$60</span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-semibold">
                      {billingPeriod === 'annual' ? '$50' : '$5'}
                    </span>
                    <span className="text-base text-muted-foreground">
                      {billingPeriod === 'annual' ? '/ year' : '/ month'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {billingPeriod === 'annual' ? 'Get 2 months free' : 'Flexible monthly billing'}
                  </p>
                </div>
                <BillingToggle value={billingPeriod} onChange={setBillingPeriod} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-8 py-6">
            <PlanFeaturesList
              features={proFeatures}
              footer={
                <li key="topup">
                  <button
                    type="button"
                    onClick={handleTopup}
                    disabled={pendingAction === 'topup'}
                    className={cn(
                      'flex w-full items-center gap-3 text-left text-sm font-medium text-primary transition hover:underline disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  >
                    {pendingAction === 'topup' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing Top-Up...
                      </>
                    ) : (
                      <>
                        <ArrowUpRight className="h-4 w-4" />
                        Need more? $3 for 20 more videos
                      </>
                    )}
                  </button>
                </li>
              }
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-2 px-8 pb-8 pt-0">
            <Button
              onClick={isPro ? handlePortal : () => handleUpgrade(billingPeriod)}
              disabled={pendingAction !== null}
              className="w-full rounded-full"
            >
              {pendingAction === 'subscription' || pendingAction === 'portal' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                isPro ? (status === 'past_due' ? 'Update payment method' : 'Manage billing') : 'Upgrade'
              )}
            </Button>
            {status && isPro && (
              <span className="text-xs text-muted-foreground text-center">
                Current status:{' '}
                <strong className="font-medium capitalize">{formatStatus(status)}</strong>
              </span>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function PlanFeaturesList({ features, footer }: { features: string[]; footer?: ReactNode }) {
  return (
    <ul className="space-y-3 text-sm">
      {features.map((feature) => (
        <li key={feature} className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span>{feature}</span>
        </li>
      ))}
      {footer}
    </ul>
  )
}

function BillingToggle({
  value,
  onChange,
}: {
  value: BillingPeriod
  onChange: (value: BillingPeriod) => void
}) {
  const isAnnual = value === 'annual'

  return (
    <div className="flex items-center gap-3 rounded-full bg-muted px-3 py-1.5">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={cn(
          'text-xs font-medium transition',
          !isAnnual ? 'text-foreground' : 'text-muted-foreground'
        )}
        aria-pressed={!isAnnual}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange(isAnnual ? 'monthly' : 'annual')}
        className={cn(
          'relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isAnnual ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
        aria-label="Toggle annual billing"
        aria-pressed={isAnnual}
      >
        <span className="sr-only">Toggle annual billing</span>
        <span
          className={cn(
            'inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform',
            isAnnual ? 'translate-x-5' : 'translate-x-1'
          )}
        />
      </button>
      <button
        type="button"
        onClick={() => onChange('annual')}
        className={cn(
          'text-xs font-medium transition',
          isAnnual ? 'text-foreground' : 'text-muted-foreground'
        )}
        aria-pressed={isAnnual}
      >
        Annual
      </button>
    </div>
  )
}

function formatStatus(status: SubscriptionStatus | undefined) {
  if (!status) return 'inactive'
  return status.replace('_', ' ')
}
