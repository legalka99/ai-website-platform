import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebsiteWorkflowService } from '../.test-build/packages/ai/src/services/website-workflow-service.js';
import { createRoutedBusinessService } from '../.test-build/packages/ai/src/services/routed-business-service.js';
import { FakeProvider } from '../.test-build/packages/ai/src/providers/fake-provider.js';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readRouterPolicy } from '../.test-build/packages/ai/src/router/policy.js';
import { AuthorizationPolicy, AICostGuard, LocalSecretProvider } from '../.test-build/packages/security/src/index.js';
import { businessWire, businessContext } from './fixtures/business-wire.mjs';
import { validOutputs } from './fixtures/website.mjs';

async function fixture({businessFailure=false, designFailure=false, malformed=false, contentFailure=false}={}) {
  const calls=[];
  const outputs=validOutputs();
  const context={projectId:'project-1',organizationId:'org-1',workflowId:'workflow-1',actor:{id:'owner',authenticated:true}};
  const credentials={id:'credential-1',provider:'openai',projectId:context.projectId,organizationId:context.organizationId,secretRef:'local/openai'};
  const options={context,
    authorization:new AuthorizationPolicy([{...context,actorId:'owner',role:'owner'}]),
    costs:new AICostGuard(),secrets:new LocalSecretProvider([{...credentials,value:'TEST_ONLY_WORKFLOW_KEY'}],'test'),
    policy:readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:'openai'}),
    providers:[{id:'openai',credentials,config:{model:'test-model',timeoutMs:1000,maxOutputTokens:1000},testAdapter:new FakeProvider(request=>{
      const stage=request.structuredOutput.name==='business_profile'?'business':'design';
      calls.push({stage,request});
      if(stage==='business'&&businessFailure || stage==='design'&&designFailure) throw new AIProviderError('AUTH');
      const wire=stage==='business'?businessWire():malformed?{...outputs.design,colors:{primary:'red'}}:outputs.design;
      return {model:request.model,content:JSON.stringify(wire),structured:wire,usageRecord:{provider:'openai',model:request.model,timestamp:'2026-09-15T00:00:00Z',durationMs:1,totalTokens:10}};
    })}],
  };
  const business=await createRoutedBusinessService(options);
  const agents={business,...Object.fromEntries(['content','developer','qa'].map(stage=>[stage,{type:stage,async run(context){
    calls.push({stage,context});
    if(stage==='content'&&contentFailure) return {success:false,error:'Content unavailable'};
    return {success:true,output:outputs[stage]};
  }}]))};
  return {runner:await createWebsiteWorkflowService(options,agents),calls,outputs};
}

test('real Business -> routed Design -> Content passes validated state and exact Business input',async()=>{
  const {runner,calls,outputs}=await fixture();const result=await runner.run(businessContext());
  assert.equal(result.success,true);assert.deepEqual(calls.map(c=>c.stage),['business','design','content','developer','qa']);
  const data=JSON.parse(calls[1].request.messages[1].content);
  assert.deepEqual(data.business,result.state.business);
  assert.deepEqual(result.state.design,outputs.design);
  assert.deepEqual(calls[2].context.input,{business:result.state.business,design:outputs.design});
});
test('Business failure prevents routed Design request',async()=>{
  const {runner,calls}=await fixture({businessFailure:true});const result=await runner.run(businessContext());
  assert.equal(result.success,false);assert.match(result.error,/^business:/);assert.deepEqual(calls.map(c=>c.stage),['business']);assert.deepEqual(result.state,{});
});
test('real Design failure stops Content and preserves validated Business state',async()=>{
  const {runner,calls}=await fixture({designFailure:true});const result=await runner.run(businessContext());
  assert.equal(result.success,false);assert.match(result.error,/^design:/);assert.deepEqual(calls.map(c=>c.stage),['business','design']);
  assert.deepEqual(result.state.business,JSON.parse(calls[1].request.messages[1].content).business);
  assert.deepEqual(Object.keys(result.state),['business']);
});
test('malformed DesignDirection from routed provider stops Content',async()=>{
  const {runner,calls}=await fixture({malformed:true});const result=await runner.run(businessContext());
  assert.equal(result.success,false);assert.match(result.error,/^design:/);assert.deepEqual(calls.map(c=>c.stage),['business','design']);
  assert.ok(result.state.business);assert.equal(result.state.design,undefined);
});
test('validated real Design state survives later Content failure',async()=>{
  const {runner,calls,outputs}=await fixture({contentFailure:true});const result=await runner.run(businessContext());
  assert.equal(result.success,false);assert.match(result.error,/^content:/);assert.deepEqual(calls.map(c=>c.stage),['business','design','content']);
  assert.equal(result.executions.business.usage.agentType,'business');assert.equal(result.executions.design.usage.agentType,'design');
  assert.equal(result.executions.design.usage.workflowId,'workflow-1');
  assert.deepEqual(result.state.design,outputs.design);assert.deepEqual(Object.keys(result.state),['business','design']);
});

test('workflow telemetry survives invalid Design and does not mix between runs',async()=>{
 const {runner}=await fixture({malformed:true});const first=await runner.run(businessContext());
 assert.equal(first.success,false);assert.ok(first.executions.business.usage);assert.ok(first.executions.design.usage);
 const second=await runner.run({projectId:'project-1',goal:'Create',input:{}});
 assert.equal(second.success,false);assert.equal(second.executions.design,undefined);assert.notEqual(first.executions,second.executions);
});
