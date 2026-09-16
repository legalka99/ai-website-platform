import test from 'node:test';
import assert from 'node:assert/strict';
import { developerOptions,layout } from './fixtures/developer.mjs';
import { validOutputs } from './fixtures/website.mjs';
import { businessWire,businessContext } from './fixtures/business-wire.mjs';
import { createRoutedBusinessService } from '../.test-build/packages/ai/src/services/routed-business-service.js';
import { createWebsiteWorkflowService } from '../.test-build/packages/ai/src/services/website-workflow-service.js';
import { FakeProvider } from '../.test-build/packages/ai/src/providers/fake-provider.js';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { buildDeveloperWebsite } from '../.test-build/packages/ai/src/services/developer-website-builder.js';
import { qaWire } from './fixtures/qa.mjs';
async function fixture({failure,override,controller}={}) {
 const options=developerOptions(),calls=[],v=validOutputs();let qa=0;
 // Only one route for this workflow fixture; fallback behavior has its own routed suite.
 options.policy.maxAttempts=1;
 options.providers[0].testAdapter=new FakeProvider(req=>{
  const stage={business_profile:'business',design_direction:'design',content_plan:'content',developer_layout:'developer',qa_report:'qa'}[req.structuredOutput.name];calls.push(stage);
  if(stage===failure)throw new AIProviderError('AUTH');
  if(stage==='qa'&&controller)controller.abort();
  const output=stage==='business'?businessWire():stage==='qa'?failure==='malformed'?{}:failure==='verdict'?qaWire(false):qaWire():stage==='developer'?layout():v[stage];
  return {model:req.model,structured:output,content:'{}',usageRecord:{provider:'openai',model:req.model,timestamp:'2026-09-16T00:00:00.000Z',durationMs:1,totalTokens:30,cachedInputTokens:2}};
 });
 const agents={business:await createRoutedBusinessService(options)};
 if(override)agents.qa={type:'qa',requiresReviewContext:true,run:override};
 return {runner:await createWebsiteWorkflowService(options,agents),calls,qa:()=>qa};
}
test('all five real routed stages reach a validated QA PASS',async()=>{
 const f=await fixture(),r=await f.runner.run(businessContext());assert.equal(r.success,true);assert.deepEqual(f.calls,['business','design','content','developer','qa']);assert.deepEqual(Object.keys(r.state),['business','design','content','developer','qa']);
 assert.equal(r.state.qa.passed,true);assert.equal(r.state.developer.website.status,'draft');assert.equal(r.executions.qa.usage.agentType,'qa');assert.equal(r.executions.qa.budget.requests,5);
});
for(const failure of ['verdict','qa','malformed'])test(`QA ${failure} preserves all four upstream results`,async()=>{
 const f=await fixture({failure}),r=await f.runner.run(businessContext());assert.equal(r.success,false);assert.deepEqual(Object.keys(r.state),['business','design','content','developer',...(failure==='verdict'?['qa']:[])]);
 assert.equal(f.calls.length,5);if(failure==='verdict')assert.equal(r.state.qa.passed,false);if(failure==='malformed'){assert.equal(r.validationError.stage,'qa-schema');assert.equal(r.executions.qa.usage.totalTokens,30);}
});
for(const throws of [false,true])test(`QA ${throws?'exception':'failure'} preserves safe diagnostics and hides internal messages`,async()=>{
 const f=await fixture({override:async()=>{if(throws)throw Error('PRIVATE_PROVIDER_SECRET prompt Authorization');return {success:false,error:'PRIVATE_PROVIDER_SECRET prompt Authorization',validationError:{stage:'qa-schema',path:'$',rule:'SCHEMA_INVALID',rejectedValue:'PRIVATE_PROVIDER_SECRET'}};}});
 const r=await f.runner.run(businessContext());assert.equal(r.error,throws?'qa: QA execution failed':'qa: QA failed');assert.equal(r.state.qa,undefined);assert.ok(r.state.developer);assert.ok(!JSON.stringify(r).includes('PRIVATE_PROVIDER_SECRET'));if(!throws)assert.deepEqual(r.validationError,{stage:'qa-schema',path:'$',rule:'SCHEMA_INVALID'});
});
test('QA cancellation retains prior draft and usage but no report',async()=>{
 const controller=new AbortController(),f=await fixture({controller}),r=await f.runner.run({...businessContext(),signal:controller.signal});assert.equal(r.success,false);assert.equal(r.error,'qa: Workflow cancelled');assert.ok(r.state.developer);assert.equal(r.state.qa,undefined);assert.equal(r.executions.qa.usage.totalTokens,30);assert.equal(f.calls.length,5);
});
test('QA receives detached full context and cannot mutate upstream state',async()=>{
 const f=await fixture({override:async({input})=>{assert.ok(input.reviewContext.business);assert.ok(input.reviewContext.design);assert.ok(input.reviewContext.content);input.website.projectId='other';input.website.pages[0].blocks=[];input.reviewContext.business.name='changed';input.reviewContext.content.sections=[];return {success:true,output:validOutputs().qa};}});
 const r=await f.runner.run(businessContext());assert.equal(r.success,true);assert.equal(r.state.developer.website.projectId,'project-1');assert.equal(r.state.developer.website.pages[0].blocks.length,1);assert.equal(r.state.content.sections.length,1);assert.notEqual(r.state.business.name,'changed');
});
test('custom QA cannot reference a foreign page',async()=>{
 const f=await fixture({override:async()=>({success:true,output:{...validOutputs().qa,issues:[{code:'UX_OBSERVATION',severity:'warning',message:'Review structure.',pageId:'foreign-page'}]}})});
 const r=await f.runner.run(businessContext());assert.equal(r.success,false);assert.equal(r.state.qa,undefined);assert.ok(r.state.developer);assert.equal(r.validationError.rule,'INVALID_REFERENCE');assert.ok(!JSON.stringify(r).includes('foreign-page'));
});
