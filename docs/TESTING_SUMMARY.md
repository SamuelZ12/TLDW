# Stripe Implementation Testing Summary

**Date:** 2025-11-01
**Status:** Phase 1 Complete - Ready for Local Testing
**Next Steps:** Apply migrations and run comprehensive tests

---

## Phase 1: Critical Fixes Completed ✅

### 1. Database Schema (Migration Files Created)

**New Migrations:**
1. `20251101120001_add_audit_and_rate_limit_tables.sql` - Adds missing tables
   - `audit_logs` - Security event tracking
   - `rate_limits` - Sliding window rate limiting
   - Includes RLS policies and cleanup functions

2. `20251101120002_atomic_credit_consumption.sql` - Prevents race conditions
   - `consume_video_credit_atomically()` - Transaction-wrapped credit consumption
   - `check_video_generation_allowed()` - Read-only credit check
   - Uses `FOR UPDATE` locking to prevent concurrent issues

3. `20251101120003_backfill_existing_users.sql` - Migrates existing data
   - Sets default `subscription_tier = 'free'` for all users
   - Initializes period dates (30-day rolling windows)
   - Backfills `video_generations` from `video_analyses` (marked as uncounted)
   - Includes validation queries and rollback instructions

**Status:** ✅ Created, not yet applied

---

### 2. Stripe API Version Fixed

**File:** `lib/stripe-client.ts`

**Changes:**
- ❌ Before: `apiVersion: '2025-10-29.clover'` (invalid format)
- ✅ After: `apiVersion: '2024-11-20'` (valid Stripe version)

**Impact:** Prevents SDK initialization errors

---

### 3. Webhook Secret Validation Added

**File:** `lib/stripe-client.ts`

**Changes:**
- Added `STRIPE_WEBHOOK_SECRET` to `validateStripeConfig()`
- Enhanced error messages with setup URLs

**Impact:** Catches configuration issues at startup instead of runtime

---

### 4. Race Condition Fix (Transaction Wrapper)

**File:** `lib/subscription-manager.ts`

**Changes:**
- Created `consumeVideoCreditAtomic()` function
- Deprecated old `consumeVideoCredit()` (kept for compatibility)
- Uses new `consume_video_credit_atomically` RPC

**How it prevents race conditions:**
1. Locks user's profile row with `FOR UPDATE`
2. Checks usage within transaction
3. Inserts video_generation record
4. Decrements credits (if needed)
5. All operations atomic - either all succeed or all fail

**Critical:** Application code should be updated to use `consumeVideoCreditAtomic()` instead of `consumeVideoCredit()`

---

### 5. Webhook Dynamic Top-Up Values

**File:** `app/api/webhooks/stripe/route.ts`

**Changes:**
- Added `extractTopupValuesFromSession()` function
- Extracts `credits` from price metadata
- Extracts `amount` from price `unit_amount`
- Falls back to defaults (20 credits, $3.00) if metadata missing

**Required Stripe Configuration:**
- Top-up price MUST have metadata key: `credits` (e.g., `"20"`)
- See `docs/STRIPE_PRICE_SETUP.md` for detailed setup instructions

**Impact:** Allows changing top-up values in Stripe Dashboard without code changes

---

### 6. Environment Validation Script

**File:** `scripts/validate-env.ts`
**Command:** `npm run validate-env`

**Features:**
- Validates all required environment variables
- Checks Stripe key formats (`sk_`, `pk_`, `whsec_`, `price_`)
- Detects test/live mode mismatches
- Displays helpful error messages

**Status:** ✅ Created, ready to use

---

## Phase 2: Local Testing (Next Steps)

### Prerequisites

Before starting tests, ensure you have:

1. **Stripe Test Mode Keys**
   - [ ] `STRIPE_SECRET_KEY` (starts with `sk_test_`)
   - [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (starts with `pk_test_`)
   - [ ] `STRIPE_WEBHOOK_SECRET` (from webhook endpoint)
   - [ ] `STRIPE_PRO_PRICE_ID` (subscription price)
   - [ ] `STRIPE_TOPUP_PRICE_ID` (top-up price with `credits` metadata)

2. **Stripe Price Configuration**
   - [ ] Pro subscription price created ($5/month)
   - [ ] Top-up price created ($3) with metadata: `credits = "20"`
   - [ ] Webhook endpoint configured (for local testing, use Stripe CLI)

3. **Other Environment Variables**
   - [ ] Supabase (URL, anon key, service role key)
   - [ ] Gemini API key
   - [ ] Supadata API key

### Step-by-Step Testing Plan

#### Step 1: Install Dependencies

```bash
npm install
```

**Expected:** `tsx` package installed for running validation scripts

---

#### Step 2: Validate Environment

```bash
npm run validate-env
```

**Expected Output:**
```
✅ All required environment variables are configured correctly
✅ Stripe configuration is valid
📊 Environment Summary:
  • Stripe Mode: TEST
  • ...
✨ Environment validation passed!
```

**If validation fails:** Fix missing/incorrect environment variables before proceeding

---

#### Step 3: Apply Database Migrations

```bash
# If using Supabase CLI
supabase db push

# Or manually apply migrations in order:
# 1. 20251031120000_phase1_stripe_schema.sql (if not already applied)
# 2. 20251101120000_phase4_backend_updates.sql (if not already applied)
# 3. 20251101120001_add_audit_and_rate_limit_tables.sql
# 4. 20251101120002_atomic_credit_consumption.sql
# 5. 20251101120003_backfill_existing_users.sql
```

**Verification Queries:**
```sql
-- Check that new tables exist
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('audit_logs', 'rate_limits', 'video_generations', 'topup_purchases', 'stripe_events');

-- Check that new RPC functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('consume_video_credit_atomically', 'check_video_generation_allowed');

-- Verify all profiles have subscription_tier
SELECT COUNT(*) FROM profiles WHERE subscription_tier IS NULL; -- Should be 0
```

---

#### Step 4: Start Development Server

```bash
npm run dev
```

**Expected:** Server starts on http://localhost:3000

**Check logs for:**
- No Stripe initialization errors
- No database connection errors
- No missing environment variable errors

---

#### Step 5: Run Smoke Tests

```bash
npm run stripe:smoke -- --base=http://localhost:3000
```

**Expected Output:**
```
✓ /api/check-limit returns rate limit metadata
✓ /api/subscription/status enforces authentication
...
✓ All smoke tests passed
```

---

#### Step 6: Test Webhooks with Stripe CLI

**Terminal 1:** Keep dev server running

**Terminal 2:** Start Stripe CLI forwarding
```bash
stripe login
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
```

**Copy the webhook signing secret** from CLI output and add to `.env.local`:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Terminal 3:** Trigger webhook events
```bash
# Test subscription checkout
stripe trigger checkout.session.completed

# Test subscription update
stripe trigger customer.subscription.updated

# Test payment failure
stripe trigger invoice.payment_failed

# Test payment success
stripe trigger invoice.payment_succeeded
```

**Check Application Logs For:**
- ✅ "Received Stripe webhook: checkout.session.completed"
- ✅ "Top-up values extracted: 20 credits for 300 cents" (for top-up purchases)
- ✅ No errors about missing metadata
- ✅ No idempotency errors (on replay)

---

## Critical Test Scenarios

### Scenario 1: Anonymous User Rate Limit
1. Open incognito window
2. Navigate to http://localhost:3000
3. Analyze 1 video
4. Attempt to analyze a 2nd video
5. **Expected:** Rate limit message, auth modal with upgrade CTA

### Scenario 2: Free User Rate Limit
1. Sign up for new account
2. Analyze 3 videos
3. Attempt 4th video
4. **Expected:** "Upgrade to Pro" message

### Scenario 3: Pro Subscription Flow
1. Click "Upgrade to Pro" from rate limit message
2. Complete checkout with test card: `4242 4242 4242 4242`
3. **Expected:**
   - Redirects to settings page
   - Subscription status shows "Pro"
   - Usage shows "0/40 videos"

### Scenario 4: Top-Up Purchase
1. As Pro user, exhaust 40 video limit
2. Click "Buy Top-Up Credits"
3. Complete checkout
4. **Expected:**
   - `topup_purchases` row inserted with correct credits/amount
   - `profiles.topup_credits` incremented by 20
   - Can generate additional videos beyond base limit

### Scenario 5: Atomic Credit Consumption (Race Condition Test)
```bash
# Send 10 concurrent requests to generate videos
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/video-analysis \
    -H "Content-Type: application/json" \
    -d '{"youtubeId":"dQw4w9WgXcQ"}' &
done
wait
```

**Expected:**
- Only allowed number of videos created based on limit
- No negative credit balances
- All requests either succeed or fail gracefully

### Scenario 6: Webhook Idempotency
```bash
# Replay same event twice
stripe events resend evt_...
```

**Expected:**
- First delivery: Processes successfully
- Second delivery: Skipped with "already processed" log

---

## Known Issues / Limitations

### Issue 1: Application Not Using Atomic Function
**Problem:** `app/api/video-analysis/route.ts` still uses deprecated `consumeVideoCredit()`

**Impact:** Race condition still possible under high concurrency

**Fix Required:** Update video-analysis route to use `consumeVideoCreditAtomic()`

**Priority:** HIGH

### Issue 2: No Caching on Subscription Status
**Problem:** `/api/subscription/status` fetches from database on every request

**Impact:** Performance degradation under load

**Fix Required:** Add 30-second cache

**Priority:** MEDIUM

### Issue 3: Webhook Error Handling Too Permissive
**Problem:** Webhook returns `{ received: true }` even on processing errors

**Impact:** Stripe won't retry failed events

**Fix Required:** Return appropriate error codes (4xx/5xx) for actual failures

**Priority:** MEDIUM

---

## Post-Testing Actions

After completing local tests:

1. **Review Logs** for any unexpected errors or warnings
2. **Check Database** for data consistency:
   ```sql
   -- Verify no negative credits
   SELECT * FROM profiles WHERE topup_credits < 0;

   -- Check video_generations integrity
   SELECT user_id, COUNT(*) as count, subscription_tier
   FROM video_generations
   WHERE counted_toward_limit = true
   GROUP BY user_id, subscription_tier
   ORDER BY count DESC;
   ```

3. **Document Any Issues** found during testing
4. **Prepare for Staging Deployment**

---

## Next Phase: Staging Deployment

Once local testing passes:

1. Deploy code to staging environment
2. Apply migrations to staging Supabase
3. Configure staging Stripe webhook endpoint
4. Run full test suite in staging
5. Load test critical endpoints
6. Get stakeholder sign-off

See `STRIPE_DEPLOYMENT.md` for detailed deployment steps.

---

## Quick Reference

### Useful Commands
```bash
# Validate environment
npm run validate-env

# Run smoke tests
npm run stripe:smoke -- --base=http://localhost:3000

# Start Stripe CLI
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
stripe trigger customer.subscription.updated
```

### Database Queries
```sql
-- Check user subscription status
SELECT id, email, subscription_tier, subscription_status, topup_credits
FROM profiles
WHERE email = 'test@example.com';

-- View usage for a user
SELECT * FROM video_generations
WHERE user_id = '...'
ORDER BY created_at DESC;

-- View webhook processing
SELECT * FROM stripe_events
ORDER BY created_at DESC LIMIT 10;

-- View audit logs
SELECT * FROM audit_logs
WHERE action IN ('SUBSCRIPTION_CREATED', 'TOPUP_PURCHASED')
ORDER BY created_at DESC;
```

### Test Credit Cards
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Insufficient funds: `4000 0000 0000 9995`
- 3D Secure: `4000 0025 0000 3155`

---

## Sign-Off Checklist

Before moving to staging:

- [ ] All Phase 1 fixes applied and tested
- [ ] Environment validation passes
- [ ] All migrations applied successfully
- [ ] Smoke tests pass
- [ ] Webhook events processed correctly
- [ ] Rate limiting works for all tiers
- [ ] No race conditions observed in concurrent tests
- [ ] Top-up metadata extraction working
- [ ] No unexpected errors in logs
- [ ] Database integrity verified

**Tester:** _______________
**Date:** _______________
**Approved for Staging:** ☐ Yes ☐ No

