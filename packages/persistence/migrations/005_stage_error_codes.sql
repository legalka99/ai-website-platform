-- Forward-only expansion of the explicit safe machine-code allowlist. No historical rows change.
ALTER TABLE kleo.agent_executions DROP CONSTRAINT agent_executions_error_code_check;
ALTER TABLE kleo.agent_executions ADD CONSTRAINT agent_executions_error_code_check CHECK(error_code IN (
 'STAGE_FAILED',
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
 'VALIDATION_FAILED'
));
