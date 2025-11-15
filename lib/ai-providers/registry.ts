import { createGeminiAdapter } from './gemini-adapter';
import { createGrokAdapter } from './grok-adapter';
import type { ProviderAdapter, ProviderGenerateParams, ProviderGenerateResult } from './types';

type ProviderKey = 'grok' | 'gemini';

type ProviderFactory = () => ProviderAdapter;

const providerFactories: Record<ProviderKey, ProviderFactory> = {
  grok: createGrokAdapter,
  gemini: createGeminiAdapter,
};

const providerEnvGuards: Record<ProviderKey, () => string | undefined> = {
  grok: () => process.env.XAI_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
};

const providerCache: Partial<Record<ProviderKey, ProviderAdapter>> = {};

function resolveProviderKey(preferred?: string): ProviderKey {
  const envPreference =
    preferred ??
    process.env.AI_PROVIDER ??
    process.env.NEXT_PUBLIC_AI_PROVIDER;

  if (envPreference && envPreference in providerFactories) {
    return envPreference as ProviderKey;
  }

  if (providerEnvGuards.grok()) {
    return 'grok';
  }
  if (providerEnvGuards.gemini()) {
    return 'gemini';
  }

  return 'grok';
}

export function getProviderKey(preferred?: string): ProviderKey {
  return resolveProviderKey(preferred);
}

function ensureProvider(key: ProviderKey): ProviderAdapter {
  if (providerCache[key]) {
    return providerCache[key]!;
  }

  const guard = providerEnvGuards[key];
  if (!guard()) {
    throw new Error(
      `AI provider "${key}" is not configured. Please supply the required environment variables.`
    );
  }

  const factory = providerFactories[key];
  const adapter = factory();
  providerCache[key] = adapter;
  return adapter;
}

export function availableProviders(): ProviderKey[] {
  return (Object.keys(providerFactories) as ProviderKey[]).filter((key) => {
    try {
      return !!providerEnvGuards[key]();
    } catch {
      return false;
    }
  });
}

export function getProvider(key?: string): ProviderAdapter {
  const resolvedKey = resolveProviderKey(key);
  return ensureProvider(resolvedKey);
}

export async function generateStructuredContent(
  params: ProviderGenerateParams & { provider?: string }
): Promise<ProviderGenerateResult> {
  const { provider, ...rest } = params;
  const adapter = getProvider(provider);
  return adapter.generate(rest);
}

