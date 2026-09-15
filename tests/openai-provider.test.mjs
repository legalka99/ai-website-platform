import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../.test-build/packages/ai/src/providers/openai-provider.js';
import { readOpenAIConfig } from '../.test-build/packages/ai/src/providers/config.js';
import { businessProfileSchema } from '../.test-build/packages/ai/src/agents/business-schema.js';
import { businessWire } from './fixtures/business-wire.mjs';

const testKey = 'TEST_ONLY_NOT_A_REAL_KEY';
const config = { apiKey: testKey, model: 'test-model', timeoutMs: 1000, maxOutputTokens: 1000 };
const request = () => ({ model: config.model, messages: [{ role: 'system', content: 'Extract facts' }, { role: 'user', content: 'Example' }],
  structuredOutput: { name: 'business_profile', schema: businessProfileSchema }, context: { projectId: 'local-id', goal: 'local-goal' } });
function body() {
  return { id: 'test-response', status: 'completed', model: 'test-model-snapshot',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(businessWire()), annotations: [] }] }],
    usage: { input_tokens: 30, output_tokens: 50, total_tokens: 80 } };
}
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const hasCode = code => error => { assert.equal(error.code, code); assert.ok(!String(error.stack).includes(testKey)); assert.ok(!JSON.stringify(error).includes(testKey)); return true; };

test('OpenAI SDK uses strict Responses schema, fixed endpoint, no storage/tools/extra context; returns usage', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(config, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${testKey}`);
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.input, request().messages);
    assert.equal(payload.text.format.type, 'json_schema');
    assert.equal(payload.text.format.strict, true);
    assert.deepEqual(payload.text.format.schema, businessProfileSchema);
    assert.equal(payload.max_output_tokens, 1000);
    assert.equal(payload.store, false);
    assert.equal(payload.tools, undefined);
    assert.equal(payload.metadata, undefined);
    assert.ok(!init.body.includes(testKey));
    assert.ok(!init.body.includes('local-id'));
    return response(body());
  });
  const result = await provider.generate(request());
  assert.equal(calls, 1);
  assert.deepEqual(result.structured, businessWire());
  assert.equal(result.model, 'test-model-snapshot');
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 50, totalTokens: 80 });
  assert.equal(result.usageRecord.provider, 'openai');
  assert.ok(result.usageRecord.durationMs >= 0);
  assert.ok(Number.isFinite(Date.parse(result.usageRecord.timestamp)));
  assert.ok(!JSON.stringify(provider).includes(testKey));
});

test('missing API key fails before constructing a network request', () => {
  assert.throws(() => readOpenAIConfig({}), hasCode('MISSING_API_KEY'));
  assert.throws(() => new OpenAIProvider({ ...config, apiKey: '' }), hasCode('MISSING_API_KEY'));
});
test('environment configuration has bounded defaults and rejects invalid limits/model', () => {
  assert.equal(readOpenAIConfig({ OPENAI_API_KEY: testKey, KLEO_AI_MODEL: 'test-model' }).timeoutMs, 30000);
  for (const env of [{ KLEO_AI_TIMEOUT_MS: '0' }, { KLEO_AI_TIMEOUT_MS: 'Infinity' }, { KLEO_AI_MAX_OUTPUT_TOKENS: '9000' }, { KLEO_AI_MODEL: '' }]) {
    assert.throws(() => readOpenAIConfig({ OPENAI_API_KEY: testKey, KLEO_AI_MODEL: 'test-model', ...env }), hasCode('INVALID_CONFIG'));
  }
});
for (const [status, code] of [[400, 'API_ERROR'], [401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'API_ERROR']]) {
  test(`API ${status} is sanitized and never retried`, async () => {
    let calls = 0;
    const provider = new OpenAIProvider(config, async () => {
      calls++;
      return new Response(JSON.stringify({ error: { message: testKey, type: 'api_error' } }), { status, headers: { 'content-type': 'application/json' } });
    });
    await assert.rejects(provider.generate(request()), hasCode(code));
    assert.equal(calls, 1);
  });
}
test('network failure does not leak upstream exception', async () => {
  const provider = new OpenAIProvider(config, async () => { throw new Error(testKey); });
  await assert.rejects(provider.generate(request()), hasCode('NETWORK'));
});
test('timeout aborts the actual transport', async () => {
  let aborted = false;
  const provider = new OpenAIProvider({ ...config, timeoutMs: 100 }, async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException(testKey, 'AbortError')); }, { once: true });
  }));
  await assert.rejects(provider.generate(request()), hasCode('TIMEOUT'));
  assert.equal(aborted, true);
});
test('caller cancellation aborts transport and is distinct from timeout', async () => {
  const controller = new AbortController();
  const provider = new OpenAIProvider(config, async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException(testKey, 'AbortError')), { once: true });
    controller.abort();
  }));
  await assert.rejects(provider.generate({ ...request(), signal: controller.signal }), hasCode('CANCELLED'));
});
test('already cancelled request never reaches transport', async () => {
  const controller = new AbortController(); controller.abort();
  const provider = new OpenAIProvider(config, async () => { assert.fail('Unexpected network'); });
  await assert.rejects(provider.generate({ ...request(), signal: controller.signal }), hasCode('CANCELLED'));
});
for (const [label, mutate, code] of [
  ['bad JSON', value => { value.output[0].content[0].text = '{'; }, 'INVALID_RESPONSE'],
  ['schema mismatch', value => { value.output[0].content[0].text = '{}'; }, 'INVALID_RESPONSE'],
  ['extra properties', value => { value.output[0].content[0].text = JSON.stringify({ ...businessWire(), executable: 'evil' }); }, 'INVALID_RESPONSE'],
  ['empty output', value => { value.output = []; }, 'INVALID_RESPONSE'],
  ['refusal', value => { value.output[0].content = [{ type: 'refusal', refusal: testKey }]; }, 'REFUSAL'],
  ['truncation', value => { value.status = 'incomplete'; }, 'INCOMPLETE'],
  ['upstream credential echo', value => { value.output[0].content[0].text = JSON.stringify({ ...businessWire(), notes: testKey }); }, 'INVALID_RESPONSE'],
]) test(`rejects ${label} and preserves token accounting`, async () => {
  const value = body(); mutate(value);
  const provider = new OpenAIProvider(config, async () => response(value));
  await assert.rejects(provider.generate(request()), error => { hasCode(code)(error); assert.equal(error.usage.totalTokens, 80); return true; });
});
test('missing usage stays unknown rather than invented', async () => {
  const value = body(); delete value.usage;
  const result = await new OpenAIProvider(config, async () => response(value)).generate(request());
  assert.equal(result.usageRecord.totalTokens, undefined);
});
test('invalid and oversized requests fail without transport', async () => {
  const provider = new OpenAIProvider(config, async () => { assert.fail('Unexpected network'); });
  for (const value of [{ ...request(), messages: [{ role: 'user', content: testKey }] }, { ...request(), maxTokens: 1001 }, { ...request(), model: 'another-model' }, { ...request(), structuredOutput: undefined },
    { ...request(), messages: [{ role: 'user', content: 'a'.repeat(25000) }] }]) await assert.rejects(provider.generate(value), hasCode('INVALID_REQUEST'));
});

test('rejects oversized or secret-bearing schema before transport', async () => {
  const provider = new OpenAIProvider(config, async () => assert.fail('Network must not run'));
  for (const schema of [{ type:'string', description:testKey }, { type:'string', description:'x'.repeat(33000) }]) {
    await assert.rejects(provider.generate({...request(),structuredOutput:{name:'test',schema}}),hasCode('INVALID_REQUEST'));
  }
});
test('response body size bound cancels oversized upstream stream without echoing it',async()=>{
  let cancelled=false;
  const provider = new OpenAIProvider(config,async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1048577));},cancel(){cancelled=true;}})));
  await assert.rejects(provider.generate(request()),hasCode('INVALID_RESPONSE'));assert.equal(cancelled,true);
});
test('timeout cancels a stalled response body after headers arrive',async()=>{
  let cancelled=false;
  const provider=new OpenAIProvider({...config,timeoutMs:100},async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})));
  await assert.rejects(provider.generate(request()),hasCode('TIMEOUT'));assert.equal(cancelled,true);
});
test('model config cannot accidentally contain the API credential',()=>{
  assert.throws(()=>readOpenAIConfig({OPENAI_API_KEY:testKey,KLEO_AI_MODEL:testKey}),hasCode('INVALID_CONFIG'));
});
