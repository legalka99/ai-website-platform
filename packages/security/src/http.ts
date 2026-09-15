import { SecurityError } from './errors.js';
export function httpSecurityDefaults(production: boolean, origins: readonly string[]) {
  const allowlist = origins.map(raw => {
    try { const u = new URL(raw); if (u.origin !== raw || u.username || u.password || (u.protocol !== 'https:' && (production || u.protocol !== 'http:'))) throw 0; return u.origin; }
    catch { throw new SecurityError('INVALID_INPUT'); }
  });
  return Object.freeze({ httpsOnly: production, requestMaxBytes: 1048576,
    cookies: Object.freeze({ secure: production, httpOnly: true, sameSite: 'strict' as const }),
    csrf: 'required-for-cookie-authenticated-mutations' as const,
    cors: Object.freeze({ origins: Object.freeze(allowlist), credentials: false, allowOrigin: (origin: string) => allowlist.includes(origin) }),
    headers: Object.freeze({ 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(production ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}) }),
  });
}
