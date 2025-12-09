# Admin Guide - Manual User Creation

This guide explains how to manually create user accounts in TLDW.

## Prerequisites

You need the following environment variables set:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (found in Supabase dashboard)
- `ADMIN_SECRET` - A secret key to protect the admin endpoint (set this yourself)

## Method 1: Supabase Dashboard (Recommended)

The easiest way to create a user:

1. Go to your Supabase project: https://app.supabase.com
2. Navigate to **Authentication** → **Users**
3. Click **Add User**
4. Enter email and password
5. Click **Create User**

The user profile will be automatically created via the database trigger.

## Method 2: Admin API Endpoint

### Setup

1. Add `ADMIN_SECRET` to your `.env.local`:
   ```bash
   ADMIN_SECRET=your-secure-random-secret-here
   ```

2. Restart your development server:
   ```bash
   npm run dev
   ```

### Usage Option A: Command Line Script

```bash
# Set your admin secret
export ADMIN_SECRET=your-secure-random-secret-here

# Create a user
./scripts/create-user.sh user@example.com SecurePass123 "John Doe"
```

### Usage Option B: Direct API Call

```bash
curl -X POST http://localhost:3000/api/admin/create-user \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-secure-random-secret-here" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123",
    "metadata": {
      "full_name": "John Doe"
    }
  }'
```

### Response

Success:
```json
{
  "success": true,
  "user": {
    "id": "uuid-here",
    "email": "user@example.com",
    "created_at": "2024-12-09T..."
  }
}
```

Error:
```json
{
  "error": "Error message here"
}
```

## Method 3: Supabase CLI

If you have the Supabase CLI installed:

```bash
# Invite a user (they'll receive an email)
supabase auth users invite user@example.com

# Or create directly via SQL
supabase db sql --query "
  SELECT auth.uid() FROM auth.users
  WHERE email = 'user@example.com'
"
```

## Security Notes

⚠️ **IMPORTANT**: The admin API endpoint should be:
- Protected with a strong `ADMIN_SECRET`
- Only accessible to authorized administrators
- Removed or disabled in production if not needed
- Never exposed to client-side code

Consider removing the endpoint after creating necessary users, or add additional authentication layers like IP whitelisting or admin user authentication.

## What Happens When a User Is Created?

1. User account is created in `auth.users` (Supabase managed)
2. Database trigger `handle_new_user()` automatically creates a profile in `public.profiles`
3. User can immediately sign in with the provided credentials
4. Email is auto-confirmed (no verification needed when using admin methods)

## Troubleshooting

**User already exists:**
- Check the Supabase dashboard under Authentication → Users
- User might have signed up previously

**Profile not created:**
- Verify the `handle_new_user()` trigger exists in your database
- Check Supabase logs for trigger errors
- Manually create profile:
  ```sql
  INSERT INTO public.profiles (id, email)
  VALUES ('user-uuid-from-auth', 'user@example.com');
  ```

**Permission errors:**
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct
- Check that the service role client is properly configured in `lib/supabase/admin.ts`
