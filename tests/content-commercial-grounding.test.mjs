import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContentGrounding,contentGroundingFacts} from '../.test-build/packages/ai/src/validation/content-grounding-validator.js';
import {validateContentPlan} from '../.test-build/packages/ai/src/validation/content-plan-validator.js';
import {confirmed} from './fixtures/confirmed-facts.mjs';
import {blockTask,blockOptions,neutralBlockPlan} from './fixtures/block.mjs';
import {blockAuthority,createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
const groups={CAPABILITY:['собственное производство','своё производство','свое производство','на собственном производстве','своего производства','собственная производственная база','собственной производственной базой','производим сами','изготавливаем сами','own production','in-house production','in-house manufacturing','own manufacturing','in‑house manufacturing'],QUALITY:['качественная фурнитура','качественные материалы','качественные комплектующие','качественное стекло','качественной фурнитурой','качественными материалами','качественных комплектующих','качественного стекла','quality hardware','quality materials','quality material','high-quality hardware','high-quality materials'],PRICE:['прозрачные цены','прозрачное ценообразование','честные цены','честная цена','прозрачной ценой','честное ценообразование','понятные цены','понятное ценообразование','прозрачных цен','прозрачными ценами','понятного ценообразования','transparent pricing','transparent prices','transparent price','clear pricing','honest pricing']};
const inspect=(text,facts={facts:[]})=>{const p=neutralBlockPlan();p.sections[0].text=text;return validateContentGrounding(p,blockAuthority({...blockTask(),facts}));};
for(const [category,phrases] of Object.entries(groups))for(const phrase of phrases)test(`${category}: ${phrase} needs exact confirmed evidence`,()=>{
 assert.deepEqual(inspect(phrase),{stage:'content-grounding',path:'sections[0].text',rule:`UNGROUNDED_${category}_CLAIM`});
 assert.equal(inspect(phrase,confirmed({advantages:phrase})),undefined);
});
for(const text of ['Производство стекла — сложный процесс','Информация о производстве стекла','Качество текста обсуждается отдельно','Список материалов','нужно подтвердить цены','требуются подтверждённые данные о ценах','Необходимо подтвердить условия доставки','Для публикации информации о качестве нужны подтверждённые данные.','Понятное описание вариантов','Production is a process','Read about materials','Please confirm prices','in-house manufacturingly','quality materialstuff','transparent pricingwise','несобственное производство','некачественная фурнитура','непрозрачные цены'])test(`new detectors do not broaden neutral/topic/word-boundary case: ${text}`,()=>assert.equal(inspect(text),undefined));
test('style exemptions and existing detectors remain active',()=>{
 const p=neutralBlockPlan();p.toneOfVoice='Профессиональный, экспертный и спокойный';assert.equal(validateContentGrounding(p,blockAuthority(blockTask())),undefined);
 for(const [text,kind] of [['Выполняем монтаж','SERVICE'],['Низкие цены','PRICE'],['Высокое качество','QUALITY'],['Полный спектр','CAPABILITY'],['Гарантия','GUARANTEE']])assert.equal(inspect(text).rule,`UNGROUNDED_${kind}_CLAIM`);
});
test('normalized complete clause remains exact; no substring, stripped qualifiers or pooling',()=>{
 assert.equal(inspect('СВОЕ ПРОИЗВОДСТВО',confirmed({advantages:'Своё производство.'})),undefined);
 for(const claim of ['собственное производство','качественная фурнитура','прозрачные цены']){
  assert.ok(inspect(claim,confirmed({advantages:claim+' при согласовании условий'})));
  assert.ok(inspect(claim,confirmed({advantages:'не '+claim})));
 }
 assert.ok(inspect('собственное производство',confirmed({advantages:'собственное',description:'производство'})));
});
test('recognized independent advantages list supports both atomic cards and original complete copy',()=>{
 const claims=['собственное производство','качественная фурнитура','прозрачные цены'],list=claims.join(', '),facts=confirmed({advantages:list});
 assert.ok(contentGroundingFacts(facts).includes(list));assert.equal(inspect(list,facts),undefined);for(const claim of claims)assert.equal(inspect(claim,facts),undefined);
});
test('provenance and Content input accessors remain rejected without execution',()=>{
 let calls=0;const facts=confirmed({advantages:'собственное производство'});
 const malicious={get facts(){calls++;return facts.facts;}};assert.throws(()=>contentGroundingFacts(malicious));
 const p=neutralBlockPlan();Object.defineProperty(p.sections[0],'text',{enumerable:true,get(){calls++;return 'собственное производство';}});assert.equal(validateContentPlan(p).valid,false);assert.equal(calls,0);
});
for(const phrase of ['собственное производство','качественная фурнитура','прозрачные цены'])test(`instruction cannot authorize ${phrase}; block stops without retry`,async()=>{
 const p=neutralBlockPlan();p.sections[0].text=phrase;const o=blockOptions({plan:p}),task={...blockTask(),instruction:'Сделай информационный блок: '+phrase};
 const r=await(await createBlockWorkflow(o)).run(task);assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(o.calls.length,2);assert.equal(r.block,undefined);
 const data=JSON.parse(o.calls[0].req.messages[1].content);assert.deepEqual(data.groundingFacts,[]);
});
