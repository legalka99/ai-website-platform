import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmed,briefId} from './fixtures/confirmed-facts.mjs';
import {validateConfirmedBusinessFacts,factualClauses} from '../.test-build/packages/core/src/confirmed-business-facts.js';
import {validateContentGrounding,contentGroundingFacts} from '../.test-build/packages/ai/src/validation/content-grounding-validator.js';
import {validateContentInput} from '../.test-build/packages/ai/src/agents/content-schema.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {blockOptions,blockTask,neutralBlockPlan} from './fixtures/block.mjs';
import {validOutputs} from './fixtures/website.mjs';
const list='собственное производство, качественная фурнитура, прозрачные цены';
const input=facts=>({...((({business,design})=>({business,design}))(validOutputs())),confirmedBusinessFacts:facts});
const inspect=(text,facts)=>{const p=neutralBlockPlan();p.sections[0].text=text;return validateContentGrounding(p,input(facts));};
test('one saved category yields deterministic frozen fragments with original owner provenance',()=>{
 const f=confirmed({advantages:list});assert.equal(f.facts.length,3);assert.deepEqual(f,confirmed({advantages:list}));assert.deepEqual(validateConfirmedBusinessFacts(JSON.parse(JSON.stringify(f))),f);
 for(const [index,fact] of f.facts.entries()){
  assert.deepEqual(fact.source,{kind:'owner_brief',briefVersionId:briefId,field:'advantages',fragment:{index,originalValue:list}});
  assert.equal(fact.value,list.split(', ')[index]);assert.ok(Object.isFrozen(fact.source.fragment));
 }
 assert.deepEqual(factualClauses(list),[list]);
});
for(const mutate of [f=>f.facts.push(f.facts[0]),f=>f.facts.pop(),f=>f.facts.reverse(),f=>f.facts[0].source.fragment.index=1,f=>f.facts[0].value='Монтаж',f=>f.facts[0].source.fragment.extra=true,f=>f.facts[0].source.fragment.originalValue='Монтаж, Доставка',f=>f.facts[0].source.field='description',f=>f.facts[0].source.kind='model',f=>delete f.facts[0].source.fragment])test('forged, duplicate, partial or mismatched fragment groups fail closed',()=>{
 const f=structuredClone(confirmed({advantages:list}));mutate(f);assert.throws(()=>validateConfirmedBusinessFacts(f));assert.throws(()=>validateContentInput(input(f)));
});
test('fragment accessors are rejected without execution',()=>{
 const f=structuredClone(confirmed({advantages:list}));let reads=0;Object.defineProperty(f.facts[0].source.fragment,'index',{enumerable:true,get(){reads++;return 0;}});assert.throws(()=>validateConfirmedBusinessFacts(f));assert.equal(reads,0);
});
for(const claim of ['Собственное производство','Фурнитура высокого качества','Прозрачное ценообразование'])test(`atomic evidence grounds standalone paraphrase: ${claim}`,()=>assert.equal(inspect(claim,confirmed({advantages:list})),undefined));
for(const text of [
 'Монтаж предоставляется только при заказе от 100 000 ₽, доставка оплачивается отдельно',
 'Собственное производство только для окон, качественная фурнитура',
 'Не собственное производство, качественная фурнитура',
 'Собственное производство, фурнитура высокого качества при заказе',
 'Гарантия 5 лет, прозрачные цены',
 'У конкурента собственное производство, качественная фурнитура',
 'Собственное производство, неизвестное преимущество',
 'Собственное производство, качественная фурнитура кроме отдельных моделей',
 'Собственное производство, прозрачные цены для Москвы',
 'Собственное производство, собственное производство',
 'Собственное производство,',
])test(`ambiguous/qualified list stays whole: ${text}`,()=>{
 const f=confirmed({advantages:text});assert.equal(f.facts.length,1);assert.equal(f.facts[0].value,text);assert.equal(f.facts[0].source.fragment,undefined);
 if(text!=='Собственное производство,')assert.ok(inspect('Собственное производство',f));
});
test('conditional, negative and quantity facts retain full claims, never authorize shorter promises',()=>{
 for(const [fact,claim] of [['Монтаж только при заказе от 100 000 ₽, доставка оплачивается отдельно','Монтаж'],['Не выполняем монтаж окон','Устанавливаем окна'],['Гарантия 5 лет','Гарантия']]){
  const f=confirmed({productsOrServices:fact});assert.equal(f.facts[0].value,fact);assert.equal(inspect(fact,f),undefined);assert.ok(inspect(claim,f));
 }
});
test('only independent known offerings split; scope is never inherited or widened',()=>{
 const f=confirmed({productsOrServices:'Монтаж окон, монтаж дверей'});assert.equal(f.facts.length,2);assert.equal(inspect('Устанавливаем окна',f),undefined);assert.ok(inspect('Выполняем монтаж',f));
 for(const value of ['Монтаж окон, дверей','Монтаж окон, монтаж дверей только в Москве','Не монтаж окон, монтаж дверей'])assert.equal(confirmed({productsOrServices:value}).facts.length,1);
});
test('other Brief categories and legacy whole-field facts remain intact',()=>{
 for(const category of ['description','companyName','targetAudience','geography'])assert.equal(confirmed({[category]:list}).facts.length,1);
 const old={facts:[{category:'advantages',value:list,source:{kind:'owner_brief',briefVersionId:briefId,field:'advantages'},qualifiers:[]}]};assert.deepEqual(validateConfirmedBusinessFacts(old),old);
 assert.equal(inspect(list,old),undefined);assert.ok(inspect('Собственное производство',old));
});
test('atomic facts cannot pool tokens or borrow authority from creative context',()=>{
 const f=confirmed({advantages:list});assert.ok(inspect('Собственное производство высокого качества',f));assert.ok(inspect('Собственное производство при любом заказе',f));
 const i=validateContentInput({...input(confirmed({websiteGoals:list,desiredActions:list,notes:list})),creativeContext:{marketInsights:[list],competitorInsights:[list],seoContext:{topics:[list]}}});
 assert.deepEqual(contentGroundingFacts(i.confirmedBusinessFacts),[]);const p=neutralBlockPlan();p.sections[0].text='Собственное производство';assert.ok(validateContentGrounding(p,i));
});
test('Block inferred advantages pins confirmed atomic facts verbatim without corrective generation',async()=>{
 const task=blockTask();task.instruction='Сделай блок преимуществ';task.facts=confirmed({advantages:list});const p=neutralBlockPlan();p.sections[0].type='advantages';p.sections[0].points=['Собственное производство','Фурнитура высокого качества','Прозрачное ценообразование'];
 const o=blockOptions({plan:p}),r=await(await createBlockWorkflow(o)).run(task);assert.equal(r.success,true);assert.equal(o.calls.length,2);assert.deepEqual(r.block.content.points,['собственное производство','качественная фурнитура','прозрачные цены']);assert.deepEqual(r.content.sections[0].points,r.block.content.points);
});
const liveItems=['лучшие на рынке цены','собственное производство','от замера до монтажа "под ключ"','качественная фурнитура','прозрачные цены'];
const liveLegacy=liveItems.join(', ');
test('historical mixed advantages remain one legacy fact while structured entries become independent exact facts',()=>{
 const legacy=confirmed({advantages:liveLegacy});assert.equal(legacy.facts.length,1);assert.equal(legacy.facts[0].value,liveLegacy);assert.equal(legacy.facts[0].source.item,undefined);assert.equal(legacy.facts[0].source.fragment,undefined);
 const structured=confirmed({advantages:liveItems.map(text=>({text}))});assert.equal(structured.facts.length,5);
 for(const [index,fact] of structured.facts.entries()){
  assert.equal(fact.value,liveItems[index]);assert.deepEqual(fact.source,{kind:'owner_brief',briefVersionId:briefId,field:'advantages',item:{index,count:5}});
 }
});
test('structured conditions and negations preserve complete authority without widening',()=>{
 for(const [fact,unsupported] of [['Монтаж только при заказе от 100 000 ₽','Выполняем монтаж'],['Не выполняем монтаж окон','Выполняем монтаж окон'],['Собственное производство только для окон','Собственное производство']]){
  const facts=confirmed({advantages:[{text:fact}]});assert.equal(inspect(fact,facts),undefined);assert.ok(inspect(unsupported,facts));
 }
 const pricing=confirmed({advantages:[{text:'лучшие на рынке цены'}]});assert.ok(inspect('Скидка 50%',pricing));
 const turnkey=confirmed({advantages:[{text:'от замера до монтажа "под ключ"'}]});assert.ok(inspect('Бесплатный замер и монтаж',turnkey));
});
test('structured provenance rejects partial groups, duplicate authority and item accessors',()=>{
 const facts=structuredClone(confirmed({advantages:liveItems.map(text=>({text}))}));facts.facts.pop();assert.throws(()=>validateConfirmedBusinessFacts(facts));
 const duplicate=structuredClone(confirmed({advantages:liveItems.map(text=>({text}))}));duplicate.facts[1].value=duplicate.facts[0].value;assert.throws(()=>validateConfirmedBusinessFacts(duplicate));
 const accessor=structuredClone(confirmed({advantages:liveItems.map(text=>({text}))}));let reads=0;Object.defineProperty(accessor.facts[0].source.item,'count',{enumerable:true,get(){reads++;return 5;}});assert.throws(()=>validateConfirmedBusinessFacts(accessor));assert.equal(reads,0);
});
test('Block inferred advantages uses all structured owner items verbatim and reaches Developer and QA',async()=>{
 const task=blockTask();task.instruction='Сделай блок преимуществ';task.facts=confirmed({advantages:liveItems.map(text=>({text}))});const p=neutralBlockPlan();p.sections[0].type='advantages';p.sections[0].points=['Generic one','Generic two','Generic three'];
 const o=blockOptions({plan:p}),r=await(await createBlockWorkflow(o)).run(task);assert.equal(r.success,true);assert.equal(o.calls.length,2);assert.deepEqual(r.block.content.points,liveItems);assert.deepEqual(r.content.sections[0].points,liveItems);
});
