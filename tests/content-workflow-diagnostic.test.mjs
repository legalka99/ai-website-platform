import test from 'node:test';
import assert from 'node:assert/strict';
import {WebsiteWorkflowOrchestrator} from '../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js';
import {reportContentDiagnostic} from '../.test-build/apps/api/src/workflow-launch.js';
import {validOutputs} from './fixtures/website.mjs';
const diagnostic={stage:'content-schema',path:'sections[2].heading',rule:'SCHEMA_MIN_LENGTH'};
const runId='11111111-1111-4111-8111-111111111111';
async function run({stage='content',validationError,grounding=false}={}){
 const outputs=validOutputs(),calls=[];
 if(grounding)outputs.content.sections[0].text='High quality';
 const agents=Object.fromEntries(['business','design','content','developer','qa'].map(type=>[type,{type,async run(){calls.push(type);return type===stage&&!grounding?{success:false,errorCode:'INVALID_RESPONSE',error:'private-agent-details',validationError}:{success:true,output:outputs[type]};}}]));
 const result=await new WebsiteWorkflowOrchestrator(agents).run({projectId:'project-1',goal:'Create draft',input:{companyName:'Example'}});
 return {result,calls};
}
test('Content safe validationError passes through workflow result as value-free projection',async()=>{
 const {result,calls}=await run({validationError:{...diagnostic,message:'private-marker',raw:'private-marker',value:'private-marker'}});
 assert.equal(result.success,false);assert.deepEqual(result.validationError,diagnostic);assert.deepEqual(result.stageError,{stage:'content',errorCode:'INVALID_RESPONSE'});assert.deepEqual(calls,['business','design','content']);assert.ok(result.state.business&&result.state.design);assert.equal(result.state.content,undefined);
});
for(const validationError of [undefined,{...diagnostic,path:'sections[2].private-marker'},{...diagnostic,stage:'private-marker'},{...diagnostic,rule:'private-marker'},{...diagnostic,path:'sections[999].heading'}])test('Content invalid diagnostic is discarded '+JSON.stringify(validationError),async()=>{
 const {result}=await run({validationError});assert.equal(result.validationError,undefined);
});
test('Content diagnostic getters are not executed',async()=>{
 let calls=0;const {result}=await run({validationError:{...diagnostic,get rule(){calls++;return 'SCHEMA_MIN_LENGTH';}}});assert.equal(result.validationError,undefined);assert.equal(calls,0);
});
test('orchestrator additional Content grounding failure retains safe diagnostic and stops downstream',async()=>{
 const {result,calls}=await run({grounding:true});assert.equal(result.success,false);assert.deepEqual(result.validationError,{stage:'content-grounding',path:'sections[0].text',rule:'UNGROUNDED_QUALITY_CLAIM'});assert.deepEqual(calls,['business','design','content']);assert.equal(result.state.content,undefined);assert.ok(!JSON.stringify(result.validationError).includes('High quality'));
 const events=[];reportContentDiagnostic(result,runId,e=>events.push(e));assert.equal(events[0].diagnostic.rule,'UNGROUNDED_QUALITY_CLAIM');
});
for(const [stage,validationError] of [['developer',{stage:'developer-grounding',path:'$',rule:'COPY_MISMATCH'}],['qa',{stage:'qa-consistency',path:'passed',rule:'PASS_WITH_BLOCKING_ISSUE'}]])test(`${stage} diagnostics remain unchanged and do not produce Content event`,async()=>{
 const {result}=await run({stage,validationError});assert.deepEqual(result.validationError,validationError);const events=[];reportContentDiagnostic(result,runId,e=>events.push(e));assert.deepEqual(events,[]);
});
test('Content internal reporter reprojects diagnostic and does not log execution, errors or raw values',()=>{
 const events=[];const result={success:false,state:{},error:'private-marker',executions:{content:{goal:'private-marker'}},validationError:{...diagnostic,value:'private-marker',message:'private-marker'}};
 reportContentDiagnostic(result,runId,e=>events.push(e));assert.deepEqual(events,[{event:'content_validation_failed',runId,diagnostic}]);assert.ok(!JSON.stringify(events).includes('private-marker'));
 assert.doesNotThrow(()=>reportContentDiagnostic(result,runId,()=>{throw Error('private-marker');}));
 reportContentDiagnostic({...result,success:true},runId,e=>events.push(e));reportContentDiagnostic(result,'private-marker',e=>events.push(e));reportContentDiagnostic({...result,validationError:{...diagnostic,path:'private-marker'}},runId,e=>events.push(e));assert.equal(events.length,1);
});
