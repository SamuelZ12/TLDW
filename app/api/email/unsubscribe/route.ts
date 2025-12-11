/**
 * Email Unsubscribe API
 *
 * Public endpoint for users to unsubscribe from marketing emails using a token.
 * This endpoint is called from unsubscribe links in broadcast emails.
 *
 * GET /api/email/unsubscribe?token=<uuid>
 * - Unsubscribes user from marketing emails
 * - Returns HTML page confirming unsubscribe
 * - No authentication required (token-based)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  // Validate token parameter
  if (!token) {
    return new NextResponse(
      generateHTML({
        title: 'Invalid Link',
        message: 'This unsubscribe link is invalid or missing required parameters.',
        success: false,
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }

  try {
    // Create Supabase client
    const supabase = await createClient();

    // Call the unsubscribe function
    const { data, error } = await supabase.rpc('unsubscribe_from_marketing_emails', {
      p_token: token,
    });

    if (error) {
      console.error('Error unsubscribing user:', error);
      return new NextResponse(
        generateHTML({
          title: 'Error',
          message: 'An error occurred while processing your request. Please try again later.',
          success: false,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Check if unsubscribe was successful
    if (!data) {
      return new NextResponse(
        generateHTML({
          title: 'Already Unsubscribed',
          message: "You're already unsubscribed from product update emails, or this link is invalid.",
          success: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    // Success
    return new NextResponse(
      generateHTML({
        title: 'Unsubscribed Successfully',
        message: "You've been unsubscribed from product update emails. You can re-enable these emails anytime from your account settings.",
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error) {
    console.error('Unexpected error in unsubscribe endpoint:', error);
    return new NextResponse(
      generateHTML({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again later.',
        success: false,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
}

/**
 * Generate HTML page for unsubscribe confirmation
 */
function generateHTML(options: {
  title: string;
  message: string;
  success: boolean;
}): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://longcut.ai';
  const { title, message, success } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - LongCut</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }

    .container {
      max-width: 500px;
      background: white;
      border-radius: 12px;
      padding: 48px 32px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    }

    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
    }

    .icon.success {
      background: #dcfce7;
      color: #16a34a;
    }

    .icon.error {
      background: #fee2e2;
      color: #dc2626;
    }

    h1 {
      font-size: 24px;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    p {
      font-size: 16px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .button {
      display: inline-block;
      padding: 12px 32px;
      background: #2563eb;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .button:hover {
      background: #1d4ed8;
    }

    .footer {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      font-size: 14px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon ${success ? 'success' : 'error'}">
      ${success ? '✓' : '×'}
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="${appUrl}" class="button">Return to LongCut</a>
    ${
      success
        ? `
      <div class="footer">
        Changed your mind? You can re-enable product update emails anytime from your
        <a href="${appUrl}/settings" style="color: #2563eb; text-decoration: none;">account settings</a>.
      </div>
    `
        : ''
    }
  </div>
</body>
</html>
  `.trim();
}
