import { isIP } from 'node:net';
import { SecurityError } from './errors.js';
export interface URLPolicy { allowHttp?: boolean; allowedHosts?: readonly string[]; maxRedirects?: number }
export type DNSResolver = (hostname: string) => Promise<readonly string[]>;
export interface ValidatedDestination { readonly url: string; readonly hostname: string; readonly addresses: readonly string[]; readonly redirectCount: number }
// Conservative deny list: non-global, transition, metadata and special-purpose space.
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    if (address === '168.63.129.16') return false; // Azure platform virtual IP
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (version === 6) {
    const canonical = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
    const first = parseInt(canonical.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !canonical.startsWith('2001:') && !canonical.startsWith('2002:') && !canonical.startsWith('3fff:');
  }
  return false;
}
export function validateURL(raw: string, policy: URLPolicy = {}): URL {
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\\\s\u0000-\u001f]/.test(raw)) throw 0;
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(policy.allowHttp === true && url.protocol === 'http:')) throw 0;
    if (url.username || url.password || url.hash || (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw 0;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || !host.includes('.') && !isIP(host) ||
      /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      ['metadata.google.internal', 'metadata', 'instance-data'].includes(host)) throw 0;
    if (isIP(host) && !isPublicAddress(host)) throw 0;
    if (policy.allowedHosts && !policy.allowedHosts.includes(host)) throw 0;
    for (const key of url.searchParams.keys()) if (/token|secret|password|credential|api.?key|signature|authorization/i.test(key)) throw 0;
    return url;
  } catch { throw new SecurityError('URL_BLOCKED'); }
}
/** A validation result is NOT permission to call ordinary fetch: transport must pin one returned address,
 * preserve hostname/TLS verification, disable automatic redirects and reject a different peer address.
 * This module makes no network connection. A production pinned transport + egress firewall is still required.
 */
export async function validateDestination(raw: string, resolve: DNSResolver, policy: URLPolicy = {}, previous?: ValidatedDestination): Promise<ValidatedDestination> {
  try {
    const max = policy.maxRedirects ?? 3;
    if (!Number.isInteger(max) || max < 0 || max > 5) throw 0;
    const count = previous ? previous.redirectCount + 1 : 0;
    if (count > max) throw 0;
    const url = validateURL(previous ? new URL(raw, previous.url).href : raw, policy);
    if (previous && new URL(previous.url).protocol === 'https:' && url.protocol !== 'https:') throw 0;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    const addresses = isIP(hostname) ? [hostname] : [...await resolve(hostname)];
    if (!addresses.length || addresses.length > 32 || !addresses.every(isPublicAddress)) throw 0;
    return Object.freeze({ url: url.href, hostname, addresses: Object.freeze(addresses), redirectCount: count });
  } catch { throw new SecurityError('URL_BLOCKED'); }
}
