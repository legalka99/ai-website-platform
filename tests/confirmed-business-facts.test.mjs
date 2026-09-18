import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmed,briefId} from './fixtures/confirmed-facts.mjs';
import {validOutputs} from './fixtures/website.mjs';
import {validateConfirmedBusinessFacts} from '../.test-build/packages/core/src/confirmed-business-facts.js';
import {contentGroundingFacts,validateContentGrounding} from '../.test-build/packages/ai/src/validation/content-grounding-validator.js';
import {validateContentInput} from '../.test-build/packages/ai/src/agents/content-schema.js';
import {normalizeBusinessProfile} from '../.test-build/packages/ai/src/agents/business-schema.js';
import {WebsiteWorkflowOrchestrator} from '../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js';
import {validateResult} from '../.test-build/packages/persistence/src/validation.js';
import {loadMigrations} from '../scripts/persistence-db.mjs';
const input=facts=>({business:validOutputs().business,design:validOutputs().design,...(facts?{confirmedBusinessFacts:facts}:{})});
const plan=text=>{const p=validOutputs().content;p.keyMessages=[text];return p;};

test('Brief fields retain provenance; only explicit factual categories become commercial evidence',()=>{
 const facts=confirmed({companyName:'Example',description:'Glass products',productsOrServices:'Выполняем монтаж',targetAudience:'Homeowners',geography:'Москва',advantages:'Консультация без предоплаты',websiteGoals:'Доставляем изделия',desiredActions:'Проводим замер',notes:'Проектируем конструкции'});
 assert.equal(facts.facts.length,6);assert.ok(Object.isFrozen(facts));
 for(const f of facts.facts)assert.deepEqual(f.source,{kind:'owner_brief',briefVersionId:briefId,field:f.category});
 const clauses=contentGroundingFacts(facts);
 assert.ok(clauses.includes('Выполняем монтаж'));assert.ok(clauses.includes('Консультация без предоплаты'));
 for(const value of ['Доставляем изделия','Проводим замер','Проектируем конструкции'])assert.ok(!clauses.includes(value));
});
for(const claim of ['Выполняем монтаж','Монтаж','Монтируем перегородки','Доставка','Доставляем изделия','Замер','Замеряем помещение','Консультация','Консультируем покупателей','Проектирование','Проектируем конструкции','Установка','Устанавливаем конструкции','Сопровождение','Сопровождаем заказ'])test(`service requires exact Brief evidence: ${claim}`,()=>{
 const p=plan(claim),facts=confirmed({productsOrServices:'Стеклянные изделия'});
 assert.deepEqual(validateContentGrounding(p,input(facts)),{stage:'content-grounding',path:'keyMessages[0]',rule:'UNGROUNDED_SERVICE_CLAIM'});
 assert.equal(validateContentGrounding(p,input(confirmed({productsOrServices:claim}))),undefined);
});
for(const claim of ['Консультация без предоплаты','Не выполняем монтаж','Доставляем изделия только при оформлении заказа','Монтаж если помещение подготовлено','Доставляем изделия, но только при оформлении заказа'])test('conditions and negations survive evidence extraction without granting unconditional promises',()=>{
 const facts=confirmed({productsOrServices:claim});assert.deepEqual(facts.facts[0].qualifiers,[claim]);
 assert.equal(validateContentGrounding(plan(claim),input(facts)),undefined);
 for(const short of ['Консультация','Выполняем монтаж','Доставляем изделия','Монтаж'])assert.ok(validateContentGrounding(plan(short),input(facts)));
});
test('model industry/profile/legacy facts cannot create evidence; product remains a product',()=>{
 const v=validOutputs(),facts=confirmed({productsOrServices:'Стеклянные изделия'});
 const business=normalizeBusinessProfile({...v.business,industry:'Доставляем изделия',productsOrServices:['Выполняем монтаж']},{companyName:'Example',description:'Glass products'});
 const i={...input(facts),business,businessFacts:['Консультация']};
 for(const text of ['Доставляем изделия','Выполняем монтаж','Консультация'])assert.ok(validateContentGrounding(plan(text),i));
 assert.equal(validateContentGrounding(plan('Стеклянные изделия'),i),undefined);
 assert.deepEqual(contentGroundingFacts(facts),['Стеклянные изделия']);
 assert.deepEqual(contentGroundingFacts(undefined),[]);
});
test('strict provenance contract rejects untrusted sources, extra fields, tampered qualifiers and accessors',()=>{
 const good=confirmed({productsOrServices:'Монтаж без предоплаты'});
 for(const change of [v=>v.extra='x',v=>v.facts[0].source.kind='model',v=>v.facts[0].source.briefVersionId='untrusted-id',v=>v.facts[0].source.field='industry',v=>v.facts[0].category='industry',v=>v.facts[0].category='websiteGoals',v=>v.facts[0].category='desiredActions',v=>v.facts[0].value='',v=>v.facts[0].qualifiers=[],v=>v.facts.push(v.facts[0])]){
  const v=structuredClone(good);change(v);assert.throws(()=>validateConfirmedBusinessFacts(v));assert.throws(()=>validateContentInput(input(v)));
 }
 let reads=0;const v=structuredClone(good);Object.defineProperty(v.facts[0],'value',{get(){reads++;return 'Montage';}});assert.throws(()=>validateConfirmedBusinessFacts(v));assert.equal(reads,0);
});
test('Business cannot expand authority; Content, downstream and workflow validator share original immutable facts',async()=>{
 const facts=confirmed({productsOrServices:'Выполняем монтаж'}),v=validOutputs();v.content=plan('Выполняем монтаж');let contentCalls=0,developerCalls=0;
 const agents={business:{type:'business',async run(c){assert.deepEqual(c.confirmedBusinessFacts,facts);c.confirmedBusinessFacts.facts[0].value='Доставляем изделия';return {success:true,output:{...v.business,industry:'Доставляем изделия'}};}},design:{type:'design',async run(){return {success:true,output:v.design};}},content:{type:'content',async run(c){contentCalls++;assert.deepEqual(c.input.confirmedBusinessFacts,facts);assert.equal(validateContentGrounding(v.content,c.input),undefined);assert.ok(validateContentGrounding(plan('Доставляем изделия'),c.input));return {success:true,output:v.content};}},developer:{type:'developer',async run(c){developerCalls++;assert.deepEqual(c.input.confirmedBusinessFacts,facts);return {success:false,error:'Unavailable'};}},qa:{type:'qa',async run(){assert.fail('QA must not run');}}};
 const r=await new WebsiteWorkflowOrchestrator(agents).run({projectId:'project-1',goal:'Draft',input:{},confirmedBusinessFacts:facts});
 assert.equal(contentCalls,1);assert.equal(developerCalls,1);assert.deepEqual(r.state.content,v.content);assert.deepEqual(contentGroundingFacts(facts),['Выполняем монтаж']);
 assert.doesNotThrow(()=>validateResult(r,'project-1',facts));
 assert.throws(()=>validateResult({...r,confirmedBusinessFacts:facts},'project-1',confirmed({productsOrServices:'Glass products'})));
});
test('Content agent success cannot bypass authoritative workflow revalidation',async()=>{
 const facts=confirmed({productsOrServices:'Glass products'}),v=validOutputs();let downstream=0;
 const agents=Object.fromEntries(Object.entries(v).map(([type,output])=>[type,{type,async run(){if(['developer','qa'].includes(type))downstream++;return {success:true,output:type==='content'?plan('Доставляем изделия'):output};}}]));
 const r=await new WebsiteWorkflowOrchestrator(agents).run({projectId:'project-1',goal:'Draft',input:{},confirmedBusinessFacts:facts});
 assert.equal(r.validationError.rule,'UNGROUNDED_SERVICE_CLAIM');assert.equal(downstream,0);assert.equal(r.state.content,undefined);
});
test('migration 006 is explicitly deferred',async()=>assert.ok(!(await loadMigrations()).some(m=>m.name==='006_content_correction_usage.sql')));
test('empty project knowledge permits creative structure and neutral copy without a detailed Brief',()=>{
 const facts=validateConfirmedBusinessFacts({facts:[]}),i=input(facts);
 const p=validOutputs().content;p.keyMessages=['Выберите подходящий вариант'];
 p.sections=[{type:'advantages',purpose:'Предложить структуру блока преимуществ',heading:'Что важно при выборе',points:['Форма','Цвет','Размер']}];
 assert.equal(validateContentGrounding(p,i),undefined);
 assert.deepEqual(contentGroundingFacts(facts),[]);
 const suggestion={kind:'ai_suggestion',text:'Выполняем монтаж',status:'confirmed'};
 assert.throws(()=>validateConfirmedBusinessFacts({facts:[suggestion]}));
 assert.ok(validateContentGrounding(plan(suggestion.text),i));
});
test('secret-like facts never reach Content prompt boundary',()=>{
 const facts=confirmed({description:'password: TEST_ONLY_PRIVATE'});
 assert.throws(()=>validateContentInput(input(facts)),e=>e.code==='INVALID_INPUT');
});
test('market insights and AI proposals cannot grant commercial authority before owner confirmation',()=>{
 for(const claim of ['Монтаж за 1 день','Бесплатный замер','Гарантия 5 лет','Цена 100 рублей']){
  for(const source of [{kind:'market_research',references:['research-1']},{kind:'ai_generated',marketInsightIds:['insight-1']},{kind:'user_instruction'}]){
   const fake=structuredClone(confirmed({productsOrServices:claim}));fake.facts[0].source=source;
   assert.throws(()=>validateConfirmedBusinessFacts(fake));
   assert.throws(()=>validateContentInput(input(fake)));
  }
  assert.ok(validateContentGrounding(plan(claim),input(confirmed({productsOrServices:'Glass products'}))));
  // Explicitly recorded Owner Brief assertion is the only implemented promotion path.
  assert.equal(validateContentGrounding(plan(claim),input(confirmed({productsOrServices:claim}))),undefined);
 }
});
