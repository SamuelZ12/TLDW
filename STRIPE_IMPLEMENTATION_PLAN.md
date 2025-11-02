# Stripe Subscription Implementation Plan for TLDW

## Pricing Structure Summary
- **Free Unregistered**: 1 video per 30 days (IP-based tracking)
- **Free Registered**: 3 videos per 30 days (user account tracking)
- **Pro Plan**: $5/month, 40 videos per 30 days (rolling from subscription start)
- **Top-Up**: $3 for +20 videos (Pro users only, credits carry over indefinitely)
- **Cached videos**: Do NOT count toward any limit

## Configuration Decisions
- **Limit Reset**: Rolling 30-day window from subscription start date
- **Cancellation**: Access maintained until billing period ends
- **Top-Up Credits**: Carry over indefinitely (never expire)
- **Top-Up Availability**: Pro users only

---

## Phase 1: Database Schema Changes

### 1.1 Update `profiles` table
Add subscription-related columns:
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS:
  - stripe_customer_id (text, nullable, indexed)
  - subscription_tier (text, default 'free', check in ('free', 'pro'))
  - stripe_subscription_id (text, nullable)
  - subscription_status (text, nullable, check in ('active', 'past_due', 'canceled', 'incomplete', 'trialing'))
  - subscription_current_period_start (timestamp)
  - subscription_current_period_end (timestamp)
  - cancel_at_period_end (boolean, default false)
  - topup_credits (integer, default 0) -- Carry-over Top-Up credits
```

### 1.2 Create new `video_generations` table
Track each video generation for accurate usage counting:
```sql
CREATE TABLE video_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (nullable for anonymous),
  identifier text NOT NULL, -- 'user:{id}' or 'anon:{hash}'
  youtube_id text NOT NULL,
  video_id uuid REFERENCES video_analyses (nullable until created),
  counted_toward_limit boolean DEFAULT true, -- false if cached
  subscription_tier text NOT NULL, -- Tier at time of generation
  created_at timestamp DEFAULT now()
);
CREATE INDEX ON video_generations(user_id, created_at);
CREATE INDEX ON video_generations(identifier, created_at);
```

### 1.3 Create `topup_purchases` table
Track Top-Up purchases separately:
```sql
CREATE TABLE topup_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users,
  stripe_payment_intent_id text NOT NULL,
  credits_purchased integer NOT NULL, -- Usually 20
  amount_paid integer NOT NULL, -- In cents (300)
  created_at timestamp DEFAULT now()
);
CREATE INDEX ON topup_purchases(user_id, created_at);
```

---

## Phase 2: Stripe Setup

### 2.1 Stripe Dashboard Configuration
1. Create Stripe account (or use existing)
2. Create products:
   - **Pro Subscription**: $5/month recurring
   - **Top-Up Credits**: $3 one-time payment
3. Get API keys (test + production):
   - Publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`)
   - Secret key (`STRIPE_SECRET_KEY`)
   - Webhook signing secret (`STRIPE_WEBHOOK_SECRET`)

### 2.2 Install Stripe packages
```bash
npm install stripe @stripe/stripe-js
```

### 2.3 Environment variables
Add to `.env.local`:
```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_... # Pro subscription price ID
STRIPE_TOPUP_PRICE_ID=price_... # Top-Up price ID
```

---

## Phase 3: Backend API Development

### 3.0 Prerequisites
- Ensure all environment variables in Phase 2 are set for the current runtime (Vercel + local dev).
- Add `types/stripe.d.ts` (or extend `env.d.ts`) with Stripe-specific env typings to keep TypeScript strict.
- Decide on Stripe API version (pin to the current date in dashboard) and reuse that version everywhere.

### 3.1 Create Stripe client utility
**File**: `lib/stripe-client.ts`
**Implementation Steps**
- Import `Stripe` from the server SDK and instantiate using `process.env.STRIPE_SECRET_KEY` plus the pinned `apiVersion`.
- Enforce env presence via a helper (e.g., `assertEnv('STRIPE_SECRET_KEY')`) so boot fails fast if misconfigured.
- Memoize the client: reuse the same singleton across hot reloads (`globalThis._stripe` guard) to avoid reinitialization in Next.js app directory.
- Export the configured client as `stripe` for use in API routes and utilities.

**Acceptance Criteria**
- Server routes can `import { stripe }` without recreating the client.
- Missing env variables throw a descriptive error during server start.

### 3.2 Create subscription management utility
**File**: `lib/subscription-manager.ts`
**Implementation Steps**
- Define TypeScript types that mirror subscription columns (`SubscriptionStatus`, `SubscriptionTier`).
- Implement primitives that use the database (Supabase or direct SQL) for atomic updates:
  - `getUserSubscriptionStatus(userId)` returns tier, base usage, top-up balance, and period bounds.
  - `calculateUsageInPeriod(userId, periodStart, periodEnd)` queries `video_generations` excluding `counted_toward_limit = false`.
  - `canGenerateVideo` composes base usage, base limit, and top-up balance, returning a discriminated union explaining the denial reason.
  - `consumeVideoCredit` wraps inserts/updates in a transaction: insert into `video_generations`, decrement `topup_credits` when necessary, and guard against negative balances.
  - Provide `hasTopupCredits`, `consumeTopupCredit`, `addTopupCredits` utilities that are reused by webhook + API routes.
- Expose helpers to map Stripe subscription objects to DB updates (status, period start/end, cancel flag).

**Acceptance Criteria**
- All public functions are unit-testable with dependency injection (e.g., pass a db client).
- Consumption helpers are idempotent and error when called without available credits.

### 3.3 API Route: Create Checkout Session
**File**: `app/api/stripe/create-checkout-session/route.ts`
**Implementation Steps**
- Require authenticated user (NextAuth / Supabase session). Return 401 otherwise.
- Parse body `{ priceType: 'subscription' | 'topup' }` and validate against a Zod schema.
- Fetch the profile row to obtain `stripe_customer_id` and `subscription_tier`. Create a customer via `stripe.customers.create` if absent; persist the ID.
- For `subscription` priceType: build a subscription mode Checkout Session pointing at `process.env.STRIPE_PRO_PRICE_ID`, include `subscription_data` metadata with the Supabase user ID, and set success/cancel URLs to the settings page.
- For `topup` priceType: ensure `subscription_tier === 'pro'`; otherwise return 400. Create a payment mode Checkout Session using the top-up price and attach metadata for fulfillment.
- Return JSON `{ sessionId }` and log key failures for debugging.

**Acceptance Criteria**
- Subscription and top-up flows both redirect to Checkout successfully in test mode.
- Checkout requests fail gracefully for anonymous users or invalid price types.

### 3.4 API Route: Create Portal Session
**File**: `app/api/stripe/create-portal-session/route.ts`
**Implementation Steps**
- Require an authenticated user and a stored `stripe_customer_id`; if missing, create one on the fly.
- Call `stripe.billingPortal.sessions.create` with the customer, setting `return_url` to `/settings`.
- Optionally include `flow_data` so users can cancel or update payment methods without contacting support.
- Respond with `{ url }` for client-side redirect.

**Acceptance Criteria**
- Pro users can reach Stripe's hosted portal and return to TLDW successfully.

### 3.5 API Route: Webhook Handler
**File**: `app/api/webhooks/stripe/route.ts`
**Implementation Steps**
- Ensure the route is marked as `config = { api: { bodyParser: false } }` (or Next 13 equivalent) and read the raw request body for signature verification.
- Construct the event via `stripe.webhooks.constructEvent`, using `STRIPE_WEBHOOK_SECRET`. Reject requests with invalid signatures.
- Implement idempotency: persist processed `event.id` in a `stripe_events` table (or leverage Supabase `idempotency_key`) before mutating state.
- Handle events:
  - `checkout.session.completed`: if `mode === 'subscription'`, update `profiles` with subscription ids/status and set rolling window start/end; if `mode === 'payment'`, increment `topup_credits` and insert into `topup_purchases`.
  - `customer.subscription.updated`: sync status, current period start/end, plan quantity, and `cancel_at_period_end`.
  - `customer.subscription.deleted`: reset tier to `free`, zero out subscription fields, retain remaining top-up credits.
  - `invoice.payment_failed`: set `subscription_status = 'past_due'` and surface metadata for UI warnings.
  - `invoice.payment_succeeded`: restore `subscription_status = 'active'`.
- Return `{ received: true }` after successful processing.

**Acceptance Criteria**
- Replaying the same Stripe event (via CLI) does not double-apply changes.
- Profiles stay in sync after subscription upgrades/downgrades or top-up purchases.

### 3.6 API Route: Get Subscription Status
**File**: `app/api/subscription/status/route.ts`
**Implementation Steps**
- Require authentication; return a specific `403` error shape when unauthenticated so the client can redirect.
- Use the subscription manager to compute current period usage, limits, remaining credits, top-up balance, and `cancel_at_period_end`.
- Include metadata needed by the UI: `nextBillingDate`, `isPastDue`, and whether the user can purchase top-ups.
- Cache the response briefly (e.g., 30s) via Next.js `revalidate` or an in-memory cache to reduce DB load on repeated fetches.

**Acceptance Criteria**
- Frontend consumers receive a consistent response schema with numbers already normalized (no nulls unless truly unknown).
- Endpoint responds within acceptable latency (<150ms p95 in staging).

### 3.7 Backend QA & Instrumentation
**Implementation Steps**
- Write integration tests using Stripe-mock or a custom mocked client covering checkout session creation, webhook handling, and usage consumption.
- Add structured logging (level + event name) around critical flows for debugging in production.
- Set up basic metrics (e.g., Logflare or DataDog counters) for subscription lifecycle events.

**Acceptance Criteria**
- Automated tests cover success and failure paths for all new endpoints.
- Logs surface Stripe event IDs and Supabase user IDs for traceability.


---

## Phase 4: Rate Limiting Logic Updates

### 4.1 Update rate limit configuration
**File**: `lib/rate-limiter.ts`
**Implementation Steps**
- Introduce constants for each plan tier with a 30-day rolling window (in ms) and export them for reuse.
- Ensure anonymous vs authenticated requests use distinct Redis/Prisma buckets (`identifier` vs `userId`).
- Add helper `getPlanLimiter(tier: SubscriptionTier)` returning the appropriate preset to avoid duplicating logic in API routes.

**Acceptance Criteria**
- Rate limiter exposes presets for free anonymous, free registered, and pro tiers.
- Existing consumers of `rateLimiter` continue to work without regression.

### 4.2 Update check-limit API
**File**: `app/api/check-limit/route.ts`
**Implementation Steps**
- Require an identifier (user or hashed IP). For logged-in users, fetch subscription info via the subscription manager.
- For authenticated users: compute usage using `video_generations` within the active period and combine with base limit + `topup_credits`.
- For anonymous users: call the updated limiter with `identifier` and enforce the single video rule.
- Return structured payload `{ canGenerate, reason?, tier, remainingBase, remainingTopup, resetAt }`.
- Log and surface `reason` strings for analytics (`"LIMIT_REACHED"`, `"TOPUP_REQUIRED"`, etc.).

**Acceptance Criteria**
- Endpoint enforces correct limits for all tiers in manual tests.
- Response schema is backward compatible or coordinated with frontend changes.

### 4.3 Update video-analysis API
**File**: `app/api/video-analysis/route.ts`
**Implementation Steps**
- Short-circuit when the requested video is already cached (no credit consumption).
- Otherwise, invoke `canGenerateVideo`; if denied, return 402/429 with actionable message.
- When approved, wrap generation + credit consumption in a transaction: insert into `video_generations`, call downstream transcription, and commit only after success.
- Update the inserted row with the resulting `video_analyses.id` for traceability.
- Emit events/metrics for credit consumption to aid monitoring.

**Acceptance Criteria**
- Users never lose credits when generation fails partway through (transaction rollback).
- Cached videos bypass credit deductions completely.

### 4.4 Create utility for rolling window tracking
**File**: `lib/usage-tracker.ts`
**Implementation Steps**
- Implement `getPeriodBounds(subStart: Date)` that returns `{ start, end }` where end = start + 30 days.
- Provide `getUsageInPeriod({ userId, start, end })` that queries `video_generations` and returns counts per tier + cached breakdown.
- Add `getRemainingCredits({ tier, baseLimit, usage, topupCredits })` returning `{ baseRemaining, topupRemaining, totalRemaining }`.
- Export `formatResetAt(start)` to present reset timestamps in UI copy.

**Acceptance Criteria**
- Shared utility prevents duplicated logic between API routes and UI loaders.
- Functions are covered by unit tests with mocked datasets representing edge cases (period boundary, cached videos, top-up exhaustion).

### 4.5 Rate Limit QA
**Implementation Steps**
- Add regression tests/smoke scripts for anonymous, free, pro, and pro+top-up flows.
- Simulate rapid consecutive requests to ensure limiter enforces rolling windows rather than calendar months.
- Validate that whitelisted unlimited users bypass rate checks.

**Acceptance Criteria**
- Automated or scripted tests catch incorrect limiter configuration before release.
- Monitoring dashboards alert when rate limiting denies >5% of pro requests (signal possible bug).


---

## Phase 5: Frontend UI Components

### 5.1 Pricing Page
**File**: `app/pricing/page.tsx`
**Implementation Steps**
- Pull subscription status via `getServerSession` + the new status API to tailor CTAs.
- Present three cards (Free, Pro, Top-Up) with clear limits/benefits and highlight Pro as primary.
- Wire CTA buttons to call `/api/stripe/create-checkout-session` using mutations; handle loading + error states.
- Include FAQ accordion covering billing cycle, cancellations, and top-up persistence.
- Add SEO metadata (title/description) reflecting the new pricing structure.

**Acceptance Criteria**
- Logged-in users see their current tier labeled on load.
- Buttons surface success/error toasts and disable while awaiting Checkout session.

### 5.2 Settings/Subscription Page
**File**: `app/settings/page.tsx` (or subscription section)
**Implementation Steps**
- Fetch subscription status on the server (RSC) and hydrate client for interactive pieces.
- Show summary cards: current tier badge, usage bar (`used/limit`), top-up credits remaining, next billing date, and payment status (e.g., `past_due`).
- Provide action buttons: Upgrade, Buy Top-Up, Manage Subscription (portal), Cancel (redirect to portal). Disable actions while requests are pending.
- Display billing history using invoices returned from Stripe portal session (if available) or link to portal.
- Surface alerts when `cancel_at_period_end` or `past_due` is true.

**Acceptance Criteria**
- Page renders without client-side waterfall (data ready on first paint).
- All actions trigger the correct API routes and show confirmation UX.

### 5.3 Rate Limit & Error Messaging
**File**: `app/analyze/[videoId]/page.tsx`
**Implementation Steps**
- Consume the new `canGenerate` payload and branch UI for each denial reason (free limit reached, pro limit reached, top-up required, past due).
- Provide contextual CTAs matching the reason (upgrade link, buy top-up, manage billing).
- Ensure cached video view states bypass the warning entirely.

**Acceptance Criteria**
- Users receive clear next steps rather than generic 429 errors.
- Copy is internationalization-ready if the project uses i18n.

### 5.4 Usage Indicator Component
**File**: `components/usage-indicator.tsx`
**Implementation Steps**
- Build a reusable component that accepts `{ baseRemaining, baseLimit, topupRemaining }`.
- Render a progress bar showing base usage and a pill displaying bonus credits (e.g., `+15`).
- Allow optional compact mode for navbar vs. detailed mode for settings dropdown.
- Fetch data client-side via SWR/react-query or pass via props from server components.

**Acceptance Criteria**
- Component updates reactively after completing a video generation (optimistic update or revalidate).
- Accessible: progress bar has aria labels, text color meets contrast guidelines.

### 5.5 Auth & Onboarding Touchpoints
**Implementation Steps**
- In `components/auth-modal.tsx`, update post-signup copy to highlight the free quota and upsell Pro.
- Add deep link to pricing page and include top-up explanation in onboarding emails if applicable.
- Update marketing surfaces (navbar, footer) to point to the new pricing page.

**Acceptance Criteria**
- New users immediately understand they have 3 free videos and can upgrade/top-up anytime.
- No broken links between auth flows and pricing/settings pages.

### 5.6 Frontend QA
**Implementation Steps**
- Snapshot test key components (pricing cards, usage indicator).
- Run manual UAT covering upgrade, top-up purchase, cancellation, and past-due banner scenarios.
- Verify mobile responsiveness for pricing + settings screens.

**Acceptance Criteria**
- QA sign-off that flows function on desktop and mobile in Chrome/Safari/Firefox.
- No console errors or hydration warnings in staging.


---

## Phase 6: Webhook Endpoint Setup

### 6.1 Configure Stripe Webhook
**Implementation Steps**
- In the Stripe Dashboard (test + production), create endpoint `https://tldw.us/api/webhooks/stripe`.
- Subscribe to required events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`, and optionally `customer.subscription.trial_will_end` for reminders.
- Store the signing secret in environment variables (`STRIPE_WEBHOOK_SECRET`) for each environment; rotate if compromised.
- Document the endpoint + secret location in runbook.

**Acceptance Criteria**
- Stripe dashboard shows the webhook as enabled with the correct event list.
- Secrets are present in deployment environment variables (Vercel/Render) and in 1Password/Secrets Manager.

### 6.2 Local Webhook Development
**Implementation Steps**
- Install Stripe CLI locally and authenticate via `stripe login`.
- Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` while developing; capture logs for debugging.
- Seed test data by triggering relevant events: `stripe trigger checkout.session.completed`, `stripe trigger invoice.payment_failed`, etc.
- Verify the application logs processed events and mutated the database as expected.

**Acceptance Criteria**
- Developers can reproduce webhook flows locally without deploying.
- CLI output shows `200` responses with `{ received: true }`.

### 6.3 Monitoring & Alerting
**Implementation Steps**
- Enable Stripe webhook alert emails/slack notifications for failed deliveries.
- Add health checks/cron to poll Stripe for recent failed events and log them.
- Ensure application logs include event IDs so support can reconcile issues.

**Acceptance Criteria**
- Any webhook delivery failure triggers a human-visible alert within minutes.
- Support runbook documents remediation steps (replay via Stripe dashboard or CLI).


---

## Phase 7: Migration & Data Handling

### 7.1 Existing users migration
**Implementation Steps**
- Write a SQL migration or Supabase script that sets `subscription_tier = 'free'` for any `NULL` values and initializes `subscription_status = 'active'`.
- Backfill `subscription_current_period_start` with (a) existing subscription created timestamp if present, else (b) `NOW()`.
- Set `subscription_current_period_end = subscription_current_period_start + interval '30 days'`.
- Preserve existing whitelisted unlimited accounts by maintaining `UNLIMITED_VIDEO_USERS` env var or a dedicated table.
- Create a rollback script that restores original values in case deployment fails.

**Acceptance Criteria**
- After migration, all profiles have non-null tier/status fields.
- Unlimited users remain exempt from limits.

### 7.2 Historical video generation tracking
**Implementation Steps**
- Write a one-time script to copy rows from legacy tables (e.g., `user_videos`) into `video_generations`, mapping user IDs, YouTube IDs, and timestamps.
- Set `counted_toward_limit = false` for historical data so usage starts fresh.
- For anonymous history, derive the identifier using the same hashing logic used today.
- Record the script execution timestamp and keep it idempotent (skip inserts if the row already exists).

**Acceptance Criteria**
- Historical data appears in `video_generations` for audit purposes without affecting quotas.
- Script can be rerun safely without duplicating records.

### 7.3 Data Validation
**Implementation Steps**
- Run SQL queries comparing counts before/after migration to ensure no data loss.
- Spot-check a sample of users (free, pro, unlimited) to confirm expected tier + balances.
- Add monitoring dashboard tracking `video_generations` growth daily.

**Acceptance Criteria**
- Validation checklist signed off before moving to production deployment.
- Metrics confirm new generations are being recorded post-migration.


---

## Phase 8: Testing Checklist

### 8.1 Functional Scenarios
- [ ] Anonymous user limited to 1 video per rolling 30 days (verify repeat request returns informative error).
- [ ] Free registered user limited to 3 videos; 4th request blocked with upgrade CTA.
- [ ] Cached video replay does not decrement usage across tiers.
- [ ] Pro user allowed up to 40 videos and usage resets correctly after period end.
- [ ] Top-Up credits increase allowance immediately after successful payment.
- [ ] Pro user cancels subscription: retains access until `subscription_current_period_end`, then downgrades.
- [ ] Past-due invoices set status to `past_due` and UI shows update payment banner.
- [ ] Stripe webhook retries are idempotent (trigger same event twice).

### 8.2 Automated Tests
- [ ] Unit tests for subscription manager utilities (usage counts, credit consumption).
- [ ] Integration tests for checkout, webhook, and subscription status routes (mocked Stripe).
- [ ] End-to-end Playwright/Cypress flow: upgrade, generate videos, buy top-up, cancel.
- [ ] Regression tests covering anonymous rate limiting and unlimited-user bypass.

### 8.3 Security & Compliance
- [ ] Webhook signature validation rejects tampered payloads.
- [ ] CSRF protection enabled on checkout/portal endpoints (POST only, require session).
- [ ] RBAC/authorization checks ensure users only mutate their own subscriptions.
- [ ] Sensitive logs (Stripe IDs, emails) are redacted according to privacy policy.

### 8.4 Performance & Reliability
- [ ] Load test subscription status endpoint (100 req/min) to confirm caching effectiveness.
- [ ] Monitor queue/worker throughput if video generation is async; ensure credit consumption scales.
- [ ] Confirm rate limiter storage (Redis/Supabase) handles burst traffic without degradation.

### 8.5 UAT & Sign-off
- [ ] Product review of pricing/settings UI across desktop + mobile.
- [ ] Support/customer success run through billing flows to prepare help docs.
- [ ] Document known edge cases and add them to troubleshooting guide.


---

## Phase 9: Deployment Steps

### 9.1 Pre-deployment (Staging)
- Run database migrations against staging (use `supabase db push` or Prisma migrate) and capture migration IDs.
- Deploy backend/frontend changes to staging environment and verify environment variables are present.
- Configure Stripe test webhook endpoint pointing at staging deployment and confirm successful handshake.
- Execute end-to-end regression checklist (Phase 8) in staging using Stripe test cards.
- Document any manual configuration (e.g., feature flags) in deployment runbook.

### 9.2 Production Readiness Checklist
- Collect approvals from product/engineering/legal for pricing go-live.
- Toggle feature flag/kill switch ready for gradual rollout (e.g., enable for internal users first).
- Prepare customer support macros/FAQ updates.
- Back up production database (snapshot) prior to running migrations.

### 9.3 Production Deployment
- Run migrations in production during a low-traffic window; monitor for errors.
- Deploy application with production Stripe keys and verify env vars.
- Create/verify Stripe production products + prices; ensure IDs match env configuration.
- Configure production webhook endpoint and run a live test checkout using Stripe test clock or $0 coupon.
- Enable feature flag gradually (internal → beta users → 100%).

### 9.4 Post-deployment Monitoring
- Monitor Stripe dashboard for failed webhooks and payment failures during first 48 hours.
- Track key metrics: conversions (free → pro), top-up purchase rate, churn, MRR uplift.
- Set up alerts in observability stack (Datadog/Sentry) for webhook processing errors, checkout API failures, and rate-limit anomalies.
- Schedule a post-launch review after one week to document learnings.


---

## Estimated Implementation Time

- **Phase 1** (Database): 2-3 hours
- **Phase 2** (Stripe Setup): 1 hour
- **Phase 3** (Backend APIs): 6-8 hours
- **Phase 4** (Rate Limiting): 4-5 hours
- **Phase 5** (Frontend UI): 6-8 hours
- **Phase 6** (Webhooks): 2-3 hours
- **Phase 7** (Migration): 2 hours
- **Phase 8** (Testing): 4-6 hours
- **Phase 9** (Deployment): 2-3 hours

**Total**: ~30-40 hours of development time

---

## Key Technical Considerations

1. **Rolling 30-day windows**: Each user has unique period based on subscription start date
2. **Top-Up credit persistence**: Store as separate column, only decrement when base limit exhausted
3. **Cached video handling**: Check cache BEFORE consuming credits
4. **Webhook idempotency**: Use Stripe event IDs to prevent duplicate processing
5. **Race conditions**: Use database transactions when consuming credits
6. **Subscription status sync**: Webhook is source of truth, not Stripe API polling
7. **Failed payment handling**: Show banner to update payment method, maintain access during grace period
8. **Anonymous user tracking**: Continue using IP-based hashing for unregistered users

---

## Revenue Projection (Example)

Assuming 10,000 monthly active users:
- 70% anonymous (7,000 users) → $0
- 20% free registered (2,000 users) → $0
- 8% Pro subscribers (800 users) → $4,000/month
- 2% Pro with Top-Ups (200 users, avg 2 top-ups/year) → $100/month

**Total**: ~$4,100/month recurring revenue

---

## Implementation Order

For efficient development, implement in this order:

1. **Database migrations** (Phase 1) - Foundation for everything
2. **Stripe setup** (Phase 2) - Get keys and configure dashboard
3. **Backend utilities** (Phase 3.1, 3.2) - Core business logic
4. **API routes** (Phase 3.3-3.6) - Stripe integration
5. **Rate limiting updates** (Phase 4) - Connect to subscription system
6. **Frontend components** (Phase 5) - User-facing features
7. **Testing** (Phase 8) - Verify everything works
8. **Webhook setup** (Phase 6) - Production readiness
9. **Migration scripts** (Phase 7) - Handle existing users
10. **Deployment** (Phase 9) - Go live

This plan provides a complete roadmap from database design through deployment and monitoring.
