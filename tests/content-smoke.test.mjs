import test from 'node:test';
import assert from 'node:assert/strict';
import { runContentSmoke, parseContentSmokeArgs, contentSmokeOutput } from '../scripts/smoke-content.mjs';
import { validOutputs } from './fixtures/website.mjs';
const key='TEST_ONLY_CONTENT_SMOKE_KEY';
const env={NODE_ENV:'test',OPENAI_API_KEY:key,KLEO_AI_MODEL:'test-model',YANDEX_API_KEY:key,KLEO_YANDEX_FOLDER_ID:'test-folder',KLEO_YANDEX_MODEL:'yandexgpt/latest'};
// A missed transport injection fails locally instead of reaching the network.
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Unexpected real network call');};
test.after(()=>{globalThis.fetch=originalFetch;});
const plan=()=>{const p=validOutputs().content;p.sections[0].callToAction='Запросить расчёт';return p;};
const wire=()=>({...plan(),notes:null,sections:plan().sections.map(s=>({heading:null,text:null,points:null,callToAction:null,...s}))});
for(const provider of ['openai','yandex']) {
 test(`Content smoke parses ${provider}`,()=>assert.deepEqual(parseContentSmokeArgs([`--provider=${provider}`]),{provider,confirmed:false}));
 test(`Content smoke ${provider} opt-in uses actual service/router/adapter with offline transport`,async()=>{
  let calls=0;const lines=[];
  const exit=await runContentSmoke([`--provider=${provider}`,'--confirm-paid-request'],{loadEnvironment:()=>env,write:s=>lines.push(s),transport:async(_url,init)=>{
    calls++;const request=JSON.parse(init.body);assert.equal(request.max_tokens??request.max_output_tokens,2000);
    const schema=request.text?.format.schema??request.response_format.json_schema.schema;assert.ok(schema.properties.sections);
    assert.ok(!init.body.includes(key));assert.ok(init.body.includes('Учебный пример Kleo'));
    const body=provider==='openai'?{model:'test-model',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(wire())}]}],usage:{input_tokens:20,output_tokens:30,total_tokens:50,input_tokens_details:{cached_tokens:7}}}:
      {model:'gpt://test-folder/yandexgpt/latest',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(wire())}}],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50,prompt_tokens_details:{cached_tokens:7}}};
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json','x-request-id':'safe-request-1'}});
  }});
  assert.equal(exit,0);assert.equal(calls,1);const output=JSON.parse(lines[0]);assert.equal(output.success,true);
  assert.deepEqual(output.content,plan());assert.equal(output.provider,provider);assert.equal(output.routing.attempts.length,1);
  assert.equal(output.budget.requests,1);assert.equal(output.budget.maxRequests,1);assert.equal(output.usage.cachedInputTokens,7);
  assert.equal(output.usage.actorId,'local-owner');assert.equal(output.usage.organizationId,'local');assert.equal(output.usage.agentType,'content');
  assert.equal(output.routing.attempts[0].usage.cachedInputTokens,7);assert.equal(output.requestId,'safe-request-1');
  for(const forbidden of [key,'Authorization','SecretProvider','You are the Kleo','Учебный пример Kleo','OPENAI_API_KEY','[CIRCULAR]','stack']) assert.ok(!lines[0].includes(forbidden));
 });
}
test('Content smoke opt-in gate precedes env/config/transport access',async()=>{
 let accessed=0;const exit=await runContentSmoke([],{loadEnvironment:()=>{accessed++;throw Error();},transport:async()=>{accessed++;throw Error();},write:()=>{}});
 assert.equal(exit,1);assert.equal(accessed,0);
});
for(const args of [['--provider=unknown','--confirm-paid-request'],['--provider=openai','--provider=yandex','--confirm-paid-request'],['--allow-fallback','--confirm-paid-request']]) test('invalid smoke args rejected before environment/network',async()=>{
 let accessed=0;const exit=await runContentSmoke(args,{loadEnvironment:()=>{accessed++;return env;},write:()=>{},transport:async()=>{accessed++;throw Error();}});
 assert.equal(exit,1);assert.equal(accessed,0);
});
test('malformed smoke config gives controlled error without provider call or secret output',async()=>{
 const lines=[];let calls=0;
 const exit=await runContentSmoke(['--confirm-paid-request'],{loadEnvironment:()=>({...env,KLEO_AI_TIMEOUT_MS:'bad'}),write:s=>lines.push(s),transport:async()=>{calls++;throw Error(key);}});
 assert.equal(exit,1);assert.equal(calls,0);assert.ok(!lines.join('').includes(key));assert.ok(!lines.join('').includes('stack'));
});
test('projection omits arbitrary sensitive metadata and detaches repeated references',()=>{
 const usage={provider:'openai',model:'test-model',timestamp:'2026-09-15T00:00:00Z',durationMs:1,totalTokens:2,requestId:key,headers:{Authorization:key},prompt:'PRIVATE_PROMPT',env:'PRIVATE_ENV',raw:'PRIVATE_RAW'};
 usage.circular=usage;
 const result={success:true,output:validOutputs().content,execution:{usage,goal:'PRIVATE_PROMPT',routing:{decision:{provider:'openai',model:'test-model',fallbackProviders:[],headers:usage.headers},attempts:[{provider:'openai',outcome:'success',usage}]},budget:{requests:1,prompt:'PRIVATE_PROMPT'}}};
 const output=contentSmokeOutput(result,{projectId:'project-1',workflowId:'run-1'},'openai','test-model',[key]);
 for(const forbidden of [key,'Authorization','PRIVATE_','[CIRCULAR]','headers','prompt','circular'])assert.ok(!output.includes(forbidden));
 assert.equal(JSON.parse(output).usage.totalTokens,2);assert.equal(usage.requestId,key);
});
test('malformed output is never displayed as a ContentDirection',()=>{
 const output=JSON.parse(contentSmokeOutput({success:true,output:{notes:'PRIVATE_RAW'}},{projectId:'p',workflowId:'w'},'openai','test-model'));
 assert.equal(output.success,false);assert.equal(output.content,undefined);
});
test('smoke transient error has one bounded attempt and sanitized diagnostics',async()=>{
 let calls=0;const lines=[];
 const exit=await runContentSmoke(['--provider=yandex','--confirm-paid-request'],{loadEnvironment:()=>env,write:s=>lines.push(s),transport:async()=>{calls++;return new Response(key,{status:503});}});
 assert.equal(exit,1);assert.equal(calls,1);const result=JSON.parse(lines[0]);assert.equal(result.routing.attempts.length,1);assert.ok(!lines[0].includes(key));
});

test('cached token projection permits only nonnegative integer counts through redaction',()=>{
 for(const value of ['PRIVATE_SECRET',-1,1.5]) {
  const output=contentSmokeOutput({success:false,execution:{usage:{cachedInputTokens:value}}},{projectId:'p',workflowId:'w'},'openai','test-model');
  assert.ok(!output.includes('PRIVATE_SECRET'));assert.notEqual(JSON.parse(output).usage.cachedInputTokens,value);
 }
});
