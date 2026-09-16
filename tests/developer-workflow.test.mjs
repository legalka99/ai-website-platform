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
async function fixture({failure,override,controller}={}) {
 const options=developerOptions(),calls=[],v=validOutputs();let qa=0;
 // Only one route for this workflow fixture; fallback behavior has its own routed suite.
 options.policy.maxAttempts=1;
 options.providers[0].testAdapter=new FakeProvider(req=>{
  const stage={business_profile:'business',design_direction:'design',content_plan:'content',developer_layout:'developer'}[req.structuredOutput.name];calls.push(stage);
  if(stage===failure)throw new AIProviderError('AUTH');
  if(stage==='developer'&&controller)controller.abort();
  const output=stage==='business'?businessWire():stage==='developer'?failure==='malformed'?{}:layout():v[stage];
  return {model:req.model,structured:output,content:'{}',usageRecord:{provider:'openai',model:req.model,timestamp:'2026-09-16T00:00:00.000Z',durationMs:1,totalTokens:30,cachedInputTokens:2}};
 });
 const agents={business:await createRoutedBusinessService(options),qa:{type:'qa',async run(){qa++;return {success:true,output:v.qa};}}};
 if(override)agents.developer={type:'developer',run:override};
 return {runner:await createWebsiteWorkflowService(options,agents),calls,qa:()=>qa};
}
test('real routed Business -> Design -> Content -> Developer reaches current QA with canonical Website',async()=>{
 const f=await fixture(),r=await f.runner.run(businessContext());assert.equal(r.success,true);assert.deepEqual(f.calls,['business','design','content','developer']);assert.equal(f.qa(),1);
 assert.deepEqual(Object.keys(r.state),['business','design','content','developer','qa']);assert.equal(r.state.developer.website.status,'draft');assert.equal(r.state.developer.website.projectId,'project-1');assert.equal(r.state.developer.website.pages[0].title,r.state.content.pageTitle);
 assert.equal(r.executions.developer.usage.agentType,'developer');assert.equal(r.executions.developer.usage.cachedInputTokens,2);assert.equal(r.executions.developer.budget.requests,4);
});
for(const failure of ['business','design','content','developer','malformed'])test(`workflow ${failure} failure stops downstream and preserves validated prior state`,async()=>{
 const f=await fixture({failure}),r=await f.runner.run(businessContext());assert.equal(r.success,false);assert.equal(f.qa(),0);assert.equal(r.state.developer,undefined);
 const count={business:0,design:1,content:2,developer:3,malformed:3}[failure];assert.deepEqual(Object.keys(r.state),['business','design','content'].slice(0,count));
 if(count===3){if(failure==='malformed'){assert.equal(r.executions.developer.usage.agentType,'developer');assert.equal(r.validationError.stage,'developer-schema');assert.equal(r.executions.developer.usage.totalTokens,30);}else {assert.equal(r.executions.developer.usage,undefined);assert.equal(r.executions.developer.routing.attempts[0].errorCode,'AUTH');}}
});
for(const throws of [false,true])test(`Developer ${throws?'exception':'failure'} never echoes internal errors and preserves safe diagnostics`,async()=>{
 const f=await fixture({override:async()=>{if(throws)throw Error('PRIVATE_PROVIDER_SECRET prompt Authorization');return {success:false,error:'PRIVATE_PROVIDER_SECRET prompt Authorization',validationError:{stage:'developer-schema',path:'$',rule:'SCHEMA_INVALID',rejectedValue:'PRIVATE_PROVIDER_SECRET'}};}});
 const r=await f.runner.run(businessContext());assert.equal(r.error,throws?'developer: Developer execution failed':'developer: Developer failed');assert.equal(f.qa(),0);assert.deepEqual(Object.keys(r.state),['business','design','content']);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_PROVIDER_SECRET'));if(!throws)assert.deepEqual(r.validationError,{stage:'developer-schema',path:'$',rule:'SCHEMA_INVALID'});
});
for(const mode of ['copy','SEO','script','foreign-project','published','mutate-source'])test(`custom Developer cannot bypass ${mode} boundary`,async()=>{
 const f=await fixture({override:async context=>{
  if(mode==='mutate-source')context.input.content.sections[0].heading='High quality';
  const output=buildDeveloperWebsite(context.input,layout(),'project-1');
  if(mode==='copy')output.website.pages[0].blocks[0].content.heading='High quality';
  if(mode==='SEO')output.website.pages[0].seo.title='High quality';
  if(mode==='script')output.website.pages[0].blocks[0].content.text='<script>alert(1)</script>';
  if(mode==='foreign-project')output.website.projectId='other';
  if(mode==='published')output.website.status='published';
  return {success:true,output};
 }});
 const r=await f.runner.run(businessContext());assert.equal(r.success,false);assert.equal(r.state.developer,undefined);assert.equal(f.qa(),0);assert.equal(r.state.content.sections[0].heading,'Glass partitions');assert.ok(r.validationError);assert.ok(!r.error.includes('High quality'));
});
test('workflow AbortSignal stops Developer assembly and QA, retaining earlier state and usage',async()=>{
 const controller=new AbortController(),f=await fixture({controller});const r=await f.runner.run({...businessContext(),signal:controller.signal});assert.equal(r.success,false);assert.equal(r.error,'developer: Workflow cancelled');assert.equal(f.qa(),0);assert.deepEqual(Object.keys(r.state),['business','design','content']);assert.equal(r.executions.developer.usage.totalTokens,30);
});
test('pre-cancelled workflow sends no provider requests',async()=>{
 const f=await fixture(),r=await f.runner.run({...businessContext(),signal:AbortSignal.abort()});assert.equal(r.success,false);assert.deepEqual(f.calls,[]);assert.deepEqual(r.state,{});assert.equal(f.qa(),0);
});
test('independent Developer workflow runs have separate Website IDs and state',async()=>{
 const a=await fixture(),b=await fixture();const [x,y]=await Promise.all([a.runner.run(businessContext()),b.runner.run(businessContext())]);assert.equal(x.success,true);assert.equal(y.success,true);assert.notEqual(x.state.developer.website.id,y.state.developer.website.id);assert.notEqual(x.state,y.state);
});
