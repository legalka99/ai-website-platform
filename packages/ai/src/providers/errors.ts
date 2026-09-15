import type { AIUsageRecord } from '../provider.js';

const messages = {
  MISSING_API_KEY: 'Добавьте OPENAI_API_KEY локально в .env.',
  INVALID_CONFIG: 'Проверьте модель и числовые ограничения в .env.',
  INVALID_REQUEST: 'Некорректный или слишком большой запрос к ИИ.',
  AUTH: 'API отклонил доступ. Проверьте ключ и права проекта.',
  RATE_LIMIT: 'API отклонил запрос из-за лимита или доступного баланса.',
  API_ERROR: 'Ошибка внешнего API. Повторите запрос позже.',
  NETWORK: 'Не удалось связаться с внешним API.',
  TIMEOUT: 'Превышено время ожидания ответа ИИ.',
  CANCELLED: 'Запрос отменён.',
  REFUSAL: 'Модель отказалась обрабатывать запрос.',
  INCOMPLETE: 'Модель не завершила ответ. Проверьте ограничение выходных токенов.',
  INVALID_RESPONSE: 'API вернул некорректный структурированный ответ.',
} as const;
export type AIErrorCode = keyof typeof messages;

/** Never retain upstream bodies, headers, exceptions or secrets in public errors. */
export class AIProviderError extends Error {
  constructor(public readonly code: AIErrorCode, public readonly usage?: AIUsageRecord) {
    super(messages[code]);
    this.name = 'AIProviderError';
  }
}
