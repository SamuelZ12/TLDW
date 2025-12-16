#!/usr/bin/env node

const baseOffset = process.argv.find(arg => arg.startsWith('--base='));
const baseUrl = baseOffset ? baseOffset.split('=')[1] : 'http://localhost:3000';

async function hitEndpoint(path, options) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    body: safeParseJson(text)
  };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

(async () => {
  console.log(`Stripe smoke test against ${baseUrl}`);
  console.log('---------------------------------------------');

  const checkLimit = await hitEndpoint('/api/check-limit');
  console.log('GET /api/check-limit', checkLimit.status, checkLimit.ok ? 'OK' : 'FAIL');

  const subscriptionStatus = await hitEndpoint('/api/subscription/status');
  console.log('GET /api/subscription/status', subscriptionStatus.status, subscriptionStatus.ok ? 'OK' : 'EXPECTED AUTH FAILURE');

  console.log('---------------------------------------------');
  console.log('Response bodies snapshot:');
  console.dir({ checkLimit: checkLimit.body, subscriptionStatus: subscriptionStatus.body }, { depth: 4 });
})();
