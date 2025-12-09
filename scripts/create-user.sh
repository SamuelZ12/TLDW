#!/bin/bash

# Manual User Creation Script for TLDW
# Usage: ./scripts/create-user.sh <email> <password>

set -e

if [ $# -lt 2 ]; then
  echo "Usage: $0 <email> <password> [full_name]"
  echo "Example: $0 user@example.com SecurePass123 \"John Doe\""
  exit 1
fi

EMAIL="$1"
PASSWORD="$2"
FULL_NAME="${3:-}"

# Check if ADMIN_SECRET is set
if [ -z "$ADMIN_SECRET" ]; then
  echo "Error: ADMIN_SECRET environment variable is not set"
  echo "Please set it in your .env.local file or export it:"
  echo "  export ADMIN_SECRET=your-secret-here"
  exit 1
fi

# Determine the API URL
if [ -z "$NEXT_PUBLIC_APP_URL" ]; then
  API_URL="http://localhost:3000"
else
  API_URL="$NEXT_PUBLIC_APP_URL"
fi

echo "Creating user: $EMAIL"
echo "API URL: $API_URL"

# Build JSON payload
if [ -n "$FULL_NAME" ]; then
  PAYLOAD=$(cat <<EOF
{
  "email": "$EMAIL",
  "password": "$PASSWORD",
  "metadata": {
    "full_name": "$FULL_NAME"
  }
}
EOF
)
else
  PAYLOAD=$(cat <<EOF
{
  "email": "$EMAIL",
  "password": "$PASSWORD"
}
EOF
)
fi

# Make API request
RESPONSE=$(curl -s -X POST "$API_URL/api/admin/create-user" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d "$PAYLOAD")

# Check if request was successful
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo "✅ User created successfully!"
  echo "$RESPONSE" | jq '.'
else
  echo "❌ Failed to create user:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi
