import { AIProviderError } from './errors.js';

export interface OpenAIProviderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
}

export function readOpenAIConfig(env: Record<string, string | undefined>): OpenAIProviderConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AIProviderError('MISSING_API_KEY');
  const model = env.KLEO_AI_MODEL?.trim();
  const timeoutMs = Number(env.KLEO_AI_TIMEOUT_MS ?? 30000);
  const maxOutputTokens = Number(env.KLEO_AI_MAX_OUTPUT_TOKENS ?? 2000);
  if (!model || model.includes(apiKey) || model.startsWith('sk-') || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 ||
      !Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 8000) {
    throw new AIProviderError('INVALID_CONFIG');
  }
  return { apiKey, model, timeoutMs, maxOutputTokens };
}
