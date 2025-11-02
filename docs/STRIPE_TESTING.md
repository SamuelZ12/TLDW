# Stripe Subscription Testing Guide

This guide outlines automated smoke checks and manual QA scenarios for the Stripe subscription rollout.

## 1. Automated Smoke Checks

Run the HTTP smoke script (requires the Next.js dev server running locally):

```bash
npm run stripe:smoke -- --base=http://localhost:3000
```

The script verifies that `/api/check-limit` responds with rate-limit metadata and that `/api/subscription/status` enforces authentication.

## 2. Stripe CLI Webhook Workflow

1. Authenticate once with `stripe login`.
2. Start the webhook forwarder:
   ```bash
   stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
   ```
3. Trigger key events while the app is running:
   ```bash
   stripe trigger checkout.session.completed
   stripe trigger customer.subscription.updated
   stripe trigger invoice.payment_failed
   ```
4. Verify backend logs for idempotent handling and database updates (see `logs/stripe-webhook.*` in your logging provider).

## 3. Manual QA Scenarios

| Scenario | Steps | Expected Result |
| --- | --- | --- |
| Free usage ceiling | Sign up, generate 3 videos, attempt a 4th | `/api/video-analysis` returns 429 with upgrade CTA |
| Pro upgrade | Run `Upgrade to Pro` from Settings or Pricing | Stripe Checkout redirects, profile updated to `pro` |
| Past due banner | Trigger `invoice.payment_failed` webhook | Settings page shows "Payment required" alert, API reports `past_due` |
| Top-Up purchase | From Settings, buy top-up | `topup_purchases` row inserted, credits increment by 20 |
| Cancel at period end | Cancel via Stripe portal | Settings shows cancellation banner, tier remains `pro` until end |
| Anonymous limit | From incognito window, hit `/api/check-limit` until denied | Response contains `requiresAuth: true`, Auth modal copy references 3 videos/month |

## 4. Regression Checklist (Deploy to Staging)

- [ ] `supabase db push` succeeds with new migrations.
- [ ] `npm run lint` completes without errors.
- [ ] `npm run stripe:smoke -- --base=https://staging.tldw.us` passes.
- [ ] Stripe dashboard shows webhook endpoint `https://staging.tldw.us/api/webhooks/stripe` as `Enabled`.
- [ ] Test card `4242 4242 4242 4242` completes a Pro checkout and records subscription status in Supabase.
- [ ] Top-up credits decrement after consuming >40 videos.

Refer back to `STRIPE_IMPLEMENTATION_PLAN.md` for full end-to-end acceptance criteria.
