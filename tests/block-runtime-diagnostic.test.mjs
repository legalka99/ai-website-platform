import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {safeBlockRuntimeDiagnostic} from '../.test-build/packages/ai/src/contracts/block-runtime-diagnostic.js';
import {reportBlockRuntimeDiagnostic} from '../.test-build/apps/api/src/block-launch.js';
import {blockOptions,blockTask,neutralBlockPlan} from './fixtures/block.mjs';
import {confirmed} from './fixtures/confirmed-facts.mjs';

const facts='собственное производство, качественная фурнитура, прозрачные цены';
const runtime={buildIdentifier:'0123456789abcdef',buildTimestamp:'2026-09-18T12:00:00.000Z',sourceArtifact:'.test-build/apps/api/src/index.js',processPid:12345,configuredApiPort:3001};
async function run(plan,configure=()=>{}){
 const task=blockTask();configure(task);let diagnostic;task.onDiagnostic=value=>{diagnostic=value;};
 const options=blockOptions({plan}),result=await(await createBlockWorkflow(options)).run(task);
 return {task,options,result,diagnostic};
}
const advantagesPlan=(text='Основные особенности компании')=>{const plan=neutralBlockPlan();plan.sections[0]={type:'advantages',purpose:'Показать преимущества',heading:'Преимущества',text,points:['Своя формулировка','Другая формулировка','Третья формулировка']};return plan;};

test('inferred full-fragment advantages emits one value-free diagnostic for the actual deterministic path',async()=>{
 const x=await run(advantagesPlan('Высокое качество'),task=>{task.instruction='Сделай блок преимуществ';task.facts=confirmed({advantages:facts});});
 assert.equal(x.result.success,true);assert.equal(x.diagnostic.requestedType,'advantages');assert.equal(x.diagnostic.intentBlockType,'advantages');assert.equal(x.diagnostic.taskBlockTypeExists,false);
 assert.equal(x.diagnostic.confirmedFactCount,3);assert.equal(x.diagnostic.advantagesFactCount,3);assert.equal(x.diagnostic.structuredAdvantageCount,0);assert.equal(x.diagnostic.fragmentCount,3);assert.equal(x.diagnostic.legacyFragmentCount,3);assert.equal(x.diagnostic.fragmentGroupValid,true);
 assert.equal(x.diagnostic.sectionType,'advantages');assert.equal(x.diagnostic.initialValidation,'pass');assert.equal(x.diagnostic.deterministicPathActivated,true);assert.deepEqual(x.diagnostic.transformedFields,['points','text']);assert.deepEqual(x.diagnostic.droppedFields,['text']);
 assert.equal(x.diagnostic.finalValidation,'pass');assert.equal(x.diagnostic.finalGrounding,null);assert.equal(x.diagnostic.providerUsed,'openai');assert.equal(x.diagnostic.fallbackActivated,false);assert.equal(x.diagnostic.developerReached,true);assert.equal(x.diagnostic.qaReached,true);
 for(const privateValue of [facts,'Высокое качество','Своя формулировка','TEST_ONLY_PRIVATE'])assert.ok(!JSON.stringify(x.diagnostic).includes(privateValue));
});
test('structured advantages report item eligibility without pretending to be legacy fragments',async()=>{
 const items=['лучшие на рынке цены','собственное производство','от замера до монтажа под ключ','качественная фурнитура','прозрачные цены'];
 const x=await run(advantagesPlan(),task=>{task.instruction='Сделай блок преимуществ';task.facts=confirmed({advantages:items.map(text=>({text}))});});
 assert.equal(x.result.success,true);assert.equal(x.diagnostic.advantagesFactCount,5);assert.equal(x.diagnostic.structuredAdvantageCount,5);assert.equal(x.diagnostic.legacyFragmentCount,0);assert.equal(x.diagnostic.fragmentGroupValid,false);assert.equal(x.diagnostic.deterministicPathActivated,true);assert.ok(!items.some(value=>JSON.stringify(x.diagnostic).includes(value)));
});

for(const [name,factSet] of [['missing',{facts:[]}],['legacy',confirmed({advantages:'Собственное производство'})]])test(`${name} advantages facts do not report deterministic activation`,async()=>{
 const x=await run(advantagesPlan(),task=>{task.blockType='advantages';task.facts=factSet;});assert.equal(x.result.success,true);assert.equal(x.diagnostic.fragmentGroupValid,false);assert.equal(x.diagnostic.deterministicPathActivated,false);assert.deepEqual(x.diagnostic.transformedFields,[]);assert.deepEqual(x.diagnostic.droppedFields,[]);
});

test('final grounding failure exposes only safe stage path and rule',async()=>{
 const x=await run(advantagesPlan('Высокое качество'),task=>{task.blockType='advantages';});assert.equal(x.result.errorCode,'INVALID_RESPONSE');assert.equal(x.diagnostic.finalValidation,'fail');assert.deepEqual(x.diagnostic.finalGrounding,{stage:'content-grounding',path:'sections[0].text',rule:'UNGROUNDED_QUALITY_CLAIM'});assert.equal(x.diagnostic.developerReached,false);assert.equal(x.diagnostic.qaReached,false);assert.ok(!JSON.stringify(x.diagnostic).includes('Высокое качество'));
});

test('diagnostic projection is strict, value-only and the API event retains the exact runId',()=>{
 const safe={requestedType:'advantages',intentBlockType:'advantages',taskBlockTypeExists:false,confirmedFactCount:3,advantagesFactCount:3,structuredAdvantageCount:0,fragmentCount:3,legacyFragmentCount:3,fragmentGroupValid:true,sectionType:'advantages',initialValidation:'pass',deterministicPathActivated:true,transformedFields:['points'],droppedFields:[],finalValidation:'fail',finalGrounding:{stage:'content-grounding',path:'sections[0].text',rule:'UNGROUNDED_QUALITY_CLAIM'},providerUsed:'openai',fallbackActivated:false,developerReached:false,qaReached:false};
 const runId=randomUUID(),events=[];reportBlockRuntimeDiagnostic(safe,runId,runtime,event=>events.push(event));assert.equal(events.length,1);assert.equal(events[0].runId,runId);
 assert.deepEqual(Object.keys(events[0]).sort(),['advantagesFactCount','buildIdentifier','buildTimestamp','configuredApiPort','confirmedFactCount','deterministicPathActivated','developerReached','droppedFields','event','fallbackActivated','finalGrounding','finalValidation','fragmentCount','fragmentGroupValid','initialValidation','intentBlockType','legacyFragmentCount','processPid','providerUsed','qaReached','requestedType','runId','sectionType','sourceArtifact','structuredAdvantageCount','taskBlockTypeExists','transformedFields'].sort());
 assert.deepEqual(Object.keys(events[0].finalGrounding).sort(),['path','rule','stage']);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
 for(const value of [{...safe,rawOutput:'PRIVATE'},safe]){
  if(value===safe)continue;assert.equal(safeBlockRuntimeDiagnostic(value),undefined);
 }
 let reads=0;const malicious={...safe};Object.defineProperty(malicious,'requestedType',{enumerable:true,get(){reads++;return 'advantages';}});assert.equal(safeBlockRuntimeDiagnostic(malicious),undefined);assert.equal(reads,0);
 reportBlockRuntimeDiagnostic({...safe,finalGrounding:{...safe.finalGrounding,value:'PRIVATE'}},runId,runtime,event=>events.push(event));assert.equal(events.length,2);assert.deepEqual(events[1].finalGrounding,safe.finalGrounding);assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});
