import { validateExternal } from '../../../security/src/validation.js';
import OpenAI from 'openai';
import { Ajv } from 'ajv';
import type { AIProvider, AIRequest, AIResponse, AIUsageRecord } from '../provider.js';
import { AIProviderError } from './errors.js';
import { readOpenAIConfig, type OpenAIProviderConfig } from './config.js';

const MAX_REQUEST_CHARS = 24000;
const MAX_RESPONSE_BYTES = 1048576;

export class OpenAIProvider implements AIProvider {
  #client: OpenAI;
  #config: OpenAIProviderConfig;

  constructor(config: OpenAIProviderConfig, transport?: typeof fetch) {
    this.#config = readOpenAIConfig({ OPENAI_API_KEY: config.apiKey, KLEO_AI_MODEL: config.model,
      KLEO_AI_TIMEOUT_MS: String(config.timeoutMs), KLEO_AI_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens) });
    // Fixed endpoint; ignore SDK base URL overrides, disable retries and SDK logging.
    this.#client = new OpenAI({ apiKey: this.#config.apiKey, baseURL: 'https://api.openai.com/v1',
      organization: null, project: null, timeout: this.#config.timeoutMs, maxRetries: 0, logLevel: 'off',
      fetch: async (url, init) => {
        const response = await (transport ?? fetch)(url, { ...init, redirect: 'error' });
        if (!response.body) return response;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        let abortRead: () => void = () => {};
        const cancelled = new Promise<never>((_, reject) => { abortRead = () => reject(new AIProviderError('CANCELLED')); });
        init?.signal?.addEventListener('abort', abortRead, { once: true });
        try {
          if (init?.signal?.aborted) abortRead();
          while (true) {
            const { done, value } = await Promise.race([reader.read(), cancelled]);
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new AIProviderError('INVALID_RESPONSE');
            chunks.push(value);
          }
        } finally {
          init?.signal?.removeEventListener('abort', abortRead);
          void reader.cancel().catch(() => {});
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      },
    });
  }

  async generate(request: AIRequest): Promise<AIResponse> {
    let validate;
    try {
      if (!request.structuredOutput || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.structuredOutput.name) ||
          request.model !== this.#config.model || !Array.isArray(request.messages) || !request.messages.length ||
          request.messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string') ||
          JSON.stringify(request.messages).length > MAX_REQUEST_CHARS || JSON.stringify(request.messages).includes(this.#config.apiKey) ||
          (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2))) {
        throw new AIProviderError('INVALID_REQUEST');
      }
      validateExternal(request.structuredOutput.schema, () => true, { maxBytes: 32000, maxString: 8000, maxArray: 100, maxDepth: 12, maxNodes: 2000 });
      if (JSON.stringify(request.structuredOutput).includes(this.#config.apiKey)) throw new AIProviderError('INVALID_REQUEST');
      validate = new Ajv({ strict: true, allErrors: false }).compile(request.structuredOutput.schema);
    } catch { throw new AIProviderError('INVALID_REQUEST'); }
    const maxTokens = request.maxTokens ?? this.#config.maxOutputTokens;
    if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > this.#config.maxOutputTokens) throw new AIProviderError('INVALID_REQUEST');
    if (request.signal?.aborted) throw new AIProviderError('CANCELLED');
    const started = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    request.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#config.timeoutMs);
    let usage: AIUsageRecord | undefined;
    try {
      const response = await this.#client.responses.create({
        model: request.model, input: request.messages.map(({ role, content }) => ({ role, content })),
        text: { format: { type: 'json_schema', name: request.structuredOutput!.name, strict: true, schema: request.structuredOutput!.schema } },
        max_output_tokens: maxTokens, store: false,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      }, { signal: controller.signal });
      const reportedModel = typeof response.model === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(response.model) &&
        !response.model.includes(this.#config.apiKey) && !response.model.startsWith('sk-') ? response.model : request.model;
      usage = { provider: 'openai', model: reportedModel,
        timestamp: new Date().toISOString(), durationMs: Date.now() - started };
      const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      if (response.usage) {
        usage.inputTokens = tokenCount(response.usage.input_tokens);
        usage.outputTokens = tokenCount(response.usage.output_tokens);
        usage.totalTokens = tokenCount(response.usage.total_tokens);
      }
      if (response.status === 'incomplete') throw new AIProviderError('INCOMPLETE', usage);
      if (response.status !== 'completed' || !Array.isArray(response.output)) throw new AIProviderError('INVALID_RESPONSE', usage);
      const parts: string[] = [];
      for (const item of response.output) {
        if (item.type === 'reasoning') continue;
        if (item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) throw new AIProviderError('INVALID_RESPONSE', usage);
        for (const part of item.content) {
          if (part.type === 'refusal') throw new AIProviderError('REFUSAL', usage);
          if (part.type !== 'output_text' || typeof part.text !== 'string') throw new AIProviderError('INVALID_RESPONSE', usage);
          parts.push(part.text);
        }
      }
      if (parts.length !== 1) throw new AIProviderError('INVALID_RESPONSE', usage);
      if (parts[0].includes(this.#config.apiKey)) throw new AIProviderError('INVALID_RESPONSE', usage);
      let structured: unknown;
      try { structured = JSON.parse(parts[0]); } catch { throw new AIProviderError('INVALID_RESPONSE', usage); }
      if (!validate(structured)) throw new AIProviderError('INVALID_RESPONSE', usage);
      return { content: parts[0], structured, model: usage.model, usageRecord: usage,
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens } };
    } catch (error) {
      if (timedOut || error instanceof OpenAI.APIConnectionTimeoutError) throw new AIProviderError('TIMEOUT', usage);
      if (request.signal?.aborted) throw new AIProviderError('CANCELLED', usage);
      if (error instanceof AIProviderError) throw error;
      if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403)) throw new AIProviderError('AUTH', usage);
      if (error instanceof OpenAI.APIError && error.status === 429) throw new AIProviderError('RATE_LIMIT', usage);
      if (error instanceof OpenAI.APIConnectionError && error.cause instanceof AIProviderError) throw new AIProviderError(error.cause.code, usage);
      if (error instanceof OpenAI.APIConnectionError) throw new AIProviderError('NETWORK', usage);
      if (error instanceof OpenAI.APIError) throw new AIProviderError('API_ERROR', usage);
      throw new AIProviderError('INVALID_RESPONSE', usage);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', cancel);
    }
  }
}
