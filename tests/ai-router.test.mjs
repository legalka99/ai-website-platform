import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRouter, permitsFallback } from '../.test-build/packages/ai/src/router/ai-router.js';
import { readRouterPolicy, textCapabilities } from '../.test-build/packages/ai/src/router/policy.js';
import { ProviderHealthTracker } from '../.test-build/packages/ai/src/router/health.js';
import { GuardedAIProvider } from '../.test-build/packages/ai/src/services/guarded-provider.js';
import { FakeProvider } from '../.test-build/packages/ai/src/providers/fake-provider.js';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { AuthorizationPolicy, AICostGuard, DEFAULT_AI_LIMITS, SecurityError } from '../.test-build/packages/security/src/index.js';
const context={projectId:'p1',organizationId:'o1',workflowId:'w1',actor:{id:'u1',authenticated:true}};
const auth=new AuthorizationPolicy([{...context,actorId:'u1',role:'owner'}]);
const request=()=>({model:'route',messages:[{role:'user',content:'test'}],context:{projectId:'p1',goal:'test'}});
const policy=()=>readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:'yandex',KLEO_AI_FALLBACK_PROVIDER:'openai'});
function setup(options={}) {
 const counts={yandex:0,openai:0};const costs=options.costs??new AICostGuard();
 const bindings=['yandex','openai'].map(id=>({metadata:{id,model:`${id}-test-model`,capabilities:{...textCapabilities(1000),...(options.caps?.[id]??{})}},provider:new GuardedAIProvider(new FakeProvider(async req=>{counts[id]++;if(options.errors?.[id])throw options.errors[id];return {model:req.model,content:'{}',usageRecord:{provider:id,model:req.model,inputTokens:1,outputTokens:2,totalTokens:3,timestamp:new Date().toISOString(),durationMs:1}};}),context,auth,costs,1000)}));
 return {router:new AIRouter(bindings,options.policy??policy(),'business',options.health),counts,costs,bindings};
}
test('router deterministic preferred selection and model injection',async()=>{
 const {router}=setup();assert.deepEqual(router.route({taskType:'business'}),router.route({taskType:'business'}));assert.equal(router.route({taskType:'business'}).provider,'yandex');const result=await router.generate(request());assert.equal(result.model,'yandex-test-model');assert.equal(result.routing.decision.policyVersion,'1');assert.equal(result.usageRecord.projectId,'p1');
});
test('capability mismatch or token limit selects configured eligible alternative',()=>{
 const {router}=setup({caps:{yandex:{structuredOutput:false}}});assert.equal(router.route({taskType:'business'}).provider,'openai');
 const other=setup({caps:{yandex:{maxOutputTokens:500}}});assert.equal(other.router.route({taskType:'business',maxOutputTokens:700}).provider,'openai');
});
for(const code of ['TIMEOUT','NETWORK','RATE_LIMIT'])test(`${code} triggers single accounted fallback`,async()=>{
 const {router,counts}=setup({errors:{yandex:new AIProviderError(code)}});const result=await router.generate(request());assert.deepEqual(counts,{yandex:1,openai:1});assert.equal(result.budget.requests,2);assert.equal(result.budget.reservedOutputTokens,2000);assert.equal(result.routing.attempts.length,2);assert.equal(result.routing.attempts[0].errorCode,code);
});
test('only explicitly transient API 5xx triggers fallback',async()=>{
 const {router}=setup({errors:{yandex:new AIProviderError('API_ERROR',undefined,{transient:true})}});assert.equal((await router.generate(request())).routing.attempts.length,2);assert.equal(permitsFallback(new AIProviderError('API_ERROR')),false);
});
for(const code of ['INVALID_REQUEST','INVALID_RESPONSE','AUTH','CANCELLED','INCOMPLETE','REFUSAL','INVALID_CONFIG'])test(`${code} does not fallback`,async()=>{
 const {router,counts}=setup({errors:{yandex:new AIProviderError(code)}});await assert.rejects(router.generate(request()),e=>e.code===code);assert.equal(counts.openai,0);
});
test('security and budget failures never fallback',async()=>{
 for(const code of ['ACCESS_DENIED','LIMIT_EXCEEDED','INVALID_INPUT']){const {router,counts}=setup({errors:{yandex:new SecurityError(code)}});await assert.rejects(router.generate(request()));assert.equal(counts.openai,0);}
});
test('fallback cannot bypass workflow budget',async()=>{
 const costs=new AICostGuard({...DEFAULT_AI_LIMITS,maxRequestsPerWorkflow:1});const {router,counts}=setup({costs,errors:{yandex:new AIProviderError('TIMEOUT')}});await assert.rejects(router.generate(request()),e=>e.code==='LIMIT_EXCEEDED');assert.deepEqual(counts,{yandex:1,openai:0});
});
test('max attempts one/two enforced, never repeats provider',async()=>{
 for(const n of [1,2]){const p=policy();p.maxAttempts=n;const {router,counts}=setup({policy:p,errors:{yandex:new AIProviderError('TIMEOUT'),openai:new AIProviderError('NETWORK')}});await assert.rejects(router.generate(request()));assert.equal(counts.yandex+counts.openai,n);}
 const p=policy();p.maxAttempts=3;assert.throws(()=>setup({policy:p}));
});
test('health unavailable skipped, all unavailable rejected, cooldown recovers',()=>{
 let now=0;const health=new ProviderHealthTracker(()=>now);health.unavailable('yandex');const {router}=setup({health});assert.equal(router.route({taskType:'business'}).provider,'openai');health.unavailable('openai');assert.throws(()=>router.route({taskType:'business'}),e=>e.code==='ROUTE_UNAVAILABLE');now=30001;assert.equal(router.route({taskType:'business'}).provider,'yandex');
});
test('transient failure marks degraded, repeat unavailable, auth leaves healthy',async()=>{
 const health=new ProviderHealthTracker();const {router}=setup({health,errors:{yandex:new AIProviderError('NETWORK')}});await router.generate(request());assert.equal(health.status('yandex'),'degraded');await router.generate(request());assert.equal(health.status('yandex'),'unavailable');
});
test('unknown provider/raw unguarded adapter rejected; policy snapshot cannot be mutated',()=>{
 assert.throws(()=>readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:'unknown'}));const {bindings}=setup();assert.throws(()=>new AIRouter([{...bindings[0],provider:new FakeProvider(()=>{})}],policy()));
 const p=policy(),{router}=setup({policy:p});p.tasks.business.preferred='openai';assert.equal(router.route({taskType:'business'}).provider,'yandex');
});
test('caller abort before routing or during failed primary prevents secondary request',async()=>{
 const controller=new AbortController();controller.abort();const {router,counts}=setup();await assert.rejects(router.generate({...request(),signal:controller.signal}),e=>e.code==='CANCELLED');assert.deepEqual(counts,{yandex:0,openai:0});
});
test('router result has safe projections and raw upstream errors not leaked',async()=>{
 const {router,counts}=setup({errors:{yandex:new Error('TEST_ONLY_PRIVATE_SECRET')}});await assert.rejects(router.generate(request()),error=>!JSON.stringify(error).includes('TEST_ONLY_PRIVATE_SECRET'));assert.equal(counts.openai,0);assert.ok(!JSON.stringify(router).includes('secret'));
});

test('cancellation during transient primary failure prevents fallback',async()=>{
 const controller=new AbortController();const {bindings,counts}=setup();bindings[0].provider=new GuardedAIProvider(new FakeProvider(()=>{controller.abort();throw new AIProviderError('NETWORK');}),context,auth,new AICostGuard(),1000);
 const router=new AIRouter(bindings,policy());await assert.rejects(router.generate({...request(),signal:controller.signal}),e=>e.code==='CANCELLED');assert.equal(counts.openai,0);
});
