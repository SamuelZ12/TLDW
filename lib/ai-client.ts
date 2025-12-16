import type { ZodTypeAny } from 'zod';
import {
  availableProviders,
  generateStructuredContent,
  type ProviderGenerateParams,
  type ProviderGenerateResult,
} from './ai-providers';

export interface GenerateAIOptions {
  provider?: string;
  model?: string;
  preferredModel?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  zodSchema?: ZodTypeAny;
  schemaName?: string;
  metadata?: Record<string, unknown>;
  /**
   * @deprecated Prefer using top-level properties (temperature, maxOutputTokens, etc.)
   */
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
  };
}

function coerceProviderParams(
  prompt: string,
  options: GenerateAIOptions
): ProviderGenerateParams & { provider?: string } {
  const generationConfig = options.generationConfig ?? {};
  const temperature =
    options.temperature ?? generationConfig.temperature ?? undefined;
  const topP = options.topP ?? generationConfig.topP ?? undefined;
  const maxOutputTokens =
    options.maxOutputTokens ?? generationConfig.maxOutputTokens ?? undefined;

  const providerParams: ProviderGenerateParams & { provider?: string } = {
    prompt,
    provider: options.provider,
    model: options.model ?? options.preferredModel,
    temperature,
    topP,
    maxOutputTokens,
    timeoutMs: options.timeoutMs,
    zodSchema: options.zodSchema,
    schemaName: options.schemaName,
    metadata: options.metadata,
  };

  return providerParams;
}

export async function generateAIResponse(
  prompt: string,
  options: GenerateAIOptions = {}
): Promise<string> {
  const providerParams = coerceProviderParams(prompt, options);
  const result = await generateStructuredContent(providerParams);
  return result.content;
}

export async function generateAIResult(
  prompt: string,
  options: GenerateAIOptions = {}
): Promise<ProviderGenerateResult> {
  const providerParams = coerceProviderParams(prompt, options);
  return generateStructuredContent(providerParams);
}

export function listAvailableAIProviders() {
  return availableProviders();
}

