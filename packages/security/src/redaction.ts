const hidden = '[REDACTED]';
const sensitiveField = /secret|token|password|passwd|credential|authorization|cookie|api.?key|private.?key/i;
const tokenCounts = new Set(['inputTokens', 'outputTokens', 'totalTokens', 'maxOutputTokens', 'reservedOutputTokens']);
const patterns = [
  /\bauthorization["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n,;}]+)/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-[a-zA-Z0-9_-]{12,}/g,
  /\b(?:Bearer|Api-Key)\s+[^\s"',;}]+/gi,
  /((?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
];
export function redactText(value: string, knownSecrets: readonly string[] = []): string {
  let result = value;
  for (const secret of knownSecrets) if (secret) result = result.split(secret).join(hidden);
  for (const pattern of patterns) result = result.replace(pattern, hidden);
  return result;
}
export function containsSecret(value: string, knownSecrets: readonly string[] = []): boolean {
  return redactText(value, knownSecrets) !== value;
}
/** Never invoke getters/toJSON or retain raw Error messages/stack/cause. */
export function redact(value: unknown, knownSecrets: readonly string[] = []): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 1000 || depth > 8) return '[TRUNCATED]';
    if (typeof item === 'string') return redactText(item, knownSecrets).slice(0, 4000);
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item !== 'object') return '[OMITTED]';
    if (item instanceof Error) return { error: 'Upstream error omitted' };
    if (seen.has(item)) return '[CIRCULAR]';
    seen.add(item);
    if (Array.isArray(item)) {
      const result: unknown[] = [];
      for (let i = 0; i < Math.min(item.length, 100); i++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        result.push(descriptor && 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[ACCESSOR]');
      }
      return result;
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item)).slice(0, 100)) {
      const safeKey = redactText(key, knownSecrets).slice(0, 200);
      result[safeKey] = tokenCounts.has(key) && 'value' in descriptor && Number.isSafeInteger(descriptor.value) && descriptor.value >= 0 ? descriptor.value : sensitiveField.test(key) ? hidden : 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[ACCESSOR]';
    }
    return result;
  }
  try { return visit(value, 0); } catch { return '[OMITTED]'; }
}
