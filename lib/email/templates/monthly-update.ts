export const getSubject = () => "Monthly Update from Longcut.ai";

export const getHtmlBody = (unsubscribeUrl: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      margin-bottom: 30px;
      text-align: center;
    }
    .content {
      background: #ffffff;
      padding: 20px;
      border-radius: 8px;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 12px;
      color: #888;
    }
    a {
      color: #4F46E5;
      text-decoration: none;
    }
    h1 {
      font-size: 24px;
      font-weight: bold;
      color: #111;
      margin-bottom: 20px;
    }
    p {
      margin-bottom: 16px;
    }
    .button {
      display: inline-block;
      background-color: #4F46E5;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: bold;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Longcut.ai Update</h1>
  </div>

  <div class="content">
    <p>Hi there,</p>

    <p>We've been hard at work improving Longcut.ai. Here's what's new this month:</p>

    <ul>
      <li><strong>Feature 1:</strong> Description of feature 1.</li>
      <li><strong>Feature 2:</strong> Description of feature 2.</li>
      <li><strong>Feature 3:</strong> Description of feature 3.</li>
    </ul>

    <p>We'd love to hear your feedback!</p>

    <p>Best,<br>The Longcut.ai Team</p>
  </div>

  <div class="footer">
    <p>
      You are receiving this email because you signed up for Longcut.ai.<br>
      <a href="${unsubscribeUrl}">Unsubscribe from these emails</a>
    </p>
  </div>
</body>
</html>
`;
