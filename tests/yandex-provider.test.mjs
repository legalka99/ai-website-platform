import test from 'node:test';
import assert from 'node:assert/strict';
import { YandexProvider } from '../.test-build/packages/ai/src/providers/yandex-provider.js';
import { readYandexConfig } from '../.test-build/packages/ai/src/providers/yandex-config.js';
import { businessProfileSchema } from '../.test-build/packages/ai/src/agents/business-schema.js';
import { businessWire } from './fixtures/business-wire.mjs';
const key='TEST_ONLY_YANDEX_KEY';
const config={apiKey:key,folderId:'test-folder',model:'gpt://test-folder/yandexgpt/latest',timeoutMs:1000,maxOutputTokens:1000};
const req=()=>({model:config.model,messages:[{role:'user',content:'Test business'}],structuredOutput:{name:'business',schema:businessProfileSchema},context:{projectId:'PRIVATE_CONTEXT',goal:'local'}});
const body=()=>({model:config.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(businessWire())}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json','x-request-id':'test-request-id'}});
const errorCode=code=>error=>{assert.equal(error.code,code);assert.ok(!String(error.stack).includes(key));assert.ok(!JSON.stringify(error).includes(key));return true;};
test('Yandex sends documented schema/auth/project headers to fixed HTTPS endpoint; usage normalized',async()=>{
 let calls=0;const provider=new YandexProvider(config,async(url,init)=>{calls++;assert.equal(url,'https://ai.api.cloud.yandex.net/v1/chat/completions');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,`Api-Key ${key}`);assert.equal(init.headers['OpenAI-Project'],'test-folder');assert.equal(init.headers['x-data-logging-enabled'],'false');const wire=JSON.parse(init.body);assert.deepEqual(wire.response_format,{type:'json_schema',json_schema:{name:'business',schema:businessProfileSchema}});assert.equal(wire.store,false);assert.equal(wire.stream,false);assert.equal(wire.max_tokens,1000);assert.equal(wire.tools,undefined);assert.ok(!init.body.includes(key));assert.ok(!init.body.includes('PRIVATE_CONTEXT'));return response(body());});
 const result=await provider.generate(req());assert.equal(calls,1);assert.equal(result.usageRecord.provider,'yandex');assert.equal(result.usageRecord.totalTokens,30);assert.equal(result.usageRecord.requestId,'test-request-id');assert.ok(Number.isFinite(Date.parse(result.usageRecord.timestamp)));assert.ok(result.usageRecord.durationMs>=0);assert.deepEqual(result.structured,businessWire());assert.equal(JSON.stringify(provider),'{}');
});
for(const [status,code] of [[400,'API_ERROR'],[401,'AUTH'],[403,'AUTH'],[429,'RATE_LIMIT'],[500,'API_ERROR'],[503,'API_ERROR']]) test(`Yandex ${status} sanitized without retries`,async()=>{
 let calls=0;const provider=new YandexProvider(config,async()=>{calls++;return new Response(JSON.stringify({error:`Authorization: Api-Key ${key}`}),{status});});await assert.rejects(provider.generate(req()),error=>{errorCode(code)(error);assert.equal(error.diagnostic?.transient,status>=500?true:undefined);return true;});assert.equal(calls,1);
});
for(const [name,mutate,code] of [
 ['invalid JSON',b=>{b.choices[0].message.content='{';},'INVALID_RESPONSE'],['schema mismatch',b=>{b.choices[0].message.content='{}';},'INVALID_RESPONSE'],
 ['empty',b=>{b.choices[0].message.content='';},'INVALID_RESPONSE'],['malformed',b=>{b.choices={};},'INVALID_RESPONSE'],
 ['extra choices',b=>{b.choices.push(b.choices[0]);},'INVALID_RESPONSE'],['truncated',b=>{b.choices[0].finish_reason='length';},'INCOMPLETE'],
 ['tool call',b=>{b.choices[0].message.tool_calls=[{function:'evil'}];},'INVALID_RESPONSE'],['credential echo',b=>{b.choices[0].message.content=JSON.stringify({...businessWire(),notes:key});},'INVALID_RESPONSE'],
 ['escaped credential echo',b=>{b.choices[0].message.content=JSON.stringify({...businessWire(),notes:key}).replace(key,key.split('').map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));},'INVALID_RESPONSE'],
 ['refusal',b=>{b.choices[0].message.refusal=key;},'REFUSAL']
]) test(`Yandex rejects ${name}`,async()=>{const b=body();mutate(b);await assert.rejects(new YandexProvider(config,async()=>response(b)).generate(req()),errorCode(code));});
test('Yandex rejects malformed response envelope',async()=>{for(const text of ['{','null','[]'])await assert.rejects(new YandexProvider(config,async()=>new Response(text)).generate(req()),errorCode('INVALID_RESPONSE'));});
test('Yandex network exceptions sanitized',async()=>{await assert.rejects(new YandexProvider(config,async()=>{throw new Error(key);}).generate(req()),errorCode('NETWORK'));});
test('Yandex timeout aborts transport and ends stalled body',async()=>{
 let signal;await assert.rejects(new YandexProvider({...config,timeoutMs:100},async(_,init)=>{signal=init.signal;return new Response(new ReadableStream());}).generate(req()),errorCode('TIMEOUT'));assert.equal(signal.aborted,true);
});
test('Yandex caller cancellation is not timeout; pre-cancel sends nothing',async()=>{
 const controller=new AbortController();const provider=new YandexProvider(config,async()=>{controller.abort();return new Response(new ReadableStream());});await assert.rejects(provider.generate({...req(),signal:controller.signal}),errorCode('CANCELLED'));
 await assert.rejects(new YandexProvider(config,async()=>assert.fail('network')).generate({...req(),signal:controller.signal}),errorCode('CANCELLED'));
});
test('Yandex oversized request/schema, invalid model/tokens and key-bearing input rejected before transport',async()=>{
 const p=new YandexProvider(config,async()=>assert.fail('network'));
 for(const patch of [{messages:[{role:'user',content:'x'.repeat(70000)}]},{messages:[{role:'user',content:key}]},{model:'gpt://other/yandexgpt/latest'},{maxTokens:1001},{structuredOutput:{name:'x',schema:{description:'x'.repeat(33000)}}}])await assert.rejects(p.generate({...req(),...patch}),errorCode('INVALID_REQUEST'));
});
test('Yandex oversized response is cancelled',async()=>{
 let cancelled=false;await assert.rejects(new YandexProvider(config,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1048577));},cancel(){cancelled=true;}}))).generate(req()),errorCode('INVALID_RESPONSE'));assert.equal(cancelled,true);
});
test('Yandex missing key, folder and invalid model config fail safely',()=>{
 assert.throws(()=>readYandexConfig({}),errorCode('YANDEX_MISSING_API_KEY'));assert.throws(()=>readYandexConfig({YANDEX_API_KEY:key}),errorCode('YANDEX_MISSING_FOLDER'));
 for(const model of ['', 'gpt://other/yandexgpt/latest','https://evil.example/model',key])assert.throws(()=>readYandexConfig({YANDEX_API_KEY:key,KLEO_YANDEX_FOLDER_ID:'test-folder',KLEO_YANDEX_MODEL:model}),errorCode('INVALID_CONFIG'));
 assert.equal(readYandexConfig({YANDEX_API_KEY:key,KLEO_YANDEX_FOLDER_ID:'test-folder',KLEO_YANDEX_MODEL:'yandexgpt/latest'}).model,config.model);
});
test('Yandex missing/invalid usage remains unknown and malicious request ID discarded',async()=>{
 const b=body();b.usage={prompt_tokens:-1,completion_tokens:'20'};const result=await new YandexProvider(config,async()=>new Response(JSON.stringify(b),{headers:{'x-request-id':key}})).generate(req());assert.equal(result.usageRecord.inputTokens,undefined);assert.equal(result.usageRecord.totalTokens,undefined);assert.equal(result.usageRecord.requestId,undefined);
 delete b.usage;assert.equal((await new YandexProvider(config,async()=>response(b)).generate(req())).usageRecord.totalTokens,undefined);
});

test('Yandex network failure while reading response remains a safe network error',async()=>{
 await assert.rejects(new YandexProvider(config,async()=>new Response(new ReadableStream({start(c){c.error(new Error(key));}}))).generate(req()),errorCode('NETWORK'));
});

test('Yandex network failure preserves timing with unknown tokens',async()=>{
 await assert.rejects(new YandexProvider(config,async()=>{throw Error();}).generate(req()),error=>{
  assert.equal(error.usage.provider,'yandex');assert.ok(error.usage.durationMs>=0);assert.equal(error.usage.totalTokens,undefined);return true;
 });
});
test('Yandex invalid cached tokens remain unknown',async()=>{
 const b=body();b.usage.prompt_tokens_details={cached_tokens:'7'};
 assert.equal((await new YandexProvider(config,async()=>response(b)).generate(req())).usageRecord.cachedInputTokens,undefined);
});
