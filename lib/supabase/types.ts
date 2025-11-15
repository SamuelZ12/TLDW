export type SubscriptionTier = 'free' | 'pro';

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing'
  | null;

export interface ProfilesRow {
  id: string;
  email: string | null;
  full_name: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_tier: SubscriptionTier | null;
  subscription_status: SubscriptionStatus;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  topic_generation_mode: 'smart' | 'fast' | null;
  topup_credits: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export type ProfilesInsert = Partial<ProfilesRow>;
export type ProfilesUpdate = ProfilesInsert;
