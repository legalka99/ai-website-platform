import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutedBusinessService } from '../.test-build/packages/ai/src/services/routed-business-service.js';
import { FakeProvider } from '../.test-build/packages/ai/src/providers/fake-provider.js';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readRouterPolicy } from '../.test-build/packages/ai/src/router/policy.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard, DEFAULT_AI_LIMITS, redact } from '../.test-build/packages/security/src/index.js';
import { businessContext,businessWire } from './fixtures/business-wire.mjs';
const ctx={projectId:'project-1',organizationId:'org-1',workflowId:'run-1',actor:{id:'owner',authenticated:true}};
const auth=new AuthorizationPolicy([{...ctx,actorId:'owner',role:'owner'}]);
const key='TEST_ONLY_ROUTER_KEY';
function options(primary='yandex',failure,wire=businessWire()) {
 const counts={yandex:0,openai:0};
 const providers=['yandex','openai'].map(id=>({id,credentials:{id:`cred-${id}`,provider:id,projectId:ctx.projectId,organizationId:ctx.organizationId,secretRef:`local/${id}`},
  config:{model:id==='yandex'?'gpt://test-folder/yandexgpt/latest':'test-model',folderId:'test-folder',timeoutMs:1000,maxOutputTokens:1000},
  testAdapter:new FakeProvider(req=>{counts[id]++;assert.ok(!JSON.stringify(req).includes(key));assert.notEqual(req.model,'route');if(id===primary&&failure)throw failure;return {content:JSON.stringify(wire),structured:wire,model:req.model,usageRecord:{provider:id,model:req.model,timestamp:new Date().toISOString(),durationMs:1,totalTokens:30}};})}));
 return {counts,providers,context:ctx,authorization:auth,costs:new AICostGuard(),secrets:new LocalSecretProvider(providers.map(p=>({...p.credentials,value:key})),'test'),policy:readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:primary,KLEO_AI_FALLBACK_PROVIDER:primary==='yandex'?'openai':'yandex'})};
}
for(const primary of ['openai','yandex'])test(`Business service -> router -> guarded fake ${primary}`,async()=>{
 const opts=options(primary);const agent=await createRoutedBusinessService(opts);assert.equal(agent.model,'route');const result=await agent.run(businessContext());assert.equal(result.success,true);assert.equal(result.execution.usage.provider,primary);assert.equal(result.execution.usage.projectId,ctx.projectId);assert.equal(result.execution.usage.workflowId,ctx.workflowId);assert.equal(result.execution.routing.attempts.length,1);assert.ok(!JSON.stringify(result).includes(key));
});
test('Business fallback preserves primary usage and accounts for both attempts',async()=>{
 const opts=options('yandex',new AIProviderError('TIMEOUT',{provider:'yandex',model:'gpt://test-folder/yandexgpt/latest',totalTokens:10,timestamp:new Date().toISOString(),durationMs:100}));const result=await (await createRoutedBusinessService(opts)).run(businessContext());assert.equal(result.success,true);assert.equal(result.execution.usage.provider,'openai');assert.equal(result.execution.routing.attempts[0].usage.totalTokens,10);assert.equal(result.execution.routing.attempts[0].usage.projectId,ctx.projectId);assert.equal(result.execution.budget.requests,2);assert.equal(result.execution.budget.reservedOutputTokens,2000);
});
test('Business incomplete contract does not fallback',async()=>{
 const opts=options('yandex',undefined,{...businessWire(),industry:null});const result=await (await createRoutedBusinessService(opts)).run(businessContext());assert.equal(result.success,false);assert.equal(result.errorCode,'VALIDATION_FAILED');assert.equal(opts.counts.openai,0);
});
test('project A cannot use project B Yandex reference or scoped store value',async()=>{
 const opts=options();opts.providers[0].credentials.projectId='project-B';await assert.rejects(createRoutedBusinessService(opts),e=>e.code==='ACCESS_DENIED');assert.equal(opts.counts.yandex,0);
 const forged=options();forged.secrets=new LocalSecretProvider(forged.providers.map(p=>({...p.credentials,projectId:'project-B',value:key})),'test');await assert.rejects(createRoutedBusinessService(forged),e=>e.code==='AUTH');
});
test('budget-denied fallback retains prior attempt diagnostic without a second API call',async()=>{
 const opts=options('yandex',new AIProviderError('NETWORK'));opts.costs=new AICostGuard({...DEFAULT_AI_LIMITS,maxRequestsPerWorkflow:1});const result=await(await createRoutedBusinessService(opts)).run(businessContext());assert.equal(result.success,false);assert.equal(result.errorCode,'LIMIT_EXCEEDED');assert.equal(opts.counts.openai,0);assert.equal(result.execution.routing.attempts.length,1);
});

for (const primary of ['openai','yandex']) test(`smoke usage snapshot serializes safely for ${primary} success and failure`,async()=>{
 for (const fails of [false,true]) {
  const opts=options(primary);
  const usage={provider:primary,model:'test-model',timestamp:'2026-09-15T00:00:00Z',durationMs:10,inputTokens:10,outputTokens:20,totalTokens:30,
   requestId:key,apiKey:key,prompt:'PRIVATE_TEST_PROMPT',headers:{Authorization:`Bearer ${key}`},rawProviderData:{private:'PRIVATE_TEST_DATA'}};
  opts.providers.find(p=>p.id===primary).testAdapter=new FakeProvider(()=>{
   if(fails)throw new AIProviderError('AUTH',usage);
   return {content:JSON.stringify(businessWire()),structured:businessWire(),model:'test-model',usageRecord:usage};
  });
  const result=await(await createRoutedBusinessService(opts)).run(businessContext());
  assert.equal(result.success,!fails);
  const snapshot=result.execution.routing.attempts[0].usage;
  assert.notStrictEqual(snapshot,result.execution.usage);
  assert.equal(result.execution.usage.totalTokens,30);
  assert.equal(snapshot.totalTokens,30);
  assert.equal(snapshot.projectId,ctx.projectId);
  assert.equal(snapshot.workflowId,ctx.workflowId);
  for(const field of ['apiKey','prompt','headers','rawProviderData'])assert.equal(Object.hasOwn(snapshot,field),false);
  // Same shape/redaction/serialization used by both smoke output branches.
  const output=JSON.stringify(redact({usage:result.execution.usage,routing:result.execution.routing,budget:result.execution.budget},[key]));
  assert.ok(!output.includes('[CIRCULAR]'));
  assert.ok(!output.includes(key));
  const safe=JSON.parse(output).routing.attempts[0].usage;
  assert.equal(safe.totalTokens,30);
  assert.equal(safe.requestId,'[REDACTED]');
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_TEST'));
  assert.equal(usage.requestId,key); // Neither source accounting nor redaction input was mutated.
 }
});
test('fallback smoke has independent usage snapshots for every attempt',async()=>{
 const opts=options('yandex',new AIProviderError('TIMEOUT',{provider:'yandex',model:'test-model',timestamp:'2026-09-15T00:00:00Z',durationMs:100,totalTokens:10}));
 const result=await(await createRoutedBusinessService(opts)).run(businessContext());
 const output=JSON.stringify(redact({usage:result.execution.usage,routing:result.execution.routing,budget:result.execution.budget},[key]));
 assert.ok(!output.includes('[CIRCULAR]'));
 assert.deepEqual(JSON.parse(output).routing.attempts.map(a=>a.usage.totalTokens),[10,30]);
 assert.equal(result.execution.budget.requests,2);
 assert.equal(result.execution.budget.reservedOutputTokens,2000);
});
