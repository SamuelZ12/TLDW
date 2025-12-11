/**
 * Postmark Email Client
 *
 * Handles both transactional and broadcast email sending via Postmark.
 *
 * Setup Instructions:
 * 1. Create separate message streams in Postmark:
 *    - Transactional: For user signups, password resets, etc.
 *    - Broadcast: For monthly product updates, newsletters, etc.
 * 2. Add environment variables to .env.local:
 *    - POSTMARK_SERVER_TOKEN: Your Postmark server token
 *    - POSTMARK_TRANSACTIONAL_STREAM: Message stream ID for transactional emails (default: "outbound")
 *    - POSTMARK_BROADCAST_STREAM: Message stream ID for broadcast emails (default: "broadcasts")
 *    - POSTMARK_FROM_EMAIL: Default sender email (e.g., zara@longcut.ai)
 * 3. Configure sender signature in Postmark for zara@longcut.ai
 */

import { ServerClient } from 'postmark';

// Initialize Postmark client
const postmarkClient = new ServerClient(
  process.env.POSTMARK_SERVER_TOKEN || ''
);

// Configuration
const POSTMARK_CONFIG = {
  transactionalStream: process.env.POSTMARK_TRANSACTIONAL_STREAM || 'outbound',
  broadcastStream: process.env.POSTMARK_BROADCAST_STREAM || 'broadcasts',
  fromEmail: process.env.POSTMARK_FROM_EMAIL || 'zara@longcut.ai',
  fromName: process.env.POSTMARK_FROM_NAME || 'Zara from LongCut',
};

// Type definitions
export interface TransactionalEmailOptions {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  tag?: string;
  metadata?: Record<string, string>;
}

export interface BroadcastEmailOptions {
  recipients: Array<{
    email: string;
    metadata?: Record<string, string>;
  }>;
  subject: string;
  htmlBody: string;
  textBody?: string;
  tag?: string;
}

export interface MonthlyUpdateEmailOptions {
  recipients: Array<{
    email: string;
    userId: string;
    unsubscribeToken: string;
  }>;
  subject: string;
  updates: Array<{
    title: string;
    description: string;
    link?: string;
  }>;
  customMessage?: string;
}

/**
 * Send a transactional email (one-to-one)
 * Used for: signup confirmations, password resets, notifications
 */
export async function sendTransactionalEmail(
  options: TransactionalEmailOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error('POSTMARK_SERVER_TOKEN environment variable is not set');
    }

    const response = await postmarkClient.sendEmail({
      From: `${POSTMARK_CONFIG.fromName} <${POSTMARK_CONFIG.fromEmail}>`,
      To: options.to,
      Subject: options.subject,
      HtmlBody: options.htmlBody,
      TextBody: options.textBody,
      MessageStream: POSTMARK_CONFIG.transactionalStream,
      Tag: options.tag,
      Metadata: options.metadata,
    });

    return {
      success: true,
      messageId: response.MessageID,
    };
  } catch (error) {
    console.error('Error sending transactional email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send broadcast email (one-to-many)
 * Used for: monthly updates, newsletters, announcements
 *
 * Note: For large recipient lists (>500), consider batching the sends
 */
export async function sendBroadcastEmail(
  options: BroadcastEmailOptions
): Promise<{ success: boolean; sent: number; failed: number; errors?: string[] }> {
  try {
    if (!process.env.POSTMARK_SERVER_TOKEN) {
      throw new Error('POSTMARK_SERVER_TOKEN environment variable is not set');
    }

    // Send emails in batches of 500 (Postmark's batch limit)
    const BATCH_SIZE = 500;
    const batches = [];

    for (let i = 0; i < options.recipients.length; i += BATCH_SIZE) {
      batches.push(options.recipients.slice(i, i + BATCH_SIZE));
    }

    let totalSent = 0;
    let totalFailed = 0;
    const errors: string[] = [];

    for (const batch of batches) {
      try {
        const messages = batch.map((recipient) => ({
          From: `${POSTMARK_CONFIG.fromName} <${POSTMARK_CONFIG.fromEmail}>`,
          To: recipient.email,
          Subject: options.subject,
          HtmlBody: options.htmlBody,
          TextBody: options.textBody,
          MessageStream: POSTMARK_CONFIG.broadcastStream,
          Tag: options.tag,
          Metadata: recipient.metadata,
        }));

        const responses = await postmarkClient.sendEmailBatch(messages);

        responses.forEach((response, index) => {
          if (response.ErrorCode === 0) {
            totalSent++;
          } else {
            totalFailed++;
            errors.push(
              `Failed to send to ${batch[index].email}: ${response.Message}`
            );
          }
        });
      } catch (error) {
        totalFailed += batch.length;
        errors.push(
          `Batch error: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return {
      success: totalFailed === 0,
      sent: totalSent,
      failed: totalFailed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    console.error('Error sending broadcast email:', error);
    return {
      success: false,
      sent: 0,
      failed: options.recipients.length,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Generate HTML for monthly product update email
 */
function generateMonthlyUpdateHTML(
  options: MonthlyUpdateEmailOptions,
  recipient: { email: string; userId: string; unsubscribeToken: string }
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://longcut.ai';
  const unsubscribeUrl = `${appUrl}/api/email/unsubscribe?token=${recipient.unsubscribeToken}`;

  const updatesHTML = options.updates
    .map(
      (update) => `
    <div style="margin-bottom: 24px;">
      <h2 style="color: #1a1a1a; font-size: 18px; margin-bottom: 8px;">
        ${update.title}
      </h2>
      <p style="color: #666; line-height: 1.6; margin-bottom: 8px;">
        ${update.description}
      </p>
      ${
        update.link
          ? `<a href="${update.link}" style="color: #2563eb; text-decoration: none;">Learn more →</a>`
          : ''
      }
    </div>
  `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 40px;">
      <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">LongCut</h1>
      <p style="color: #666; margin-top: 8px;">Monthly Product Updates</p>
    </div>

    <!-- Custom Message -->
    ${
      options.customMessage
        ? `
      <div style="background: #f9fafb; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 32px;">
        <p style="color: #1a1a1a; margin: 0; line-height: 1.6;">
          ${options.customMessage}
        </p>
      </div>
    `
        : ''
    }

    <!-- Updates -->
    <div style="margin-bottom: 40px;">
      ${updatesHTML}
    </div>

    <!-- Footer -->
    <div style="border-top: 1px solid #e5e7eb; padding-top: 24px; color: #9ca3af; font-size: 14px;">
      <p style="margin: 0 0 8px 0;">
        Best regards,<br>
        Zara from LongCut
      </p>
      <p style="margin: 16px 0 0 0; font-size: 12px;">
        You're receiving this email because you have a LongCut account.
        <a href="${unsubscribeUrl}" style="color: #9ca3af; text-decoration: underline;">
          Unsubscribe from product updates
        </a>
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text version for monthly product update email
 */
function generateMonthlyUpdateText(
  options: MonthlyUpdateEmailOptions,
  recipient: { email: string; userId: string; unsubscribeToken: string }
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://longcut.ai';
  const unsubscribeUrl = `${appUrl}/api/email/unsubscribe?token=${recipient.unsubscribeToken}`;

  const updatesText = options.updates
    .map(
      (update) => `
${update.title}
${'='.repeat(update.title.length)}

${update.description}

${update.link ? `Learn more: ${update.link}` : ''}
  `.trim()
    )
    .join('\n\n');

  return `
LongCut - Monthly Product Updates

${options.customMessage ? `${options.customMessage}\n\n` : ''}
${updatesText}

---

Best regards,
Zara from LongCut

You're receiving this email because you have a LongCut account.
Unsubscribe from product updates: ${unsubscribeUrl}
  `.trim();
}

/**
 * Send monthly product update email to subscribers
 * Automatically handles HTML/text generation and unsubscribe links
 */
export async function sendMonthlyUpdateEmail(
  options: MonthlyUpdateEmailOptions
): Promise<{ success: boolean; sent: number; failed: number; errors?: string[] }> {
  const recipients = options.recipients.map((recipient) => ({
    email: recipient.email,
    metadata: {
      userId: recipient.userId,
      unsubscribeToken: recipient.unsubscribeToken,
    },
  }));

  // Generate personalized HTML and text for each recipient
  const messages = options.recipients.map((recipient) => ({
    email: recipient.email,
    htmlBody: generateMonthlyUpdateHTML(options, recipient),
    textBody: generateMonthlyUpdateText(options, recipient),
    metadata: {
      userId: recipient.userId,
      unsubscribeToken: recipient.unsubscribeToken,
      emailType: 'monthly_update',
    },
  }));

  // Send in batches
  const BATCH_SIZE = 500;
  const batches = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    batches.push(messages.slice(i, i + BATCH_SIZE));
  }

  let totalSent = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      const emailBatch = batch.map((msg) => ({
        From: `${POSTMARK_CONFIG.fromName} <${POSTMARK_CONFIG.fromEmail}>`,
        To: msg.email,
        Subject: options.subject,
        HtmlBody: msg.htmlBody,
        TextBody: msg.textBody,
        MessageStream: POSTMARK_CONFIG.broadcastStream,
        Tag: 'monthly_update',
        Metadata: msg.metadata,
      }));

      const responses = await postmarkClient.sendEmailBatch(emailBatch);

      responses.forEach((response, index) => {
        if (response.ErrorCode === 0) {
          totalSent++;
        } else {
          totalFailed++;
          errors.push(
            `Failed to send to ${batch[index].email}: ${response.Message}`
          );
        }
      });
    } catch (error) {
      totalFailed += batch.length;
      errors.push(
        `Batch error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return {
    success: totalFailed === 0,
    sent: totalSent,
    failed: totalFailed,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export default postmarkClient;
