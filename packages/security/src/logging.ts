import { redact } from './redaction.js';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
// Only server-generated metadata is accepted. Bodies, prompts, headers, env and errors are absent.
export interface LogMetadata { projectId?: string; actorId?: string; workflowId?: string; code?: string; durationMs?: number; count?: number }
export class SafeLogger {
  #sink: (entry: string) => void;
  #secrets: readonly string[];
  #debug: boolean;
  constructor(sink: (entry: string) => void, options: { production?: boolean; debug?: boolean; knownSecrets?: readonly string[] } = {}) {
    this.#sink = sink; this.#secrets = [...(options.knownSecrets ?? [])];
    this.#debug = options.production === false && options.debug === true;
  }
  log(level: LogLevel, event: string, metadata: LogMetadata = {}): void {
    if (!['error', 'warn', 'info', 'debug'].includes(level) || (level === 'debug' && !this.#debug)) return;
    const safe: Record<string, unknown> = {};
    for (const key of ['projectId', 'actorId', 'workflowId', 'code', 'durationMs', 'count'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
      if (descriptor && 'value' in descriptor && ['string', 'number'].includes(typeof descriptor.value)) safe[key] = descriptor.value;
    }
    // Event names are static identifiers, not a free-text message channel.
    const name = /^[a-z][a-z0-9_.]{0,63}$/.test(event) ? event : 'security.invalid_event';
    try { this.#sink(JSON.stringify(redact({ level, event: name, timestamp: new Date().toISOString(), ...safe }, this.#secrets))); } catch { /* Logging must not expose sink errors. */ }
  }
}
