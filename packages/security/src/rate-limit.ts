import { createHash } from 'node:crypto';
import { SecurityError } from './errors.js';
export type RateDimension = 'actor' | 'ip' | 'api_key' | 'project' | 'ai_operation';
export interface RateKey { dimension: RateDimension; projectId: string; subject: string }
export interface RateResult { allowed: boolean; remaining: number; retryAfterMs: number }
export interface RateLimiter { consume(key: RateKey, limit: number, windowMs: number): RateResult }
/** Single-process test/local implementation. Each configured dimension must be checked by the API. */
export class InMemoryRateLimiter implements RateLimiter {
  #buckets = new Map<string, { count: number; reset: number }>();
  constructor(private readonly now = () => Date.now()) {}
  consume(key: RateKey, limit: number, windowMs: number): RateResult {
    if (!key.projectId || !key.subject || key.projectId.length > 200 || key.subject.length > 500 ||
      !['actor', 'ip', 'api_key', 'project', 'ai_operation'].includes(key.dimension) ||
      !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1 || windowMs > 3600000) throw new SecurityError('INVALID_INPUT');
    const now = this.now();
    for (const [id, bucket] of this.#buckets) if (bucket.reset <= now) this.#buckets.delete(id);
    const id = createHash('sha256').update(JSON.stringify([key.dimension, key.projectId, key.subject])).digest('hex');
    let bucket = this.#buckets.get(id);
    if (!bucket) {
      if (this.#buckets.size >= 10000) return { allowed: false, remaining: 0, retryAfterMs: windowMs };
      bucket = { count: 0, reset: now + windowMs }; this.#buckets.set(id, bucket);
    }
    if (bucket.count >= limit) return { allowed: false, remaining: 0, retryAfterMs: bucket.reset - now };
    bucket.count++; return { allowed: true, remaining: limit - bucket.count, retryAfterMs: 0 };
  }
}
export interface AICostLimits { requestsPerMinute: number; maxConcurrent: number; maxRequestsPerWorkflow: number; maxOutputTokens: number; maxWorkflowOutputTokens: number; maxRetries: 0 }
export interface AIBudgetMetadata { projectId: string; workflowId: string; maxOutputTokens: number; reservedOutputTokens: number; requests: number; maxRequests: number }
export const DEFAULT_AI_LIMITS: Readonly<AICostLimits> = Object.freeze({ requestsPerMinute: 10, maxConcurrent: 2, maxRequestsPerWorkflow: 5, maxOutputTokens: 2000, maxWorkflowOutputTokens: 10000, maxRetries: 0 });
/** Share one instance across all providers in the server. Never allocate a new gate for each request. */
export class AICostGuard {
  #limits: AICostLimits;
  #active = 0;
  #workflows = new Map<string, { requests: number; reserved: number }>();
  constructor(limits: AICostLimits = DEFAULT_AI_LIMITS, private readonly rate: RateLimiter = new InMemoryRateLimiter()) {
    if (limits.maxRetries !== 0 || Object.entries(limits).some(([key, n]) => key !== 'maxRetries' && (!Number.isSafeInteger(n) || n < 1)) || limits.maxOutputTokens > 8000 || limits.maxConcurrent > 100) throw new SecurityError('INVALID_INPUT');
    this.#limits = { ...limits };
  }
  reserve(projectId: string, workflowId: string, outputTokens: number): { budget: AIBudgetMetadata; release: () => void } {
    if (!projectId || !workflowId || projectId.length > 200 || workflowId.length > 200 || !Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > this.#limits.maxOutputTokens) throw new SecurityError('LIMIT_EXCEEDED');
    const id = JSON.stringify([projectId, workflowId]);
    const state = this.#workflows.get(id) ?? { requests: 0, reserved: 0 };
    if ((!this.#workflows.has(id) && this.#workflows.size >= 10000) || this.#active >= this.#limits.maxConcurrent || state.requests >= this.#limits.maxRequestsPerWorkflow || state.reserved + outputTokens > this.#limits.maxWorkflowOutputTokens) throw new SecurityError('LIMIT_EXCEEDED');
    if (!this.rate.consume({ dimension: 'ai_operation', projectId, subject: 'generation' }, this.#limits.requestsPerMinute, 60000).allowed) throw new SecurityError('LIMIT_EXCEEDED');
    state.requests++; state.reserved += outputTokens; this.#workflows.set(id, state); this.#active++;
    let released = false;
    // Failure/timeout does not refund requests/tokens: the provider may already have charged.
    return { budget: { projectId, workflowId, maxOutputTokens: outputTokens, reservedOutputTokens: state.reserved, requests: state.requests, maxRequests: this.#limits.maxRequestsPerWorkflow },
      release: () => { if (!released) { released = true; this.#active--; } } };
  }
}
