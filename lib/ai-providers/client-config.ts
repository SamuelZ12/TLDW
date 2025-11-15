type ClientProviderKey = 'grok' | 'gemini';

function resolveClientProviderKey(): ClientProviderKey {
  const rawProvider = process.env.NEXT_PUBLIC_AI_PROVIDER;
  const normalized =
    typeof rawProvider === 'string' ? rawProvider.trim().toLowerCase() : undefined;

  if (normalized === 'gemini') {
    return 'gemini';
  }

  return 'grok';
}

export function getClientProviderKey(): ClientProviderKey {
  return resolveClientProviderKey();
}

export function isGrokProviderOnClient(): boolean {
  return resolveClientProviderKey() === 'grok';
}

