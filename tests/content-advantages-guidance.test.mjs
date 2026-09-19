import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTENT_INSTRUCTIONS} from '../.test-build/packages/ai/src/agents/default-content-agent.js';
import {buildContentWireSchema} from '../.test-build/packages/ai/src/agents/content-schema.js';
import {contentSectionSchema} from '../.test-build/packages/ai/src/contracts/content-plan-schema.js';
import {validateContentPlan} from '../.test-build/packages/ai/src/validation/content-plan-validator.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {blockOptions,blockTask,neutralBlockPlan} from './fixtures/block.mjs';
const branches=buildContentWireSchema(['Request a quote']).properties.sections.items.anyOf;
const points=branches.find(v=>v.properties.type.enum.includes('advantages')).properties.points;
test('advantages wire guidance describes standalone benefit cards, not product lists or geography',()=>{
 assert.match(points.description,/3–8 separate advantages/);assert.match(points.description,/prefer 3–6 concise points/);
 assert.match(points.description,/exactly one independent benefit or strength/);assert.match(points.description,/one UI card/);
 for(const word of ['product list','assortment categories','geography','city/region','general company description','ConfirmedBusinessFacts'])assert.ok(points.description.includes(word));
 assert.match(points.items.description,/One standalone advantage only/);assert.match(points.items.description,/Do not bundle benefits with commas, lists or "and"/);
 assert.equal(points.minItems,3);assert.equal(points.maxItems,8);assert.equal(points.items.maxLength,400);
});
test('only advantages request branch gains descriptions; global items and other section branches unchanged',()=>{
 assert.equal(contentSectionSchema.properties.points.description,undefined);assert.equal(contentSectionSchema.properties.points.items.description,undefined);assert.equal(contentSectionSchema.properties.points.minItems,1);
 for(const type of ['faq','hero','services','process','text','cta'])for(const branch of branches.filter(v=>v.properties.type.enum.includes(type))){
  const p=branch.properties.points.anyOf?.[0]??branch.properties.points;
  assert.deepEqual(p,{...contentSectionSchema.properties.points,...(type==='faq'?{maxItems:6}:{})});
 }
});
test('Content instructions specify advantages-only guidance and retain factual authority and scoped paraphrases',()=>{
 for(const text of ["section.type === 'advantages'",'3–8 separate advantages','prefer 3–6 concise points','exactly one independent benefit','one standalone advantage card','Do not bundle multiple advantages','geography, product list','applies only to advantages','creative requests, never factual authority','without asserting new company qualities','Paraphrase confirmed claims only when the subject, scope, quantities, conditions and negations are preserved'])assert.ok(CONTENT_INSTRUCTIONS.includes(text),text);
 for(const text of ['лучшие цены','высокое качество','собственное производство','deadlines, guarantees, services or geographic claims','one FAQ section with up to six','FAQ answers must not add unsupported guarantees','CallToAction must be one of business.desiredActions'])assert.ok(CONTENT_INSTRUCTIONS.includes(text),text);
});
test('structural validator does not infer semantics from commas or geography',()=>{
 const p=neutralBlockPlan();p.sections[0].type='advantages';p.sections[0].points=['Вариант, детали и выбор','Москва','Стеклянные двери'];
 assert.equal(validateContentPlan(p).valid,true);p.sections[0].points.pop();assert.equal(validateContentPlan(p).validationError.rule,'ADVANTAGES_POINTS_MIN');
});
test('block prompt uses shared guidance; instruction is not evidence, only one bounded correction on ungrounded claim',async()=>{
 const p=neutralBlockPlan();p.sections[0].type='advantages';p.sections[0].points=['лучшие на рынке цены','Выберите подходящий вариант','Сравните детали'];
 const original=structuredClone(p),options=blockOptions({plan:p}),task=blockTask();task.instruction='Сделай блок преимуществ. лучшие на рынке цены';
 const r=await(await createBlockWorkflow(options)).run(task);assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(options.calls.length,2);assert.deepEqual(p,original);
 const request=options.calls[0].req;assert.ok(request.messages[0].content.startsWith(CONTENT_INSTRUCTIONS));
 const data=JSON.parse(request.messages[1].content);assert.deepEqual(data.groundingFacts,[]);assert.deepEqual(data.confirmedBusinessFacts,{facts:[]});assert.equal(data.instruction,task.instruction);
});
test('neutral advantages pass block workflow unchanged with the usual two AI calls',async()=>{
 const p=neutralBlockPlan();p.sections[0].type='advantages';p.sections[0].points=['Выберите подходящий вариант','Сравните детали','Определите ваши приоритеты'];
 const options=blockOptions({plan:p}),r=await(await createBlockWorkflow(options)).run(blockTask());assert.equal(r.success,true);assert.equal(options.calls.length,2);assert.deepEqual(r.block.content.points,p.sections[0].points);
});
