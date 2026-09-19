import test from 'node:test';
import assert from 'node:assert/strict';
import {qaInput,qaContext,qaOptions,qaWire,qaIssue} from './fixtures/qa.mjs';
import {blockTask,blockOptions} from './fixtures/block.mjs';
import {createRoutedQAService} from '../.test-build/packages/ai/src/services/routed-qa-service.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {qaSchemaForScope,parseQAWire,snapshotQAInput,deterministicQA,qaWireSchema} from '../.test-build/packages/ai/src/agents/qa-schema.js';
import {QA_INSTRUCTIONS,BLOCK_QA_INSTRUCTIONS} from '../.test-build/packages/ai/src/agents/default-qa-agent.js';
const seo=()=>({...qaWire(),issues:[qaIssue({code:'SEO_INVALID',message:'Improve page meta description.'})]});
test('block wire schema excludes SEO; whole-site schema/parser retains it',()=>{
 const i=snapshotQAInput(qaInput()),block=qaSchemaForScope('block');
 assert.ok(!block.properties.issues.items.properties.code.enum.includes('SEO_INVALID'));
 assert.ok(qaWireSchema.properties.issues.items.properties.code.enum.includes('SEO_INVALID'));
 assert.ok(parseQAWire(seo(),i).report);assert.equal(parseQAWire(seo(),i,'block').validationError.rule,'SCHEMA_INVALID');
 assert.ok(QA_INSTRUCTIONS.includes('semantic SEO quality'));assert.ok(!BLOCK_QA_INSTRUCTIONS.includes('SEO_INVALID'));assert.match(BLOCK_QA_INSTRUCTIONS,/Never report these under another code/);
});
test('block deterministic QA skips page SEO only; website SEO and other checks stay enforced',()=>{
 const i=qaInput();delete i.website.pages[0].seo;
 assert.ok(deterministicQA(snapshotQAInput(i),'project-1').some(v=>v.code==='SEO_INVALID'));
 assert.ok(!deterministicQA(snapshotQAInput(i),'project-1','block').some(v=>v.code==='SEO_INVALID'));
 i.website.designSystem.colors.primary='#123456';assert.ok(deterministicQA(snapshotQAInput(i),'project-1','block').some(v=>v.code==='DESIGN_MISMATCH'));
});
test('actual Block workflow uses block-specific prompt/schema and omits page SEO data',async()=>{
 const o=blockOptions(),r=await(await createBlockWorkflow(o)).run(blockTask());assert.equal(r.success,true);
 const req=o.calls.find(v=>v.req.structuredOutput.name==='qa_report').req;
 assert.equal(req.messages[0].content,BLOCK_QA_INSTRUCTIONS);assert.ok(!req.structuredOutput.schema.properties.issues.items.properties.code.enum.includes('SEO_INVALID'));
 const data=JSON.parse(req.messages[1].content);assert.equal(data.website.pages[0].seo,undefined);
});
test('out-of-scope provider SEO output fails closed with safe diagnostic, never becomes Block report',async()=>{
 const o=blockOptions({qa:seo()}),r=await(await createBlockWorkflow(o)).run(blockTask());assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(r.qa,undefined);assert.equal(r.qaValidationError.stage,'qa-schema');assert.equal(o.calls.length,2);assert.ok(!JSON.stringify(r).includes('meta description'));
});
test('whole-site routed QA still receives SEO data and can return SEO findings',async()=>{
 const o=qaOptions('openai',undefined,seo()),r=await(await createRoutedQAService(o)).run(qaContext());assert.equal(r.success,true);assert.equal(r.output.issues[0].code,'SEO_INVALID');
 assert.equal(o.requests[0].messages[0].content,QA_INSTRUCTIONS);assert.ok(JSON.parse(o.requests[0].messages[1].content).website.pages[0].seo);
});
test('scope is server-selected, cannot be supplied in agent input; block mode requires a single target',async()=>{
 const context=qaContext();context.input.reviewScope='block';const o=qaOptions();assert.equal((await(await createRoutedQAService(o)).run(context)).errorCode,'INVALID_INPUT');assert.equal(o.requests.length,0);
 const multi=qaContext();multi.input.website.pages[0].blocks.push(structuredClone(multi.input.website.pages[0].blocks[0]));const p=qaOptions();assert.equal((await(await createRoutedQAService(p,'block')).run(multi)).errorCode,'INVALID_INPUT');assert.equal(p.requests.length,0);
});
