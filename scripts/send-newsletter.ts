import * as dotenv from 'dotenv';
import * as postmark from 'postmark';
import { createServiceRoleClient } from '../lib/supabase/admin';
import { getHtmlBody, getSubject } from '../lib/email/templates/monthly-update';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// Check for required environment variables
const POSTMARK_SERVER_TOKEN = process.env.POSTMARK_SERVER_TOKEN;
const NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://longcut.ai';

if (!POSTMARK_SERVER_TOKEN) {
  console.error('Error: POSTMARK_SERVER_TOKEN is not set.');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY is not set.');
  process.exit(1);
}

const client = new postmark.ServerClient(POSTMARK_SERVER_TOKEN);
const supabase = createServiceRoleClient();

interface Profile {
  id: string;
  email: string;
}

async function sendNewsletter() {
  console.log('Starting newsletter distribution...');

  // 1. Fetch subscribers
  // We explicitly check for newsletter_subscribed being true OR null (if we want to include people before the migration who haven't opted out?
  // No, the migration set nulls to true. So we just check for true.)
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('newsletter_subscribed', true)
    .not('email', 'is', null);

  if (error) {
    console.error('Failed to fetch profiles:', error);
    process.exit(1);
  }

  // Cast data to Profile[] to satisfy TypeScript
  const profiles = data as unknown as Profile[];

  if (!profiles || profiles.length === 0) {
    console.log('No subscribers found.');
    return;
  }

  console.log(`Found ${profiles.length} subscribers.`);

  let successCount = 0;
  let errorCount = 0;

  // 2. Iterate and send
  for (const profile of profiles) {
    if (!profile.email) continue;

    const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/unsubscribe?uid=${profile.id}`;
    const htmlBody = getHtmlBody(unsubscribeUrl);
    const subject = getSubject();

    try {
      await client.sendEmail({
        "From": "zara@longcut.ai",
        "To": profile.email,
        "Subject": subject,
        "HtmlBody": htmlBody,
        "MessageStream": "outbound"
      });
      console.log(`[OK] Sent to ${profile.email}`);
      successCount++;
    } catch (e: any) {
      console.error(`[FAIL] Failed to send to ${profile.email}: ${e.message}`);
      errorCount++;
    }

    // Optional: Add a small delay to avoid hitting rate limits too hard if the list is huge?
    // Postmark handles high volume well, but for a script loop, a tiny tick doesn't hurt.
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('-----------------------------------');
  console.log(`Finished.`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors:  ${errorCount}`);
}

sendNewsletter().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
