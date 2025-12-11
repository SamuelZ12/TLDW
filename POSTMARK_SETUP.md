# Postmark Newsletter Setup Guide

This guide explains how to set up and send monthly product updates using Postmark.

## 1. Postmark Configuration

1.  **Create an Account**: If you haven't already, sign up at [postmarkapp.com](https://postmarkapp.com).
2.  **Sender Signature**:
    *   Go to **Sender Signatures** in your Postmark dashboard.
    *   Add `zara@longcut.ai`.
    *   Postmark will send a verification email to that address. Click the link to verify.
    *   **DKIM/SPF**: For best deliverability, follow Postmark's instructions to add DKIM and SPF records to your DNS settings for `longcut.ai`.
3.  **Server Token**:
    *   Create a "Server" in Postmark (e.g., named "Production" or "Marketing").
    *   Go to the **API Tokens** tab of that server.
    *   Copy the **Server API Token**.

## 2. Environment Variables

You need to set the following environment variables.

**For Local Development (.env.local):**
```bash
POSTMARK_SERVER_TOKEN=your_postmark_server_token_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**For Production:**
Add these variables to your Vercel (or other hosting) project settings.
*   `POSTMARK_SERVER_TOKEN`: The token you copied.
*   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key (found in Supabase Dashboard > Settings > API). **Do not expose this to the browser.**
*   `NEXT_PUBLIC_APP_URL`: Your production URL (e.g., `https://longcut.ai`).

## 3. Database Migration

You need to add the `newsletter_subscribed` column to your `profiles` table.

A migration file has been created at: `supabase/migrations/20251211185543_add_newsletter_subscription.sql`.

**If you have the Supabase CLI installed:**
Run:
```bash
supabase db push
```

**If you are using the Supabase Dashboard (Web UI):**
1.  Go to the **SQL Editor**.
2.  Copy the content of the migration file:
    ```sql
    -- Add newsletter_subscribed column to profiles table
    ALTER TABLE profiles
    ADD COLUMN newsletter_subscribed BOOLEAN DEFAULT true;

    -- Update the column for existing users to true
    UPDATE profiles
    SET newsletter_subscribed = true
    WHERE newsletter_subscribed IS NULL;
    ```
3.  Run the query.

## 4. Editing the Newsletter Content

To change the content of the email:
1.  Open `lib/email/templates/monthly-update.ts`.
2.  Modify the HTML in the `getHtmlBody` function.
3.  Modify the subject in `getSubject` function.

## 5. Sending the Newsletter

**Test First:**
It is highly recommended to test with a single user or a staging environment before sending to everyone. You can modify the script temporarily to filter for your own email.

**Run the Script:**
From your terminal, run:

```bash
npx tsx scripts/send-newsletter.ts
```

This script will:
1.  Fetch all users with `newsletter_subscribed = true`.
2.  Generate a unique unsubscribe link for each.
3.  Send the email via Postmark.
4.  Log success and failure counts.
