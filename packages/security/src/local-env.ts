import { lstatSync } from 'node:fs';
import { SecurityError } from './errors.js';
/** Check metadata only. Never read/log .env content; caller may load it after this check. */
export function assertLocalEnvFile(path: string, environment: string): void {
  if (!['development', 'test'].includes(environment)) throw new SecurityError('SECRET_UNAVAILABLE');
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw 0;
  } catch { throw new SecurityError('SECRET_UNAVAILABLE'); }
}
