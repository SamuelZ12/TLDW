'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { startCheckout, openBillingPortal } from '@/lib/stripe-actions'
import type { SubscriptionStatus, SubscriptionTier } from '@/lib/subscription-manager'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Star, Zap } from 'lucide-react'

interface PricingContentProps {
  isAuthenticated: boolean
  tier: SubscriptionTier | 'anonymous'
  status: SubscriptionStatus
}

interface PlanCard {
  title: string
  price: string
  cadence?: string
  badge?: string
  description: string
  features: string[]
  actionLabel: string
}

const freePlan: PlanCard = {
  title: 'Free',
  price: '$0',
  description: 'Start learning with powerful summaries and notes — no credit card required.',
  features: [
    'Analyze 3 videos per rolling 30 days',
    'Save notes, highlights, and transcripts',
    'Access trending summaries and recommendations',
  ],
  actionLabel: 'Create free account',
}

const proPlan: PlanCard = {
  title: 'Pro',
  price: '$5',
  cadence: 'per month',
  badge: 'Most popular',
  description: 'Unlock higher limits, faster processing, and professional reporting tools.',
  features: [
    '40 video analyses every 30 days',
    'Priority queues and faster processing',
    'Export-ready notes & timeline markers',
    'Eligible for Top-Up credits (+20 videos)',
  ],
  actionLabel: 'Upgrade to Pro',
}

const topupPlan: PlanCard = {
  title: 'Top-Up',
  price: '$3',
  description: 'Boost your Pro allowance with on-demand credits that never expire.',
  features: [
    '+20 additional videos instantly',
    'Credits roll over forever',
    'Ideal for research sprints or launch weeks',
  ],
  actionLabel: 'Buy Top-Up',
}

export default function PricingContent({ isAuthenticated, tier, status }: PricingContentProps) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<'subscription' | 'topup' | 'portal' | null>(null)

  const currentTier: SubscriptionTier | 'anonymous' = tier
  const isPro = currentTier === 'pro'
  const isFreeUser = currentTier === 'free'

  const handleAuthRedirect = () => {
    router.push('/?auth=signup')
  }

  const handleUpgrade = async () => {
    if (!isAuthenticated) {
      handleAuthRedirect()
      return
    }

    try {
      setPendingAction('subscription')
      await startCheckout('subscription')
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
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="uppercase tracking-wide">Pricing</Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Plans built for focused learners
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground text-lg">
          Whether you are skimming lectures or deep-diving into research, TLDW keeps you within
          limits while giving you precise, actionable summaries.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <PlanCardComponent
          plan={freePlan}
          accent="border-muted"
          actionDisabled={isAuthenticated && !isFreeUser}
          actionLabel={isAuthenticated ? (isFreeUser ? freePlan.actionLabel : 'Current plan') : freePlan.actionLabel}
          onAction={isAuthenticated ? undefined : handleAuthRedirect}
          badgeIcon={<Zap className="h-4 w-4" />}
        />

        <PlanCardComponent
          plan={proPlan}
          accent="border-primary"
          badgeIcon={<Star className="h-4 w-4" />}
          highlight
          status={status}
          actionLabel={
            isPro ? (status === 'past_due' ? 'Update payment method' : 'Manage billing') : proPlan.actionLabel
          }
          actionDisabled={pendingAction !== null}
          onAction={isPro ? handlePortal : handleUpgrade}
          pending={pendingAction === 'subscription' || pendingAction === 'portal'}
        />

        <PlanCardComponent
          plan={topupPlan}
          accent="border-muted"
          actionLabel={topupPlan.actionLabel}
          actionDisabled={!isPro || pendingAction !== null}
          onAction={handleTopup}
          pending={pendingAction === 'topup'}
          helperText={!isPro ? 'Requires an active Pro subscription' : 'Credits available immediately'}
        />
      </div>

      <div className="rounded-xl border bg-background/40 p-6 sm:p-8 shadow-sm">
        <h2 className="text-xl font-semibold mb-2">Need a tailored plan?</h2>
        <p className="text-muted-foreground max-w-2xl">
          For teams, classrooms, or research groups that need higher limits or custom workflows,
          we offer volume pricing and dedicated onboarding.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="mailto:hello@tldw.us?subject=Pro%20for%20Teams">Contact us</Link>
        </Button>
      </div>
    </div>
  )
}

interface PlanCardComponentProps {
  plan: PlanCard
  accent: string
  badgeIcon?: React.ReactNode
  highlight?: boolean
  actionLabel?: string
  actionDisabled?: boolean
  onAction?: () => void
  pending?: boolean
  helperText?: string
  status?: SubscriptionStatus
}

function PlanCardComponent({
  plan,
  accent,
  badgeIcon,
  highlight = false,
  actionLabel,
  actionDisabled,
  onAction,
  pending = false,
  helperText,
  status,
}: PlanCardComponentProps) {
  return (
    <Card className={highlight ? 'border-primary shadow-lg shadow-primary/10 relative overflow-hidden' : 'relative overflow-hidden'}>
      {plan.badge && (
        <Badge className="absolute right-4 top-4 flex items-center gap-1" variant={highlight ? 'default' : 'secondary'}>
          {badgeIcon}
          {plan.badge}
        </Badge>
      )}
      <CardHeader className="space-y-4 pb-4">
        <CardTitle className="text-2xl">{plan.title}</CardTitle>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold">{plan.price}</span>
          {plan.cadence && <span className="text-muted-foreground">{plan.cadence}</span>}
        </div>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      <Separator className={accent} />
      <CardContent className="space-y-4 py-6">
        <ul className="space-y-3 text-sm">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2">
        <Button
          onClick={onAction}
          disabled={actionDisabled || !onAction}
          className="w-full"
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting...
            </>
          ) : (
            actionLabel ?? plan.actionLabel
          )}
        </Button>
        {helperText && (
          <span className="text-xs text-muted-foreground text-center">{helperText}</span>
        )}
        {status && plan.title === 'Pro' && (
          <span className="text-xs text-muted-foreground text-center">
            Current status: <strong className="font-medium capitalize">{formatStatus(status)}</strong>
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

function formatStatus(status: SubscriptionStatus | undefined) {
  if (!status) return 'inactive'
  return status.replace('_', ' ')
}
