import { AIProviderError } from './errors.js';
export interface YandexProviderConfig { apiKey: string; folderId: string; model: string; timeoutMs: number; maxOutputTokens: number }
export function readYandexConfig(env: Record<string, string | undefined>): YandexProviderConfig {
  const apiKey = env.YANDEX_API_KEY?.trim();
  if (!apiKey) throw new AIProviderError('YANDEX_MISSING_API_KEY');
  const folderId = env.KLEO_YANDEX_FOLDER_ID?.trim();
  if (!folderId) throw new AIProviderError('YANDEX_MISSING_FOLDER');
  const rawModel = env.KLEO_YANDEX_MODEL?.trim();
  const model = rawModel?.startsWith('gpt://') ? rawModel : `gpt://${folderId}/${rawModel ?? ''}`;
  const timeoutMs = Number(env.KLEO_YANDEX_TIMEOUT_MS ?? 30000);
  const maxOutputTokens = Number(env.KLEO_YANDEX_MAX_OUTPUT_TOKENS ?? 2000);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(folderId) || !rawModel || model.includes(apiKey) || folderId.includes(apiKey) ||
    !model.startsWith(`gpt://${folderId}/`) || !/^gpt:\/\/[a-zA-Z0-9_-]{1,64}\/[a-zA-Z0-9._-]{1,100}\/(latest|rc|[a-zA-Z0-9._-]{1,64})$/.test(model) ||
    /[\r\n]/.test(apiKey) || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000 ||
    !Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 8000) throw new AIProviderError('INVALID_CONFIG');
  return { apiKey, folderId, model, timeoutMs, maxOutputTokens };
}
