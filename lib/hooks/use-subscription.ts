import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

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
  const lastVisibleRef = useRef<number>(Date.now());
  const retryCountRef = useRef<number>(0);

  // Track visibility changes to invalidate stale cache
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const timeSinceHidden = Date.now() - lastVisibleRef.current;
        // If tab was hidden for over a minute, invalidate cache
        if (timeSinceHidden > 60_000) {
          subscriptionStatusFetchedAtRef.current = null;
        }
      } else if (document.visibilityState === 'hidden') {
        lastVisibleRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

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
          // Try to refresh the session before giving up
          if (retryCountRef.current < 1) {
            retryCountRef.current += 1;
            try {
              const supabase = createClient();
              const { data: { session } } = await supabase.auth.getSession();
              if (session) {
                // Session refreshed - retry the request
                retryCountRef.current = 0;
                return fetchSubscriptionStatus({ force: true });
              }
            } catch (refreshErr) {
              console.warn('Session refresh failed:', refreshErr);
            }
          }
          retryCountRef.current = 0;
          onAuthRequired?.();
          return null;
        }

        retryCountRef.current = 0;

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
