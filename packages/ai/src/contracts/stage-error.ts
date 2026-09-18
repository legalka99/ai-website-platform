import type { AgentType } from '../agent.js';
/** Explicit existing agent/provider/security codes. Never derive codes from messages or exceptions. */
export const STAGE_ERROR_CODES = [
  'YANDEX_MISSING_API_KEY',
  'YANDEX_MISSING_FOLDER',
  'ROUTE_UNAVAILABLE',
  'MISSING_API_KEY',
  'INVALID_CONFIG',
  'INVALID_REQUEST',
  'AUTH',
  'RATE_LIMIT',
  'API_ERROR',
  'NETWORK',
  'TIMEOUT',
  'CANCELLED',
  'REFUSAL',
  'INCOMPLETE',
  'INVALID_RESPONSE',
  'ACCESS_DENIED',
  'INVALID_INPUT',
  'SECRET_UNAVAILABLE',
  'URL_BLOCKED',
  'LIMIT_EXCEEDED',
  'EXECUTION_DISABLED',
  'PROVIDER_FAILURE',
  'MISSING_BUSINESS_DATA',
  'VALIDATION_FAILED',
] as const;
export type StageErrorCode = typeof STAGE_ERROR_CODES[number];
export interface StageError { stage: AgentType; errorCode: StageErrorCode }
export function safeStageErrorCode(value: unknown): StageErrorCode | undefined {
  return typeof value === 'string' && (STAGE_ERROR_CODES as readonly string[]).includes(value)
    ? value as StageErrorCode : undefined;
}
