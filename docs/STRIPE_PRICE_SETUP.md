# Stripe Price Configuration Guide

This document explains how to configure Stripe prices with the correct metadata for the TLDW subscription system.

## Overview

The TLDW application extracts pricing information from Stripe price metadata to avoid hardcoding values in the application. This allows you to change prices in the Stripe Dashboard without code changes.

## Required Products and Prices

### 1. Pro Subscription Product

**Product Details:**
- Name: "Pro Subscription" or "TLDW Pro"
- Description: "40 videos per 30 days with AI-powered analysis"

**Price Configuration:**
- Amount: $5.00 USD (or your preferred amount)
- Billing: Recurring - Monthly
- **No special metadata required** (subscription limits are defined in code)

**After Creating:**
1. Copy the Price ID (starts with `price_...`)
2. Add to environment variables as `STRIPE_PRO_PRICE_ID`

### 2. Top-Up Credits Product

**Product Details:**
- Name: "Top-Up Credits" or "Video Credit Pack"
- Description: "+20 video analysis credits (Pro users only)"

**Price Configuration:**
- Amount: $3.00 USD (or your preferred amount)
- Billing: One-time payment

**Required Metadata:**
Add the following metadata to the price:

| Key | Value | Description |
|-----|-------|-------------|
| `credits` | `20` | Number of video credits to add (must be an integer) |

**Important Notes:**
- The `credits` metadata field is **required** for top-up purchases
- If metadata is missing, the system will fall back to defaults (20 credits, $3.00)
- The amount is automatically extracted from the price `unit_amount` field
- You can change both the credits and amount without code changes

**After Creating:**
1. Copy the Price ID (starts with `price_...`)
2. Add to environment variables as `STRIPE_TOPUP_PRICE_ID`

## Step-by-Step Setup Instructions

### Test Mode Setup

1. **Navigate to Stripe Dashboard (Test Mode)**
   - Go to https://dashboard.stripe.com/test/products
   - Ensure you're in "Test mode" (toggle in top-right)

2. **Create Pro Subscription Product**
   ```
   Product Name: TLDW Pro
   Description: 40 videos per 30 days with AI-powered analysis

   → Add pricing
   Price: $5.00 USD
   Billing: Recurring
   Billing period: Monthly

   → Create price
   → Copy Price ID → STRIPE_PRO_PRICE_ID
   ```

3. **Create Top-Up Credits Product**
   ```
   Product Name: Video Credit Pack
   Description: +20 video analysis credits

   → Add pricing
   Price: $3.00 USD
   Billing: One time

   → Advanced options → Metadata
   Key: credits
   Value: 20

   → Create price
   → Copy Price ID → STRIPE_TOPUP_PRICE_ID
   ```

4. **Configure Webhook Endpoint**
   ```
   → Developers → Webhooks → Add endpoint
   Endpoint URL: https://staging.tldw.us/api/webhooks/stripe (for staging)
                 https://tldw.us/api/webhooks/stripe (for production)

   → Select events to listen to:
   ✓ checkout.session.completed
   ✓ customer.subscription.created
   ✓ customer.subscription.updated
   ✓ customer.subscription.deleted
   ✓ invoice.payment_succeeded
   ✓ invoice.payment_failed

   → Add endpoint
   → Reveal signing secret → Copy → STRIPE_WEBHOOK_SECRET
   ```

5. **Update Environment Variables**
   ```bash
   # In .env.local (local development)
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_TOPUP_PRICE_ID=price_...
   ```

### Production Mode Setup

Repeat the above steps in **Live mode**:
1. Toggle to "Live mode" in Stripe Dashboard
2. Create the same products and prices
3. Add metadata to top-up price
4. Configure live webhook endpoint
5. Update production environment variables with live keys

## Testing Top-Up Metadata Extraction

Use the Stripe CLI to test that metadata is being extracted correctly:

```bash
# Start webhook forwarding
stripe listen --forward-to http://localhost:3000/api/webhooks/stripe

# In another terminal, trigger a checkout session completion
stripe trigger checkout.session.completed
```

Check your application logs for:
```
Top-up values extracted: 20 credits for 300 cents
```

If you see this message, metadata extraction is working correctly!

## Troubleshooting

### Issue: "Using default values" in logs

**Problem:** Webhook logs show "using defaults" instead of extracted metadata

**Solution:**
1. Verify the `credits` metadata key is set on the Price (not the Product)
2. Check that you're using the correct Price ID in `STRIPE_TOPUP_PRICE_ID`
3. Ensure the metadata key is exactly `credits` (lowercase, no spaces)

### Issue: Wrong credit amount applied

**Problem:** User receives wrong number of credits after purchase

**Solution:**
1. Check the `credits` metadata value is an integer (no quotes needed in Stripe)
2. Verify no trailing spaces in the metadata value
3. Look for webhook processing errors in application logs

### Issue: Webhook not receiving events

**Problem:** No webhook events arriving at your endpoint

**Solution:**
1. Verify webhook endpoint URL is correct and accessible
2. Check that all required events are selected in Stripe Dashboard
3. Test with `stripe trigger` command to rule out connectivity issues
4. Verify `STRIPE_WEBHOOK_SECRET` matches the endpoint's signing secret

## Changing Prices Later

### To change top-up credits or amount:

1. Create a new price for the "Video Credit Pack" product
2. Set the new amount (e.g., $5.00 for 35 credits)
3. Add metadata: `credits` = `35`
4. Update `STRIPE_TOPUP_PRICE_ID` environment variable with new Price ID
5. **Do not** delete the old price immediately (existing links may reference it)

### To change subscription price:

1. Create a new price for the "TLDW Pro" product
2. Set the new amount (e.g., $7.00/month)
3. Update `STRIPE_PRO_PRICE_ID` environment variable
4. Existing subscribers will remain on their current price until they cancel/resubscribe

## Security Notes

- Never commit API keys to version control
- Use test mode keys for development/staging
- Rotate webhook secrets quarterly or after any suspected compromise
- Limit access to Stripe Dashboard to authorized personnel only
- Monitor webhook delivery failures in Stripe Dashboard

## Reference

- [Stripe Price API](https://stripe.com/docs/api/prices)
- [Stripe Metadata](https://stripe.com/docs/api/metadata)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)
