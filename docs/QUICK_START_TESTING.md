# Quick Start: Testing Stripe Implementation

This guide helps you quickly set up and test the Stripe subscription implementation.

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] Node.js installed (v18 or higher)
- [ ] Stripe account with test mode access
- [ ] Supabase project created
- [ ] Environment variables configured in `.env.local`

## Option 1: Using Supabase Dashboard (Recommended if CLI not installed)

### Step 1: Apply Migrations via Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Apply migrations in order:

```sql
-- Copy and paste each file content in order:
-- 1. supabase/migrations/20251031120000_phase1_stripe_schema.sql
-- 2. supabase/migrations/20251101120000_phase4_backend_updates.sql
-- 3. supabase/migrations/20251101120001_add_audit_and_rate_limit_tables.sql
-- 4. supabase/migrations/20251101120002_atomic_credit_consumption.sql
-- 5. supabase/migrations/20251101120003_backfill_existing_users.sql
```

4. After each migration, click "Run" and verify success

### Step 2: Verify Migrations

Run this verification query in SQL Editor:

```sql
-- Check all required tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles', 'video_analyses', 'video_generations',
    'topup_purchases', 'stripe_events', 'audit_logs', 'rate_limits'
  )
ORDER BY table_name;

-- Expected: All 7 tables listed

-- Check RPC functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'consume_video_credit_atomically',
    'check_video_generation_allowed',
    'consume_topup_credit',
    'increment_topup_credits',
    'get_usage_breakdown'
  )
ORDER BY routine_name;

-- Expected: All 5 functions listed
```

## Option 2: Using Supabase CLI

### Step 1: Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# npm
npm install -g supabase

# Or download from: https://github.com/supabase/cli/releases
```

### Step 2: Link to Your Project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

### Step 3: Apply Migrations

```bash
supabase db push
```

## Configure Stripe Test Mode

### Step 1: Create Products and Prices

1. Go to https://dashboard.stripe.com/test/products
2. Create **Pro Subscription**:
   - Product Name: "TLDW Pro"
   - Price: $5/month recurring
   - Copy Price ID → Save as `STRIPE_PRO_PRICE_ID`

3. Create **Top-Up Credits**:
   - Product Name: "Video Credit Pack"
   - Price: $3 one-time
   - **Add Metadata:** `credits` = `20`
   - Copy Price ID → Save as `STRIPE_TOPUP_PRICE_ID`

### Step 2: Get API Keys

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy:
   - **Secret key** → `STRIPE_SECRET_KEY`
   - **Publishable key** → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### Step 3: Configure Webhook (for local testing)

**Option A: Stripe CLI (Recommended)**

```bash
# Install Stripe CLI
brew install stripe/stripe-brew/stripe

# Login
stripe login

# This gives you a temporary webhook secret
# You'll run this later when testing
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

**Option B: ngrok + Dashboard**

```bash
# Install ngrok
brew install ngrok

# Start ngrok
ngrok http 3000

# Use ngrok URL in Stripe Dashboard webhook endpoint
# e.g., https://abc123.ngrok.io/api/webhooks/stripe
```

### Step 4: Update .env.local

```bash
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... # From Stripe CLI or Dashboard
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TOPUP_PRICE_ID=price_...

# Supabase Configuration (should already be set)
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Other (should already be set)
GEMINI_API_KEY=...
SUPADATA_API_KEY=...
```

## Start Testing

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Validate Environment

```bash
npm run validate-env
```

**Expected Output:**
```
✅ All required environment variables are configured correctly
✅ Stripe configuration is valid
✨ Environment validation passed!
```

**If validation fails:** Fix the reported issues before continuing

### Step 3: Start Development Server

```bash
npm run dev
```

**Expected:** Server starts at http://localhost:3000

**Check for errors:**
- ❌ If you see Stripe API errors → Check `STRIPE_SECRET_KEY`
- ❌ If you see Supabase errors → Check Supabase connection
- ✅ Server should start without errors

### Step 4: Run Smoke Tests

**In a new terminal** (keep dev server running):

```bash
npm run stripe:smoke -- --base=http://localhost:3000
```

**Expected:** All smoke tests pass

### Step 5: Test Webhooks (Optional but Recommended)

**Terminal 1:** Dev server (already running)

**Terminal 2:** Stripe CLI
```bash
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

**Copy the webhook secret** shown and update `.env.local`:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Restart dev server** to pick up new webhook secret

**Terminal 3:** Trigger test events
```bash
# Test subscription creation
stripe trigger checkout.session.completed

# Test payment failure
stripe trigger invoice.payment_failed
```

**Check Terminal 1 (dev server)** for webhook processing logs:
- ✅ "Received Stripe webhook: checkout.session.completed"
- ✅ No errors processing events

## Manual Testing Checklist

### Test 1: Anonymous User Limit
- [ ] Open incognito window
- [ ] Go to http://localhost:3000
- [ ] Analyze 1 video (should work)
- [ ] Try 2nd video (should be rate limited)
- [ ] See auth modal with upgrade message

### Test 2: Free User Limit
- [ ] Create new account
- [ ] Analyze 3 videos (should work)
- [ ] Try 4th video (should show upgrade message)

### Test 3: Pro Subscription
- [ ] Click "Upgrade to Pro"
- [ ] Complete checkout with card `4242 4242 4242 4242`
- [ ] Redirected to settings
- [ ] See "Pro" badge and "0/40 videos" usage

### Test 4: Generate Videos as Pro
- [ ] Analyze a video (should work)
- [ ] Usage should increment to "1/40"
- [ ] Cached videos should NOT increment usage

### Test 5: Top-Up Purchase
- [ ] As Pro user, manually exhaust 40-video limit (or set in DB)
- [ ] See "Buy Top-Up" option
- [ ] Complete purchase
- [ ] Credits should increment
- [ ] Can generate beyond 40 videos

## Troubleshooting

### Issue: "STRIPE_WEBHOOK_SECRET is not configured"

**Solution:** You need to either:
1. Run Stripe CLI: `stripe listen --forward-to http://localhost:3000/api/webhooks/stripe`
2. Or temporarily set a dummy value: `STRIPE_WEBHOOK_SECRET=whsec_test_dummy`

### Issue: Validation fails for missing env vars

**Solution:** Check `.env.local` has all required variables from Step 4 above

### Issue: Migrations fail with "relation already exists"

**Solution:** Some migrations may already be applied. Check which tables/functions exist and skip those migrations.

### Issue: Database functions not found

**Solution:**
1. Verify migrations were applied in correct order
2. Check Supabase SQL Editor for any error messages
3. Try applying migrations again (they have `IF NOT EXISTS` guards)

### Issue: Webhook events not processing

**Solution:**
1. Ensure `STRIPE_WEBHOOK_SECRET` matches the one from Stripe CLI/Dashboard
2. Check webhook signature validation is not failing
3. Look for error logs in dev server terminal

## Success Criteria

Before moving to staging, verify:

✅ All migrations applied successfully
✅ Environment validation passes
✅ Dev server starts without errors
✅ Smoke tests pass
✅ Anonymous user rate limiting works
✅ Free user rate limiting works
✅ Pro subscription checkout works
✅ Top-up purchase works
✅ Webhooks process correctly
✅ No errors in application logs

## Next Steps

Once local testing passes:
1. Review `docs/TESTING_SUMMARY.md` for comprehensive test results
2. Document any issues found
3. Prepare for staging deployment (see `docs/STRIPE_DEPLOYMENT.md`)
4. Schedule stakeholder demo

## Getting Help

- **Stripe Documentation:** https://stripe.com/docs
- **Supabase Documentation:** https://supabase.com/docs
- **Testing Guide:** `docs/TESTING_SUMMARY.md`
- **Deployment Guide:** `docs/STRIPE_DEPLOYMENT.md`
- **Price Setup:** `docs/STRIPE_PRICE_SETUP.md`

