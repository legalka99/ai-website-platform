import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDesignDiagnostic,designWireFailure} from '../.test-build/packages/ai/src/contracts/design-diagnostic.js';
import {reportDesignDiagnostic} from '../.test-build/apps/api/src/workflow-launch.js';
const good={stage:'design-domain',issues:[{code:'INVALID_OUTPUT',field:'design.colors.primary'}]};
test('diagnostic projection strips values/messages and rejects forged fields/codes',()=>{
 const projected=safeDesignDiagnostic({...good,raw:'private-marker',issues:[{...good.issues[0],message:'private-marker',value:'private-marker'},{code:'PRIVATE_CODE',field:'design.notes'},{code:'INVALID_OUTPUT',field:'design.private-marker'},{code:'INVALID_OUTPUT',field:'design.mood[999]'}]});assert.deepEqual(projected,good);
});
test('diagnostic projection is bounded and never executes accessors or string coercion',()=>{
 let reads=0;const evil={toString(){reads++;return 'design-domain';}};assert.equal(safeDesignDiagnostic({stage:evil,issues:good.issues}),undefined);
 const getter={get code(){reads++;return 'INVALID_OUTPUT';},field:'design'};assert.equal(safeDesignDiagnostic({stage:'design-domain',issues:[getter]}),undefined);
 assert.equal(safeDesignDiagnostic({stage:'design-wire',issues:good.issues}),undefined);
 const issues=Array.from({length:12},(_,i)=>({code:'INVALID_OUTPUT',field:`design.mood[${i}]`}));assert.equal(safeDesignDiagnostic({stage:'design-domain',issues}).issues.length,8);assert.equal(reads,0);
});
test('wire failure classification does not execute getters or toJSON; limits remain bounded',()=>{
 let reads=0;const getter={get x(){reads++;return 'private';}},cyclic={};cyclic.self=cyclic;
 for(const value of [getter,cyclic,{toJSON(){reads++;return {};}}])assert.equal(designWireFailure(value),'WIRE_SHAPE_INVALID');
 assert.equal(designWireFailure('x'.repeat(2001)),'WIRE_RESOURCE_LIMIT');assert.equal(designWireFailure(Array(13).fill('x')),'WIRE_RESOURCE_LIMIT');assert.equal(reads,0);
});
test('internal reporter emits only run ID and sanitized diagnostic, not execution or user data',()=>{
 const events=[];const result={success:false,state:{},stageError:{stage:'design',errorCode:'INVALID_RESPONSE'},error:'private-marker',executions:{design:{goal:'private-marker',raw:'private-marker',designDiagnostic:{...good,raw:'private-marker'}}}};
 reportDesignDiagnostic(result,'11111111-1111-4111-8111-111111111111',event=>events.push(event));assert.deepEqual(events,[{event:'design_validation_failed',runId:'11111111-1111-4111-8111-111111111111',diagnostic:good}]);
 assert.doesNotThrow(()=>reportDesignDiagnostic(result,'11111111-1111-4111-8111-111111111111',()=>{throw Error('private-marker');}));
 reportDesignDiagnostic({...result,stageError:{stage:'qa',errorCode:'INVALID_RESPONSE'}},'run',event=>events.push(event));assert.equal(events.length,1);
});

test('Design reason allowlist drops unknown reasons without losing the safe issue',()=>{
 const issue={code:'UNSAFE_DESIGN_TEXT',field:'design.typography.headingStyle'};
 let reads=0;
 for(const reason of ['private-marker','UNSAFE_CODE private-marker','unsafe_code',null,42,{toString(){reads++;return 'UNSAFE_CODE';}}]){
  assert.deepEqual(safeDesignDiagnostic({stage:'design-domain',issues:[{...issue,reason}]}),{stage:'design-domain',issues:[issue]});
 }
 assert.deepEqual(safeDesignDiagnostic({stage:'design-domain',issues:[{...issue,get reason(){reads++;return 'UNSAFE_CODE';}}]}),{stage:'design-domain',issues:[issue]});
 assert.equal(reads,0);
 assert.deepEqual(safeDesignDiagnostic({...good,issues:[{...good.issues[0],reason:'UNSAFE_CODE'}]}),good);
 const wire={stage:'design-wire',issues:[{code:'WIRE_SHAPE_INVALID',field:'design'}]};
 assert.deepEqual(safeDesignDiagnostic({...wire,issues:[{...wire.issues[0],reason:'UNSAFE_CODE'}]}),wire);
});
test('internal Design log preserves allowlisted reasons only, never rejected typography text',()=>{
 const issue={code:'UNSAFE_DESIGN_TEXT',field:'design.typography.headingStyle',reason:'UNSAFE_CODE'};
 const unsafe={...issue,field:'design.typography.bodyStyle',reason:'private-marker'};
 const events=[];
 reportDesignDiagnostic({success:false,stageError:{stage:'design',errorCode:'INVALID_RESPONSE'},executions:{design:{designDiagnostic:{stage:'design-domain',issues:[{...issue,value:'font-weight: 700',message:'private-marker'},unsafe]}}}},'11111111-1111-4111-8111-111111111111',event=>events.push(event));
 assert.deepEqual(events[0].diagnostic,{stage:'design-domain',issues:[issue,{code:unsafe.code,field:unsafe.field}]});
 assert.ok(!JSON.stringify(events).includes('private-marker'));
 assert.ok(!JSON.stringify(events).includes('font-weight: 700'));
});
