/**
 * Send Monthly Product Update Email
 *
 * This script sends a monthly product update email to all opted-in users.
 *
 * Usage:
 *   tsx scripts/send-monthly-update.ts
 *
 * Environment Variables Required:
 *   - POSTMARK_SERVER_TOKEN
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY (for admin access)
 *
 * Safety Features:
 *   - Dry-run mode by default (set DRY_RUN=false to send real emails)
 *   - Confirmation prompt before sending
 *   - Batch sending with progress reporting
 */

import { createClient } from '@supabase/supabase-js';
import { sendMonthlyUpdateEmail } from '../lib/postmark-client';
import * as readline from 'readline';

// Configuration
const DRY_RUN = process.env.DRY_RUN !== 'false';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Email content - EDIT THIS SECTION
const EMAIL_CONFIG = {
  subject: 'LongCut Product Updates - December 2024',
  customMessage:
    "Happy holidays from the LongCut team! We've been working hard to make your video learning experience even better.",
  updates: [
    {
      title: 'New AI Translation Feature',
      description:
        "We've added support for translating video transcripts into over 100 languages using Google Cloud Translation.",
      link: 'https://longcut.ai/blog/translation-feature',
    },
    {
      title: 'Improved Video Analysis Speed',
      description:
        "Video analysis is now 40% faster thanks to our new caching system and optimized AI processing.",
      link: 'https://longcut.ai/blog/performance-improvements',
    },
    {
      title: 'Enhanced Note-Taking',
      description:
        'Create notes from transcript selections, chat messages, and key takeaways - all organized in one place.',
    },
  ],
};

// Initialize Supabase admin client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Prompt user for confirmation
 */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Fetch all opted-in users
 */
async function fetchOptedInUsers() {
  console.log('📧 Fetching opted-in users...');

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, marketing_email_token')
    .eq('marketing_emails_enabled', true)
    .not('email', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  }

  // Filter out invalid entries
  const validProfiles = profiles.filter(
    (p) => p.email && p.marketing_email_token
  );

  console.log(`✓ Found ${validProfiles.length} opted-in users`);
  return validProfiles;
}

/**
 * Send monthly update email
 */
async function sendUpdate() {
  console.log('='.repeat(60));
  console.log('LongCut Monthly Product Update Email Sender');
  console.log('='.repeat(60));
  console.log();

  // Check environment variables
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!process.env.POSTMARK_SERVER_TOKEN) {
    console.error('❌ Missing POSTMARK_SERVER_TOKEN environment variable');
    process.exit(1);
  }

  // Dry run warning
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No emails will be sent');
    console.log('   Set DRY_RUN=false to send real emails');
    console.log();
  }

  try {
    // Fetch recipients
    const profiles = await fetchOptedInUsers();

    if (profiles.length === 0) {
      console.log('⚠️  No opted-in users found. Exiting.');
      return;
    }

    // Show email preview
    console.log();
    console.log('📧 Email Preview:');
    console.log('-'.repeat(60));
    console.log(`Subject: ${EMAIL_CONFIG.subject}`);
    console.log(`Recipients: ${profiles.length} users`);
    console.log();
    console.log('Updates:');
    EMAIL_CONFIG.updates.forEach((update, i) => {
      console.log(`  ${i + 1}. ${update.title}`);
      console.log(`     ${update.description}`);
      if (update.link) {
        console.log(`     Link: ${update.link}`);
      }
    });
    console.log('-'.repeat(60));
    console.log();

    // Confirm send
    if (!DRY_RUN) {
      const confirmed = await confirm(
        `Send email to ${profiles.length} recipients?`
      );
      if (!confirmed) {
        console.log('❌ Cancelled by user');
        return;
      }
    }

    // Prepare recipients
    const recipients = profiles.map((profile) => ({
      email: profile.email!,
      userId: profile.id,
      unsubscribeToken: profile.marketing_email_token!,
    }));

    if (DRY_RUN) {
      console.log('✓ Dry run successful - would have sent to:');
      console.log(`  - ${profiles.length} recipients`);
      console.log('  - Sample emails:');
      recipients.slice(0, 3).forEach((r) => {
        console.log(`    • ${r.email}`);
      });
      return;
    }

    // Send emails
    console.log();
    console.log('📤 Sending emails...');
    const startTime = Date.now();

    const result = await sendMonthlyUpdateEmail({
      recipients,
      subject: EMAIL_CONFIG.subject,
      updates: EMAIL_CONFIG.updates,
      customMessage: EMAIL_CONFIG.customMessage,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log();
    console.log('='.repeat(60));
    console.log('📊 Results:');
    console.log('-'.repeat(60));
    console.log(`✓ Sent: ${result.sent}`);
    console.log(`✗ Failed: ${result.failed}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📈 Success Rate: ${((result.sent / recipients.length) * 100).toFixed(1)}%`);

    if (result.errors && result.errors.length > 0) {
      console.log();
      console.log('❌ Errors:');
      result.errors.forEach((error) => {
        console.log(`   ${error}`);
      });
    }

    console.log('='.repeat(60));

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    console.error();
    console.error('❌ Error sending emails:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run script
sendUpdate();
