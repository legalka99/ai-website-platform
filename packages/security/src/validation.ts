import { SecurityError } from './errors.js';
export interface InputLimits { maxBytes: number; maxString: number; maxArray: number; maxDepth: number; maxNodes: number }
export const DEFAULT_INPUT_LIMITS: Readonly<InputLimits> = Object.freeze({ maxBytes: 100000, maxString: 12000, maxArray: 100, maxDepth: 12, maxNodes: 5000 });
/** Resource bounds first, caller's existing schema/domain validator second. No coercion or extra-field removal. */
export function validateExternal<T>(value: unknown, schema: (value: unknown) => boolean, limits: InputLimits = DEFAULT_INPUT_LIMITS): T {
  const seen = new WeakSet<object>(); let nodes = 0;
  function check(item: unknown, depth: number): void {
    if (++nodes > limits.maxNodes || depth > limits.maxDepth) throw new SecurityError('INVALID_INPUT');
    if (typeof item === 'string') { if (item.length > limits.maxString) throw new SecurityError('INVALID_INPUT'); return; }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (typeof item !== 'object' || seen.has(item)) throw new SecurityError('INVALID_INPUT');
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > limits.maxArray) throw new SecurityError('INVALID_INPUT');
    } else if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new SecurityError('INVALID_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (Object.keys(descriptors).length > limits.maxNodes) throw new SecurityError('INVALID_INPUT');
    for (const [key, desc] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.length > limits.maxString || !('value' in desc)) throw new SecurityError('INVALID_INPUT');
      check(desc.value, depth + 1);
    }
  }
  try {
    if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n < 1)) throw new SecurityError('INVALID_INPUT');
    check(value, 0);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limits.maxBytes || !schema(value)) throw new SecurityError('INVALID_INPUT');
    return value as T;
  } catch { throw new SecurityError('INVALID_INPUT'); }
}
