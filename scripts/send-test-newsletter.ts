import * as dotenv from 'dotenv';
import * as postmark from 'postmark';
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

const client = new postmark.ServerClient(POSTMARK_SERVER_TOKEN);

async function sendTestNewsletter() {
  console.log('Sending test newsletter...');

  const testEmail = 'zhangsamuel12@gmail.com';
  const testUserId = 'test-user-id'; // Dummy ID for unsubscribe link

  const unsubscribeUrl = `${NEXT_PUBLIC_APP_URL}/unsubscribe?uid=${testUserId}`;
  const htmlBody = getHtmlBody(unsubscribeUrl);
  const subject = getSubject();

  try {
    const result = await client.sendEmail({
      "From": "zara@longcut.ai",
      "To": testEmail,
      "Subject": subject,
      "HtmlBody": htmlBody,
      "MessageStream": "outbound"
    });
    console.log(`✓ Test email sent successfully to ${testEmail}`);
    console.log(`Message ID: ${result.MessageID}`);
  } catch (e: any) {
    console.error(`✗ Failed to send test email: ${e.message}`);
    if (e.statusCode) {
      console.error(`Status code: ${e.statusCode}`);
    }
    process.exit(1);
  }
}

sendTestNewsletter().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
