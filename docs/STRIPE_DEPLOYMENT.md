# Stripe Deployment Checklist

## Pre-Deployment

1. **Migrations**
   - Apply `supabase/migrations/20251031120000_phase1_stripe_schema.sql` (if not yet applied).
   - Apply `supabase/migrations/20251101120000_phase4_backend_updates.sql`.
   - Confirm new RPCs (`increment_topup_credits`, `consume_topup_credit`, `get_usage_breakdown`) exist.

2. **Environment Variables**
   | Key | Description |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | Server-side Stripe secret (per environment) |
   | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Publishable key for checkout |
   | `STRIPE_WEBHOOK_SECRET` | Signing secret for `https://tldw.us/api/webhooks/stripe` |
   | `STRIPE_PRO_PRICE_ID` | Recurring price ID for Pro plan |
   | `STRIPE_TOPUP_PRICE_ID` | One-time price ID for Top-Up |
   | `SUPABASE_SERVICE_ROLE_KEY` | Required for webhook service client |

3. **Stripe Dashboard**
   - Ensure products/prices match environment variables.
   - Verify webhook endpoint subscriptions: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`.
   - Enable email alerts for failed webhooks.

## Deployment Steps

1. Put the app into maintenance (optional for staging)
2. Deploy code (`next build && next deploy`) or via CI workflow
3. Run migrations against the target Supabase project
4. `stripe login` and `stripe listen --forward-to https://<env>/api/webhooks/stripe` to confirm handshake
5. Simulate events with `stripe trigger checkout.session.completed`

## Post-Deployment Monitoring

- Review `/api/check-limit` and `/api/subscription/status` logs for new schema usage.
- Monitor Supabase tables:
  - `profiles.subscription_status`
  - `video_generations`
  - `topup_purchases`
  - `stripe_events`
- Set up dashboards for rate-limit denials vs. successes (expected ratio <5%).
- Schedule quarterly rotation of `STRIPE_WEBHOOK_SECRET`.

## Rollback Plan

1. Re-deploy previous commit.
2. Remove `stripe_events` lock entries if replaying webhooks.
3. Execute rollback SQL to drop new RPC functions if necessary.
4. Communicate to support about restored behavior (limits revert to legacy values).
