'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
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
    '100 videos / month',
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
      return 'You’re currently on a free plan. Select any of the plans that fits your needs.'
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
      const priceType = period === 'annual' ? 'subscription_annual' : 'subscription'
      console.log('Starting checkout with:', { period, priceType })
      await startCheckout(priceType)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start checkout'
      toast.error(message)
      console.error('Checkout error:', error)
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

      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-11 md:grid-cols-2">
        <Card className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[32px] border border-border/60 bg-background/80 shadow-sm backdrop-blur">
          <CardHeader className="px-6 py-4">
            <div className="rounded-[24px] bg-muted/60 p-6 text-left">
              <div className="space-y-4">
                <p className="text-sm font-medium text-muted-foreground mb-12">Basic</p>
                <h2 className="text-4xl font-semibold">Free</h2>
                <p className="text-xs text-muted-foreground">
                  Try TLDW for free, no card required
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 px-10 py-4">
            <PlanFeaturesList
              features={freeFeatures}
              icons={[
                '/Video_On_Video.svg',
                '/enhance.svg',
                '/Pen_On_Doc.svg',
                '/Select_Text.svg',
              ]}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-2 px-6 py-4">
            <Button
              onClick={isAuthenticated ? undefined : handleAuthRedirect}
              disabled={isAuthenticated}
              variant={isFreeUser ? 'secondary' : 'outline'}
              size="lg"
              className={cn(
                'w-full rounded-full h-14',
                isAuthenticated && 'cursor-not-allowed opacity-80',
                isFreeUser && 'bg-muted text-muted-foreground'
              )}
            >
              {isAuthenticated ? (isFreeUser ? 'Current plan' : 'Included with Pro') : 'Create free account'}
            </Button>
          </CardFooter>
        </Card>

        <Card className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[32px] border border-transparent bg-white shadow-xl shadow-primary/20">
          <CardHeader className="px-6 py-4">
            <div className="w-full min-w-0 rounded-[24px] bg-[linear-gradient(to_bottom_right,rgba(233,211,250,0.3),rgba(203,252,255,0.3),rgba(203,227,255,0.3))] p-6 text-left shadow-sm ring-1 ring-white/60 backdrop-blur-sm">
              <div className="flex w-full items-start justify-between gap-6">
                <div className="space-y-4 min-w-0 flex-1">
                  <p className="text-sm font-medium text-muted-foreground mb-12">Pro</p>
                  <div className="flex items-baseline gap-2 whitespace-nowrap">
                    {billingPeriod === 'annual' && (
                      <span className="text-4xl font-semibold text-muted-foreground line-through">
                        $10
                      </span>
                    )}
                    <span className="text-4xl font-semibold">
                      {billingPeriod === 'annual' ? '$8.33' : '$10'}
                    </span>
                    <span className="text-base text-muted-foreground">
                      / month
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {billingPeriod === 'annual' ? 'Billed annually, get 2 months free' : 'Cancel anytime'}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <BillingToggle value={billingPeriod} onChange={setBillingPeriod} />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 px-10 py-4">
            <PlanFeaturesList
              features={proFeatures}
              icons={[
                '/Video_On_Video.svg',
                '/Creator_Rewards.svg',
                '/Arrow_In_Right.svg',
                '/Languages.svg',
              ]}
              footer={
                <li key="topup">
                  <button
                    type="button"
                    onClick={handleTopup}
                    disabled={pendingAction === 'topup'}
                    className={cn(
                      'flex w-full items-center gap-3 text-left text-sm font-medium text-[#007AFF] transition hover:underline disabled:cursor-not-allowed disabled:opacity-50'
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
          <CardFooter className="flex flex-col gap-2 px-6 py-4">
            <Button
              onClick={isPro ? handlePortal : () => handleUpgrade(billingPeriod)}
              disabled={pendingAction !== null}
              size="lg"
              className="w-full rounded-full h-14"
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
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function PlanFeaturesList({
  features,
  icons,
  footer
}: {
  features: string[]
  icons?: (string | typeof ArrowUpRight)[]
  footer?: ReactNode
}) {
  return (
    <ul className="space-y-3 text-sm">
      {features.map((feature, index) => {
        const icon = icons?.[index]
        return (
          <li key={feature} className="flex items-center gap-3">
            {icon ? (
              typeof icon === 'string' ? (
                <Image
                  src={icon}
                  alt=""
                  width={16}
                  height={16}
                  className="h-4 w-4"
                />
              ) : (
                <ArrowUpRight className="h-4 w-4 text-primary" />
              )
            ) : (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            )}
            <span>{feature}</span>
          </li>
        )
      })}
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
    <div className="flex items-center gap-3 rounded-full bg-transparent px-3 py-1.5">
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
      <button
        type="button"
        onClick={() => onChange(isAnnual ? 'monthly' : 'annual')}
        className={cn(
          'relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isAnnual ? 'bg-[#007AFF]' : 'bg-muted-foreground/30'
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
    </div>
  )
}

function formatStatus(status: SubscriptionStatus | undefined) {
  if (!status) return 'inactive'
  return status.replace('_', ' ')
}
