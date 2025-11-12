import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';

type SubscriptionStatusState =
  | 'active'
  | 'trialing'
  | 'canceled'
  | 'past_due'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | null;

export interface SubscriptionStatusResponse {
  tier: 'free' | 'pro';
  status: SubscriptionStatusState;
  stripeCustomerId?: string | null;
  cancelAtPeriodEnd?: boolean;
  isPastDue?: boolean;
  canPurchaseTopup?: boolean;
  nextBillingDate?: string | null;
  willConsumeTopup?: boolean;
  usage: {
    counted: number;
    cached: number;
    baseLimit: number;
    baseRemaining: number;
    topupCredits: number;
    topupRemaining: number;
    totalRemaining: number;
    resetAt: string;
  };
}

export function isProSubscriptionActive(status: SubscriptionStatusResponse | null): boolean {
  if (!status) {
    return false;
  }
  if (status.tier !== 'pro') {
    return false;
  }
  return status.status === 'active' || status.status === 'trialing' || status.status === 'past_due';
}

interface UseSubscriptionOptions {
  user: any;
  onAuthRequired?: () => void;
}

export function useSubscription({ user, onAuthRequired }: UseSubscriptionOptions) {
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatusResponse | null>(null);
  const subscriptionStatusFetchedAtRef = useRef<number | null>(null);

  const fetchSubscriptionStatus = useCallback(
    async (options?: { force?: boolean }): Promise<SubscriptionStatusResponse | null> => {
      if (!user) {
        return null;
      }

      const lastFetchedAt = subscriptionStatusFetchedAtRef.current;
      if (
        !options?.force &&
        subscriptionStatus &&
        lastFetchedAt &&
        Date.now() - lastFetchedAt < 60_000
      ) {
        return subscriptionStatus;
      }

      setIsCheckingSubscription(true);
      try {
        const response = await fetch('/api/subscription/status', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
        });

        if (response.status === 401) {
          onAuthRequired?.();
          return null;
        }

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          const message =
            typeof (errorPayload as { error?: string }).error === 'string'
              ? (errorPayload as { error?: string }).error!
              : 'Failed to check subscription status. Please try again.';
          toast.error(message);
          return null;
        }

        const data: SubscriptionStatusResponse = await response.json();
        setSubscriptionStatus(data);
        subscriptionStatusFetchedAtRef.current = Date.now();
        return data;
      } catch (error) {
        console.error('Failed to fetch subscription status:', error);
        toast.error('Unable to check your subscription right now.');
        return null;
      } finally {
        setIsCheckingSubscription(false);
      }
    },
    [user, subscriptionStatus, onAuthRequired]
  );

  useEffect(() => {
    subscriptionStatusFetchedAtRef.current = null;
    setSubscriptionStatus(null);
  }, [user]);

  return {
    subscriptionStatus,
    isCheckingSubscription,
    fetchSubscriptionStatus,
  };
}
