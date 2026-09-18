import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { snapshot,scopeCopy,telemetry,digest } from '../.test-build/packages/persistence/src/validation.js';
import { runPersistedWorkflow } from '../.test-build/packages/persistence/src/workflow.js';
for(const kind of ['getter','toJSON','cycle','hidden','symbol','prototype','oversize'])test(`persistence rejects ${kind} without executing it`,()=>{
 let reads=0;const v={};if(kind==='getter')Object.defineProperty(v,'x',{enumerable:true,get(){reads++;return 1;}});if(kind==='toJSON')v.toJSON=()=>{reads++;return {};};if(kind==='cycle')v.self=v;if(kind==='hidden')Object.defineProperty(v,'x',{value:1});if(kind==='symbol')v[Symbol()]=1;if(kind==='prototype')Object.setPrototypeOf(v,{x:1});if(kind==='oversize')v.x='a'.repeat(16001);
 assert.throws(()=>snapshot(v));assert.equal(reads,0);
});
test('snapshot detaches repeated usage refs, stable digest ignores object key order',()=>{const usage={totalTokens:3},v=snapshot({usage,attempt:{usage}});assert.notEqual(v.usage,v.attempt.usage);assert.equal(digest({b:2,a:1}),digest({a:1,b:2}));});
test('scope is copied and all identity fields require unpredictable UUID format',()=>{const s={actorId:randomUUID(),organizationId:randomUUID(),projectId:randomUUID()};assert.deepEqual(scopeCopy(s),s);assert.notEqual(scopeCopy(s),s);assert.throws(()=>scopeCopy({...s,actorId:'owner'}));});
test('telemetry excludes unknown data and rejects credentials and negative counts',()=>{
 const s={actorId:randomUUID(),organizationId:randomUUID(),projectId:randomUUID()},run=randomUUID();
 const e={projectId:s.projectId,usage:{provider:'openai',model:'test',totalTokens:2,raw:'private'}};
 assert.deepEqual(telemetry(e,s,run,'qa'),[{provider:'openai',model:'test',outcome:'unknown',totalTokens:2}]);e.usage.totalTokens=-1;assert.throws(()=>telemetry(e,s,run,'qa'));e.usage.totalTokens=1;e.usage.model='password: TEST_ONLY';assert.throws(()=>telemetry(e,s,run,'qa'));
});
test('persistence failure does not rerun AI or report durable success',async()=>{const s={actorId:randomUUID(),organizationId:randomUUID(),projectId:randomUUID()};let calls=0;const store={async startRun(){return {id:randomUUID()};},async finishRun(){throw Error('Database failure');}};await assert.rejects(runPersistedWorkflow(store,s,{goal:'Build',input:{}},async()=>({async run(){calls++;return {success:false,state:{}};}})));assert.equal(calls,1);});
test('Content permits at most four scoped usage rows, other stages retain two',()=>{
 const s={actorId:randomUUID(),organizationId:randomUUID(),projectId:randomUUID()},run=randomUUID();
 const attempts=Array.from({length:4},()=>({provider:'openai',model:'test',outcome:'success',usage:{...s,workflowId:run,agentType:'content',provider:'openai',model:'test',totalTokens:3}}));
 const e={projectId:s.projectId,routing:{attempts}};
 assert.equal(telemetry(e,s,run,'content').length,4);
 assert.throws(()=>telemetry(e,s,run,'qa'));
 attempts[3].usage.projectId=randomUUID();assert.throws(()=>telemetry(e,s,run,'content'));
 attempts[3].usage.projectId=s.projectId;attempts.push(attempts[0]);assert.throws(()=>telemetry(e,s,run,'content'));
});
