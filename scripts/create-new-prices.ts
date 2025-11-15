#!/usr/bin/env tsx
/**
 * Script to create new Stripe prices for updated pricing ($10/month, $100/year)
 *
 * This script creates the correct prices in TEST mode for local development.
 *
 * Usage:
 *   npm run stripe:create-prices
 *   or
 *   tsx scripts/create-new-prices.ts
 *
 * Prerequisites:
 * - STRIPE_SECRET_KEY must be set in .env.local (test mode key)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import Stripe from 'stripe';

// Load .env.local file manually
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
}

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error('❌ Error: STRIPE_SECRET_KEY is not set');
    console.error('   Please add it to your .env.local file');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2024-10-28.acacia' as any,
    typescript: true,
  });

  const isTestMode = secretKey.startsWith('sk_test_');
  console.log(`🚀 Creating new prices in ${isTestMode ? 'TEST' : 'LIVE'} mode\n`);

  // Get the Pro product
  const products = await stripe.products.list({ limit: 10 });
  const proProduct = products.data.find(p => p.name.includes('TLDW Pro'));

  if (!proProduct) {
    console.error('❌ Could not find TLDW Pro product');
    console.error('   Please create the product first in your Stripe dashboard');
    process.exit(1);
  }

  console.log(`📦 Found product: ${proProduct.name} (${proProduct.id})\n`);

  // Create monthly price: $10/month
  console.log('Creating monthly price: $10.00/month...');
  const monthlyPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 1000, // $10.00 in cents
    currency: 'usd',
    recurring: {
      interval: 'month',
    },
    nickname: 'Pro Monthly - $10',
  });
  console.log(`✅ Created: ${monthlyPrice.id}`);

  // Create annual price: $100/year
  console.log('Creating annual price: $100.00/year...');
  const annualPrice = await stripe.prices.create({
    product: proProduct.id,
    unit_amount: 10000, // $100.00 in cents
    currency: 'usd',
    recurring: {
      interval: 'year',
    },
    nickname: 'Pro Annual - $100',
  });
  console.log(`✅ Created: ${annualPrice.id}\n`);

  console.log('🎉 Success! New prices created:\n');
  console.log(`Monthly Price ID:  ${monthlyPrice.id}`);
  console.log(`Annual Price ID:   ${annualPrice.id}\n`);

  console.log('📝 Next steps:');
  console.log('1. Update your .env.local with these new price IDs:');
  console.log(`   STRIPE_PRO_PRICE_ID=${monthlyPrice.id}`);
  console.log(`   STRIPE_PRO_ANNUAL_PRICE_ID=${annualPrice.id}\n`);

  if (!isTestMode) {
    console.log('2. Update your Vercel environment variables:');
    console.log('   Go to: https://vercel.com/samuelz12s-projects/tldw/settings/environment-variables');
    console.log(`   Set STRIPE_PRO_PRICE_ID to: ${monthlyPrice.id}`);
    console.log(`   Set STRIPE_PRO_ANNUAL_PRICE_ID to: ${annualPrice.id}\n`);
  }
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});
