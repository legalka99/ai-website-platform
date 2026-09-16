import test from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { runQASmoke,parseQASmokeArgs,qaSmokeInput,qaSmokeOutput } from '../scripts/smoke-qa.mjs';
import { qaWire as layout } from './fixtures/qa.mjs';
const key='TEST_ONLY_DEVELOPER_SMOKE';
const env={NODE_ENV:'test',OPENAI_API_KEY:key,YANDEX_API_KEY:key,KLEO_AI_MODEL:'test-model',KLEO_YANDEX_FOLDER_ID:'test-folder',KLEO_YANDEX_MODEL:'yandexgpt/latest'};
const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Real network forbidden');};test.after(()=>{globalThis.fetch=original;});
const response=(provider,proposal)=>provider==='openai'?{model:'test-model',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(proposal)}]}],usage:{input_tokens:10,output_tokens:20,total_tokens:30,input_tokens_details:{cached_tokens:2}}}:
 {model:'gpt://test-folder/yandexgpt/latest',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,prompt_tokens_details:{cached_tokens:2}}};
for(const provider of ['openai','yandex'])test(`QA smoke ${provider}: actual adapter validates layout schema and safe summary`,async()=>{
 let calls=0;const lines=[];
 const code=await runQASmoke([`--provider=${provider}`,'--confirm-paid-request'],{loadEnvironment:()=>env,write:s=>lines.push(s),transport:async(_url,init)=>{
  calls++;const request=JSON.parse(init.body),schema=request.text?.format.schema??request.response_format.json_schema.schema,proposal=layout();
  assert.equal(new Ajv({strict:true}).compile(schema)(proposal),true);assert.equal(request.max_tokens??request.max_output_tokens,2000);assert.ok(!init.body.includes(key));
  return new Response(JSON.stringify(response(provider,proposal)),{headers:{'content-type':'application/json','x-request-id':'safe-request'}});
 }});
 assert.equal(code,0);assert.equal(calls,1);const r=JSON.parse(lines[0]);assert.equal(r.success,true);assert.equal(r.qa.passed,true);assert.equal(r.qa.issueCount,0);
 assert.equal(r.budget.requests,1);assert.equal(r.budget.maxRequests,1);assert.equal(r.routing.attempts.length,1);assert.equal(r.routing.attempts[0].usage.cachedInputTokens,2);
 for(const [k,v] of Object.entries({provider,agentType:'qa',projectId:'kleo-qa-smoke',organizationId:'local',actorId:'local-owner',inputTokens:10,outputTokens:20,totalTokens:30,cachedInputTokens:2}))assert.equal(r.usage[k],v);
 for(const marker of [key,'Authorization','You are the Kleo','SecretProvider','[CIRCULAR]','headingFont','sectionIndex'])assert.ok(!lines[0].includes(marker));
});
for(const args of [[],['--provider=other','--confirm-paid-request'],['--provider=yandex','--provider=openai','--confirm-paid-request'],['--allow-fallback','--confirm-paid-request']])test('QA smoke denies missing opt-in and invalid flags before environment or transport',async()=>{
 let accessed=0;const code=await runQASmoke(args,{loadEnvironment:()=>{accessed++;return env;},transport:async()=>{accessed++;throw Error();},write:()=>{}});assert.equal(code,1);assert.equal(accessed,0);
});
test('QA smoke parsing and malformed config are safe',async()=>{
 assert.deepEqual(parseQASmokeArgs(['--provider=yandex']),{provider:'yandex',confirmed:false});const lines=[];let calls=0;
 assert.equal(await runQASmoke(['--confirm-paid-request'],{loadEnvironment:()=>({...env,KLEO_AI_TIMEOUT_MS:'bad'}),transport:async()=>{calls++;throw Error(key);},write:s=>lines.push(s)}),1);assert.equal(calls,0);assert.ok(!lines.join('').includes(key));
});
for(const provider of ['openai','yandex'])for(const kind of ['extra','order','secret','oversize','network'])test(`QA smoke ${provider} rejects ${kind} with one bounded attempt`,async()=>{
 let calls=0;const lines=[];
 const code=await runQASmoke([`--provider=${provider}`,'--confirm-paid-request'],{loadEnvironment:()=>env,write:s=>lines.push(s),transport:async()=>{
  calls++;if(kind==='network')throw Error(key);
  const p=layout();if(kind==='extra')p.projectId='PRIVATE_OTHER_PROJECT';if(kind==='order'){p.issues=layout(false).issues;p.passed=true;}if(kind==='secret')p.extra=key;if(kind==='oversize')p.extra='a'.repeat(1050000);
  return new Response(JSON.stringify(response(provider,p)),{headers:{'content-type':'application/json'}});
 }});
 assert.equal(code,1);assert.equal(calls,1);const r=JSON.parse(lines[0]);assert.equal(r.success,false);assert.equal(r.website,undefined);assert.equal(r.routing.attempts.length,1);
 if(kind==='order'){assert.deepEqual(r.validationError,{stage:'qa-consistency',path:'passed',rule:'PASS_WITH_BLOCKING_ISSUE'});assert.equal(r.usage.totalTokens,30);assert.equal(r.routing.attempts[0].outcome,'success');}
 for(const marker of [key,'PRIVATE_OTHER_PROJECT','[CIRCULAR]','Authorization'])assert.ok(!lines[0].includes(marker));
});
test('QA summary refuses malformed success and unsafe diagnostic properties',()=>{
 let reads=0;const website={};Object.defineProperty(website,'name',{get(){reads++;return key;}});
 const r=JSON.parse(qaSmokeOutput({success:true,output:{website}},{projectId:'p',workflowId:'w'},'openai','test-model'));
 assert.equal(r.success,false);assert.equal(r.website,undefined);assert.equal(reads,0);
 const line=qaSmokeOutput({success:false,validationError:{stage:'qa-schema',path:'$',rule:'SCHEMA_INVALID',match:key,headers:key}},{projectId:'p',workflowId:'w'},'openai','test-model');assert.ok(!line.includes(key));assert.equal(JSON.parse(line).validationError.rule,'SCHEMA_INVALID');
});
test('QA summary detaches usage references and excludes raw payloads',()=>{
 const usage={provider:'openai',model:'test-model',timestamp:'2026-09-16T00:00:00.000Z',durationMs:1,totalTokens:30,raw:key,headers:{Authorization:key}};usage.circular=usage;
 const out={passed:true,score:90,issues:[],checkedAt:new Date().toISOString()};
 const result={success:true,output:out,execution:{usage,prompt:key,routing:{decision:{provider:'openai',fallbackProviders:[]},attempts:[{provider:'openai',outcome:'success',usage}]}}};
 const line=qaSmokeOutput(result,{projectId:'project-1',workflowId:'w'},'openai','test-model',[key]);assert.equal(JSON.parse(line).success,true);assert.equal(JSON.parse(line).usage.totalTokens,30);
 for(const marker of [key,'Authorization','[CIRCULAR]','circular','raw'])assert.ok(!line.includes(marker));
});

for(const provider of ['openai','yandex'])test(`QA smoke ${provider} timeout aborts transport without retry`,async()=>{
 let calls=0;const lines=[];
 const code=await runQASmoke([`--provider=${provider}`,'--confirm-paid-request'],{loadEnvironment:()=>({...env,KLEO_AI_TIMEOUT_MS:'100',KLEO_YANDEX_TIMEOUT_MS:'100'}),write:s=>lines.push(s),transport:async(_url,init)=>{
  calls++;return new Promise((_,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});});
 }});
 assert.equal(code,1);assert.equal(calls,1);const r=JSON.parse(lines[0]);assert.equal(r.errorCode,'TIMEOUT');assert.equal(r.website,undefined);assert.equal(r.routing.attempts.length,1);
});
for(const provider of ['openai','yandex'])test(`QA smoke ${provider} distinguishes valid FAIL from technical failure`,async()=>{
 const lines=[];let calls=0;const code=await runQASmoke([`--provider=${provider}`,'--confirm-paid-request'],{loadEnvironment:()=>env,write:s=>lines.push(s),transport:async()=>{calls++;return new Response(JSON.stringify(response(provider,layout(false))),{headers:{'content-type':'application/json'}});}});
 assert.equal(code,1);assert.equal(calls,1);const r=JSON.parse(lines[0]);assert.equal(r.success,true);assert.equal(r.qa.passed,false);assert.equal(r.qa.severities.error,1);assert.equal(r.errorCode,undefined);assert.equal(r.usage.totalTokens,30);assert.ok(!lines[0].includes('Content needs review'));
});
