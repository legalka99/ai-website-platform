import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteWorkflowService } from '../.test-build/packages/ai/src/services/website-workflow-service.js';
import { createRoutedBusinessService } from '../.test-build/packages/ai/src/services/routed-business-service.js';
import { FakeProvider } from '../.test-build/packages/ai/src/providers/fake-provider.js';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readRouterPolicy } from '../.test-build/packages/ai/src/router/policy.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard } from '../.test-build/packages/security/src/index.js';
import { validOutputs } from './fixtures/website.mjs';
import { businessWire, businessContext } from './fixtures/business-wire.mjs';
async function fixture(failure,runId='run-1',overrideContent) {
 const calls=[];const outputs=validOutputs();
 const context={projectId:'project-1',organizationId:'org-1',workflowId:runId,actor:{id:'owner',authenticated:true}};
 const credentials={id:'credential-1',projectId:'project-1',organizationId:'org-1',provider:'openai',secretRef:'local/openai'};
 const options={context,authorization:new AuthorizationPolicy([{...context,actorId:'owner',role:'owner'}]),costs:new AICostGuard(),
  secrets:new LocalSecretProvider([{...credentials,value:'TEST_ONLY_CONTENT_WORKFLOW'}],'test'),policy:readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:'openai'}),
  providers:[{id:'openai',credentials,config:{model:'test-model',timeoutMs:1000,maxOutputTokens:1000},testAdapter:new FakeProvider(req=>{
   const stage={business_profile:'business',design_direction:'design',content_plan:'content'}[req.structuredOutput.name];assert.ok(stage);calls.push({stage,request:req});
   if(stage===failure)throw new AIProviderError('AUTH');
   const output=stage==='business'?businessWire():stage==='content'&&failure==='malformed'?{}:outputs[stage];
   return {model:req.model,structured:output,content:JSON.stringify(output),usageRecord:{provider:'openai',model:req.model,timestamp:'2026-09-15T00:00:00Z',durationMs:1,inputTokens:10,outputTokens:20,totalTokens:30,cachedInputTokens:2,requestId:`request-${stage}`}};
  })}]};
 const agents={business:await createRoutedBusinessService(options),...Object.fromEntries(['developer','qa'].map(stage=>[stage,{type:stage,async run(context){calls.push({stage,context});return stage===failure?{success:false,error:'Unavailable'}:{success:true,output:outputs[stage]};}}]))};
 if(overrideContent)agents.content={type:'content',async run(ctx){calls.push({stage:'content',context:ctx});return overrideContent(ctx);}};
 return {runner:await createWebsiteWorkflowService(options,agents),calls,outputs};
}
test('real Business -> Design -> Content reaches Developer with validated content and telemetry',async()=>{
 const {runner,calls,outputs}=await fixture();const result=await runner.run(businessContext());assert.equal(result.success,true);assert.deepEqual(calls.map(c=>c.stage),['business','design','content','developer','qa']);
 assert.deepEqual(JSON.parse(calls[2].request.messages[1].content).business,result.state.business);assert.deepEqual(JSON.parse(calls[2].request.messages[1].content).design,result.state.design);
 assert.deepEqual(result.state.content,outputs.content);assert.deepEqual(calls[3].context.input.content,outputs.content);
 assert.equal(result.executions.content.usage.agentType,'content');assert.equal(result.executions.content.budget.requests,3);assert.equal(result.executions.content.usage.cachedInputTokens,2);
});
for(const failure of ['business','design','content','malformed'])test(`${failure} failure stops downstream and preserves earlier state`,async()=>{
 const {runner,calls,outputs}=await fixture(failure);const result=await runner.run(businessContext());assert.equal(result.success,false);
 const index={business:1,design:2,content:3,malformed:3}[failure];assert.deepEqual(calls.map(c=>c.stage),['business','design','content'].slice(0,index));
 assert.deepEqual(Object.keys(result.state),['business','design'].slice(0,index-1));
 if(index===3){assert.deepEqual(result.state.design,outputs.design);assert.equal(result.state.business.companyName,'Example');}
});
test('Content exception stops Developer and preserves Business + Design',async()=>{
 const {runner,calls}=await fixture(undefined,'run-1',()=>{throw Error('Unavailable');});const result=await runner.run(businessContext());assert.match(result.error,/^content:/);assert.deepEqual(Object.keys(result.state),['business','design']);assert.deepEqual(calls.map(c=>c.stage),['business','design','content']);
});
test('runtime boundary rejects malformed Content marked success before Developer',async()=>{
 const {runner,calls}=await fixture(undefined,'run-1',()=>({success:true,output:{}}));const result=await runner.run(businessContext());assert.match(result.error,/^content: Validation failed:/);assert.deepEqual(Object.keys(result.state),['business','design']);assert.equal(calls.length,3);
});
test('later Developer failure preserves Content and its usage',async()=>{
 const {runner,outputs}=await fixture('developer');const result=await runner.run(businessContext());assert.equal(result.success,false);assert.deepEqual(result.state.content,outputs.content);assert.equal(result.executions.content.usage.totalTokens,30);assert.equal(result.state.developer,undefined);
});
test('independent workflow state and Content telemetry remain scoped per run',async()=>{
 const first=await fixture(undefined,'run-A');const second=await fixture(undefined,'run-B');
 const [a,b]=await Promise.all([first.runner.run(businessContext()),second.runner.run(businessContext())]);
 assert.equal(a.success,true);assert.equal(b.success,true);assert.notEqual(a.state,b.state);assert.notEqual(a.executions.content,b.executions.content);
 assert.equal(a.executions.content.usage.workflowId,'run-A');assert.equal(b.executions.content.usage.workflowId,'run-B');
 const failed=await first.runner.run({...businessContext(),input:{}});assert.equal(failed.state.content,undefined);assert.equal(failed.executions.content,undefined);assert.ok(a.state.content);
});
