-- Forward-only expansion of Block Workflow safe machine-code allowlist.
-- Existing rows are unchanged; migration 007 remains immutable.
ALTER TABLE kleo.block_runs
  DROP CONSTRAINT block_runs_error_code_check;

ALTER TABLE kleo.block_runs
  ADD CONSTRAINT block_runs_error_code_check CHECK(error_code IN (
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
    'VALIDATION_FAILED',
    'QA_FAILED'
  ));
