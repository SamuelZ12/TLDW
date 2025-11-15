#!/usr/bin/env node
/**
 * Admin Script: Grant Pro Access to Users
 *
 * Usage:
 *   npx tsx scripts/grant-pro-access.ts <email> [options]
 *
 * Options:
 *   --expires <date>    Set expiration date (YYYY-MM-DD), default: 2099-12-31
 *   --credits <number>  Add bonus top-up credits (Pro only feature)
 *   --dry-run           Show what would happen without making changes
 *   --help              Show this help message
 *
 * Examples:
 *   npx tsx scripts/grant-pro-access.ts user@example.com
 *   npx tsx scripts/grant-pro-access.ts user@example.com --expires 2025-12-31
 *   npx tsx scripts/grant-pro-access.ts user@example.com --credits 50
 *   npx tsx scripts/grant-pro-access.ts user@example.com --dry-run
 */

// Load .env.local file manually (required for standalone script execution)
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(process.cwd(), '.env.local');
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
} catch (error) {
  console.error('⚠️  Warning: Could not load .env.local file');
  console.error('   Make sure .env.local exists in the project root or environment variables are set via system\n');
}

// Import dependencies after environment is loaded
import { createServiceRoleClient } from '../lib/supabase/admin';

interface GrantProOptions {
  email: string;
  expiresAt?: Date;
  bonusCredits?: number;
  dryRun?: boolean;
}

interface Profile {
  id: string;
  email: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_current_period_end: string | null;
  topup_credits: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

function parseArgs(): GrantProOptions | null {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    showHelp();
    return null;
  }

  const email = args[0];
  if (!email || email.startsWith('--')) {
    console.error('❌ Error: Email address is required as first argument\n');
    showHelp();
    return null;
  }

  const options: GrantProOptions = { email };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--expires') {
      const dateStr = args[++i];
      if (!dateStr) {
        console.error('❌ Error: --expires requires a date (YYYY-MM-DD)');
        return null;
      }
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        console.error(`❌ Error: Invalid date format: ${dateStr}`);
        return null;
      }
      options.expiresAt = date;
    } else if (arg === '--credits') {
      const credits = parseInt(args[++i], 10);
      if (isNaN(credits) || credits < 0) {
        console.error('❌ Error: --credits requires a positive number');
        return null;
      }
      options.bonusCredits = credits;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      console.error(`❌ Error: Unknown option: ${arg}\n`);
      showHelp();
      return null;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Admin Script: Grant Pro Access to Users

Usage:
  npx tsx scripts/grant-pro-access.ts <email> [options]

Options:
  --expires <date>    Set expiration date (YYYY-MM-DD), default: 2099-12-31
  --credits <number>  Add bonus top-up credits (Pro only feature)
  --dry-run           Show what would happen without making changes
  --help              Show this help message

Examples:
  # Grant lifetime Pro access
  npx tsx scripts/grant-pro-access.ts user@example.com

  # Grant Pro access until specific date
  npx tsx scripts/grant-pro-access.ts user@example.com --expires 2025-12-31

  # Grant Pro + 50 bonus credits
  npx tsx scripts/grant-pro-access.ts user@example.com --credits 50

  # Check what would happen (dry run)
  npx tsx scripts/grant-pro-access.ts user@example.com --dry-run
  `);
}

function displayProfile(profile: Profile, label: string) {
  console.log(`\n${label}:`);
  console.log(`  Email: ${profile.email}`);
  console.log(`  Tier: ${profile.subscription_tier || 'none'}`);
  console.log(`  Status: ${profile.subscription_status || 'none'}`);
  console.log(`  Period End: ${profile.subscription_current_period_end || 'none'}`);
  console.log(`  Top-up Credits: ${profile.topup_credits}`);
  console.log(`  Stripe Customer: ${profile.stripe_customer_id || 'none'}`);
  console.log(`  Stripe Subscription: ${profile.stripe_subscription_id || 'none'}`);
}

async function grantProAccess(options: GrantProOptions): Promise<void> {
  const supabase = createServiceRoleClient();
  const periodEnd = options.expiresAt || new Date('2099-12-31');
  const periodStart = new Date();

  console.log(`\n🔍 Looking up user: ${options.email}`);

  // Fetch current profile
  const { data: currentProfile, error: fetchError } = await supabase
    .from('profiles')
    .select('id, email, subscription_tier, subscription_status, subscription_current_period_end, topup_credits, stripe_customer_id, stripe_subscription_id')
    .eq('email', options.email)
    .single();

  if (fetchError || !currentProfile) {
    console.error(`❌ Error: User not found with email: ${options.email}`);
    console.error('   Make sure the user has logged in at least once to create a profile.');
    return;
  }

  displayProfile(currentProfile as Profile, '📋 Current Profile');

  // Prepare updates
  const updates: any = {
    subscription_tier: 'pro',
    subscription_status: 'active',
    subscription_current_period_start: periodStart.toISOString(),
    subscription_current_period_end: periodEnd.toISOString(),
    cancel_at_period_end: false,
  };

  if (options.bonusCredits && options.bonusCredits > 0) {
    updates.topup_credits = (currentProfile.topup_credits || 0) + options.bonusCredits;
  }

  console.log(`\n📝 Planned Changes:`);
  console.log(`  Subscription Tier: ${currentProfile.subscription_tier || 'none'} → pro`);
  console.log(`  Subscription Status: ${currentProfile.subscription_status || 'none'} → active`);
  console.log(`  Period Start: ${periodStart.toISOString()}`);
  console.log(`  Period End: ${currentProfile.subscription_current_period_end || 'none'} → ${periodEnd.toISOString()}`);
  if (options.bonusCredits && options.bonusCredits > 0) {
    console.log(`  Top-up Credits: ${currentProfile.topup_credits || 0} → ${updates.topup_credits} (+${options.bonusCredits})`);
  }

  if (options.dryRun) {
    console.log(`\n✅ Dry run complete - no changes made`);
    return;
  }

  // Execute update
  console.log(`\n⚙️  Applying changes...`);
  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', currentProfile.id)
    .select('id, email, subscription_tier, subscription_status, subscription_current_period_end, topup_credits, stripe_customer_id, stripe_subscription_id')
    .single();

  if (updateError) {
    console.error(`❌ Error updating profile:`, updateError);
    return;
  }

  displayProfile(updatedProfile as Profile, '✅ Updated Profile');

  console.log(`\n🎉 Successfully granted Pro access to ${options.email}`);
  if (periodEnd.getFullYear() === 2099) {
    console.log(`   (Lifetime access granted)`);
  } else {
    console.log(`   (Access expires: ${periodEnd.toISOString().split('T')[0]})`);
  }
}

async function main() {
  const options = parseArgs();

  if (!options) {
    process.exit(1);
  }

  try {
    await grantProAccess(options);
  } catch (error) {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  }
}

main();
