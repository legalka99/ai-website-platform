import { Ajv } from 'ajv';
import type { AIProvider, AIRequest, AIResponse, AIUsageRecord } from '../provider.js';
import { AIProviderError } from './errors.js';
import { readYandexConfig, type YandexProviderConfig } from './yandex-config.js';
import { validateExternal } from '../../../security/src/validation.js';
import { containsSecret } from '../../../security/src/redaction.js';
const ENDPOINT = 'https://ai.api.cloud.yandex.net/v1/chat/completions';
export class YandexProvider implements AIProvider {
  #config: YandexProviderConfig; #fetch: typeof fetch;
  constructor(config: YandexProviderConfig, transport: typeof fetch = fetch) {
    this.#config = readYandexConfig({ YANDEX_API_KEY: config.apiKey, KLEO_YANDEX_FOLDER_ID: config.folderId, KLEO_YANDEX_MODEL: config.model,
      KLEO_YANDEX_TIMEOUT_MS: String(config.timeoutMs), KLEO_YANDEX_MAX_OUTPUT_TOKENS: String(config.maxOutputTokens) });
    this.#fetch = transport;
  }
  async generate(request: AIRequest): Promise<AIResponse> {
    const config = this.#config;
    let body: string, validate;
    const tokens = request.maxTokens ?? config.maxOutputTokens;
    try {
      if (request.model !== config.model || !request.structuredOutput || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.structuredOutput.name) ||
        !Array.isArray(request.messages) || !request.messages.length || request.messages.some(m => !['system','user','assistant'].includes(m.role) || typeof m.content !== 'string') ||
        !Number.isInteger(tokens) || tokens < 128 || tokens > config.maxOutputTokens ||
        request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 1)) throw 0;
      validateExternal(request.messages, () => true, {maxBytes:48000,maxString:24000,maxArray:50,maxDepth:4,maxNodes:300});
      validateExternal(request.structuredOutput.schema, () => true, {maxBytes:32000,maxString:8000,maxArray:100,maxDepth:12,maxNodes:2000});
      validate = new Ajv({strict:true}).compile(request.structuredOutput.schema);
      body = JSON.stringify({ model: config.model, messages: request.messages.map(({role,content}) => ({role,content})),
        response_format: { type: 'json_schema', json_schema: {name:request.structuredOutput.name,schema:request.structuredOutput.schema} },
        max_tokens:tokens, stream:false, store:false, ...(request.temperature === undefined ? {} : {temperature:request.temperature}) });
      if (Buffer.byteLength(body) > 64000 || body.includes(config.apiKey)) throw 0;
    } catch { throw new AIProviderError('INVALID_REQUEST'); }
    if (request.signal?.aborted) throw new AIProviderError('CANCELLED');
    const started = Date.now(), controller = new AbortController();
    let timedOut = false;
    let usage: AIUsageRecord = {provider:'yandex',model:config.model,timestamp:new Date(started).toISOString(),durationMs:0};
    let rejectAbort: (error: AIProviderError) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const cancel = () => { controller.abort(); rejectAbort(new AIProviderError('CANCELLED')); };
    request.signal?.addEventListener('abort',cancel,{once:true});
    const timer = setTimeout(() => { timedOut=true; cancel(); },config.timeoutMs);
    const operation = async (): Promise<AIResponse> => {
      let response: Response;
      try { response = await this.#fetch(ENDPOINT, {method:'POST',redirect:'error',signal:controller.signal,
        headers:{'Content-Type':'application/json','Authorization':`Api-Key ${config.apiKey}`,'OpenAI-Project':config.folderId,'x-data-logging-enabled':'false'},body}); }
      catch { throw new AIProviderError('NETWORK',usage); }
      const rawId = response.headers.get('x-request-id');
      const requestId = rawId && /^[a-zA-Z0-9_-]{1,128}$/.test(rawId) && !containsSecret(rawId,[config.apiKey]) ? rawId : undefined;
      usage = {provider:'yandex',model:config.model,timestamp:new Date(started).toISOString(),durationMs:Date.now()-started,...(requestId ? {requestId} : {})};
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const code = response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 429 ? 'RATE_LIMIT' : 'API_ERROR';
        throw new AIProviderError(code,usage,response.status >= 500 && response.status <= 599 ? {transient:true} : undefined);
      }
      if (!response.body) throw new AIProviderError('INVALID_RESPONSE',usage);
      const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
      try {
        while (true) {
          const {done,value}=await Promise.race([reader.read(),aborted]); if(done) break;
          size+=value.byteLength; if(size>1048576) throw new AIProviderError('INVALID_RESPONSE',usage); chunks.push(value);
        }
      } catch (error) { if(error instanceof AIProviderError) throw error; throw new AIProviderError('NETWORK',usage); }
      finally { void reader.cancel().catch(() => {}); }
      let data;
      try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AIProviderError('INVALID_RESPONSE',usage); }
      if (!data || typeof data !== 'object') throw new AIProviderError('INVALID_RESPONSE',usage);
      const count=(n:unknown) => typeof n==='number' && Number.isSafeInteger(n) && n>=0 ? n : undefined;
      usage.durationMs=Date.now()-started;
      usage.inputTokens=count(data.usage?.prompt_tokens); usage.outputTokens=count(data.usage?.completion_tokens); usage.totalTokens=count(data.usage?.total_tokens);
      usage.cachedInputTokens=count(data.usage?.prompt_tokens_details?.cached_tokens);
      // Only accept a reported model belonging to this folder; never return arbitrary upstream strings.
      if (typeof data.model==='string' && data.model===config.model) usage.model=data.model;
      if (!Array.isArray(data.choices) || data.choices.length!==1) throw new AIProviderError('INVALID_RESPONSE',usage);
      const choice=data.choices[0];
      if (choice?.finish_reason==='length') throw new AIProviderError('INCOMPLETE',usage);
      if (choice?.message?.refusal || choice?.finish_reason==='content_filter') throw new AIProviderError('REFUSAL',usage);
      const content=choice?.message?.content;
      if (choice?.finish_reason!=='stop' || choice.message?.role!=='assistant' || choice.message.tool_calls?.length || choice.message.function_call || typeof content!=='string' || !content.trim() || containsSecret(content,[config.apiKey])) throw new AIProviderError('INVALID_RESPONSE',usage);
      let structured: unknown;
      try { structured=JSON.parse(content); if(containsSecret(JSON.stringify(structured),[config.apiKey])) throw 0; validateExternal(structured,validate); } catch { throw new AIProviderError('INVALID_RESPONSE',usage); }
      return {content,structured,model:usage.model,usageRecord:usage,usage:{inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,totalTokens:usage.totalTokens}};
    };
    try { return await Promise.race([operation(),aborted]); }
    catch(error) {
      usage.durationMs=Date.now()-started;
      if(timedOut) throw new AIProviderError('TIMEOUT',usage);
      if(request.signal?.aborted) throw new AIProviderError('CANCELLED',usage);
      if(error instanceof AIProviderError) throw error;
      throw new AIProviderError('INVALID_RESPONSE',usage);
    } finally { clearTimeout(timer); request.signal?.removeEventListener('abort',cancel); }
  }
}
