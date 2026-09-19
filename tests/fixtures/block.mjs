import {developerOptions} from './developer.mjs';
import {validOutputs} from './website.mjs';
import {FakeProvider} from '../../.test-build/packages/ai/src/providers/fake-provider.js';
import {qaWire} from './qa.mjs';
export function blockTask(){return {projectId:'project-1',scope:{type:'block',pageId:'page-1',blockId:'11111111-1111-4111-8111-111111111111'},instruction:'Сделай информационный блок',page:{id:'page-1',title:'Главная',slug:'/',status:'draft',order:0,blocks:[]},designSystem:validOutputs().developer.website.designSystem,facts:{facts:[]},desiredActions:['Request a quote']};}
export function blockOptions({plan=validOutputs().content,qa=qaWire(),fail,inspect}={}){
 const o=developerOptions();o.calls=[];
 for(const p of o.providers)p.testAdapter=new FakeProvider(req=>{o.calls.push({provider:p.id,req});inspect?.(req);if(fail)throw fail;const structured=req.structuredOutput.name==='block_content'?plan:qa;return {structured,content:'{}',model:req.model,usageRecord:{provider:p.id,model:req.model,timestamp:new Date().toISOString(),durationMs:1,totalTokens:10}};});return o;
}

import {OwnerGenerationPolicy} from '../../.test-build/packages/security/src/authorization.js';
import {LocalSecretProvider} from '../../.test-build/packages/security/src/secrets.js';
import {createBlockWorkflow} from '../../.test-build/packages/ai/src/services/block-workflow.js';
export function neutralBlockPlan(){return {pageTitle:'Обзор',pageGoal:'Представить информацию',toneOfVoice:'Спокойный',keyMessages:['Узнайте больше'],sections:[{type:'text',purpose:'Представить информацию',heading:'Узнайте больше',text:'Выберите интересующую тему'}]};}
export function fakeBlockFactory({plan=neutralBlockPlan(),hold,qa,fail,inspect,unavailableSecrets=false}={}){
 const calls=[];const factory=async(launch,costs)=>{
  const o=blockOptions({plan,qa,fail,inspect}),scope=launch.scope;
  o.context={...scope,workflowId:launch.runId,actor:{id:scope.actorId,authenticated:true}};
  o.authorization=new OwnerGenerationPolicy(scope.actorId,scope);o.costs=costs;
  for(const p of o.providers){p.credentials={...p.credentials,projectId:scope.projectId,organizationId:scope.organizationId};const adapter=p.testAdapter;p.testAdapter=new FakeProvider(async req=>{calls.push({provider:p.id,name:req.structuredOutput.name});await hold?.(req);return adapter.generate(req);});}
  o.secrets=new LocalSecretProvider(o.providers.map(p=>({...p.credentials,value:'TEST_ONLY_BLOCK_KEY'})),'test');
  if(unavailableSecrets)o.secrets={resolve:async()=>{throw Error('TEST_ONLY_UNAVAILABLE');}};
  return createBlockWorkflow(o);
 };return {factory,calls};
}
