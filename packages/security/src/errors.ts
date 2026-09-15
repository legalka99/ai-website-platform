/** Public errors contain a fixed code only, never an upstream cause or user data. */
export class SecurityError extends Error {
  constructor(readonly code: 'ACCESS_DENIED' | 'INVALID_INPUT' | 'SECRET_UNAVAILABLE' | 'URL_BLOCKED' | 'LIMIT_EXCEEDED' | 'EXECUTION_DISABLED') {
    super(code); this.name = 'SecurityError';
  }
}
