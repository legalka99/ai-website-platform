import test from 'node:test';
import assert from 'node:assert/strict';
import {blockOptions,blockTask} from './fixtures/block.mjs';
import {qaWire} from './fixtures/qa.mjs';
import {DefaultQAAgent} from '../.test-build/packages/ai/src/agents/default-qa-agent.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {reportBlockQADiagnostic} from '../.test-build/apps/api/src/block-launch.js';
const diagnostic={stage:'qa-schema',path:'issues[0].severity',rule:'INVALID_SEVERITY'};
const runId='11111111-1111-4111-8111-111111111111';
const marker='PRIVATE_REJECTED_TEXT';
async function failed(t,validationError,outerGetter=false){
 const result={success:false,errorCode:'INVALID_RESPONSE',error:marker,output:{raw:marker}};
 if(outerGetter)Object.defineProperty(result,'validationError',{get(){throw Error('Getter executed');}});
 else result.validationError=validationError;
 t.mock.method(DefaultQAAgent.prototype,'run',async()=>result);
 const stages=[];
 const output=await(await createBlockWorkflow(blockOptions())).run({...blockTask(),onStage:async(s,p)=>stages.push([s,p])});
 assert.equal(output.errorCode,'INVALID_RESPONSE');assert.equal(JSON.stringify(output).includes(marker),false);
 assert.deepEqual(stages,[['design','started'],['design','completed'],['content','started'],['content','completed'],['developer','started'],['developer','completed'],['qa','started'],['qa','failed']]);
 return output;
}
test('QA failure carries a copied safe diagnostic, no rejected text; logger projects exact fields',async t=>{
 const source={...diagnostic,raw:marker,message:marker},r=await failed(t,source);
 assert.deepEqual(r.qaValidationError,diagnostic);assert.notEqual(r.qaValidationError,source);
 const events=[];reportBlockQADiagnostic({...r,instruction:marker},runId,e=>events.push(e));
 assert.deepEqual(events,[{event:'block_qa_validation_failed',runId,diagnostic}]);
 source.path='$';assert.equal(r.qaValidationError.path,'issues[0].severity');
});
for(const [name,change] of [['stage',{stage:'private-stage'}],['rule',{rule:'private-rule'}],['path',{path:'issues[0].severity '+marker}]])test(`unknown or unsafe QA ${name} is discarded at workflow and logger`,async t=>{
 const value={...diagnostic,...change};assert.equal((await failed(t,value)).qaValidationError,undefined);
 const events=[];reportBlockQADiagnostic({success:false,errorCode:'INVALID_RESPONSE',qaValidationError:value},runId,e=>events.push(e));assert.deepEqual(events,[]);
});
for(const field of ['stage','path','rule'])test(`QA diagnostic ${field} accessor is never executed`,async t=>{
 let calls=0;const value={...diagnostic};Object.defineProperty(value,field,{get(){calls++;return diagnostic[field];}});
 assert.equal((await failed(t,value)).qaValidationError,undefined);
 reportBlockQADiagnostic({success:false,errorCode:'INVALID_RESPONSE',qaValidationError:value},runId,()=>assert.fail('Unexpected log'));assert.equal(calls,0);
});
test('agent validationError accessor is not executed',async t=>{
 let calls=0;t.mock.method(DefaultQAAgent.prototype,'run',async()=>({success:false,errorCode:'INVALID_RESPONSE',get validationError(){calls++;return diagnostic;}}));
 const r=await(await createBlockWorkflow(blockOptions())).run(blockTask());assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(r.qaValidationError,undefined);assert.equal(calls,0);
});
test('logger skips outer accessors, invalid run IDs and non-validation outcomes; logger failure is isolated',()=>{
 for(const field of ['success','errorCode','qaValidationError']){
  let calls=0;const r={success:false,errorCode:'INVALID_RESPONSE',qaValidationError:diagnostic};Object.defineProperty(r,field,{get(){calls++;throw Error(marker);}});
  reportBlockQADiagnostic(r,runId,()=>assert.fail('Unexpected log'));assert.equal(calls,0);
 }
 for(const [success,errorCode,id] of [[true,'INVALID_RESPONSE',runId],[false,'QA_FAILED',runId],[false,'INVALID_RESPONSE',marker]])reportBlockQADiagnostic({success,errorCode,qaValidationError:diagnostic},id,()=>assert.fail('Unexpected log'));
 assert.doesNotThrow(()=>reportBlockQADiagnostic({success:false,errorCode:'INVALID_RESPONSE',qaValidationError:diagnostic},runId,()=>{throw Error(marker);}));
});
for(const pass of [true,false])test(`valid QA report passed=${pass} has no failure diagnostic`,async()=>{
 const r=await(await createBlockWorkflow(blockOptions({qa:qaWire(pass)}))).run(blockTask());assert.equal(r.success,pass);assert.equal(r.qaValidationError,undefined);if(!pass)assert.equal(r.errorCode,'QA_FAILED');
 reportBlockQADiagnostic(r,runId,()=>assert.fail('Unexpected log'));
});
test('real QA validator failure after successful fake provider preserves usage and diagnostic',async()=>{
 const options=blockOptions({qa:{}}),stages=[];const r=await(await createBlockWorkflow(options)).run({...blockTask(),onStage:async(s,p,e)=>stages.push({s,p,e})});
 assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(r.qaValidationError.stage,'qa-schema');assert.equal(options.calls.length,2);
 assert.equal(stages.at(-1).e.routing.attempts[0].outcome,'success');assert.equal(stages.at(-1).e.usage.totalTokens,10);
});
