import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmed} from './fixtures/confirmed-facts.mjs';
import {validOutputs} from './fixtures/website.mjs';
import {neutralBlockPlan,blockTask,blockOptions} from './fixtures/block.mjs';
import {validateContentGrounding} from '../.test-build/packages/ai/src/validation/content-grounding-validator.js';
import {validateContentPlan} from '../.test-build/packages/ai/src/validation/content-plan-validator.js';
import {validateContentInput} from '../.test-build/packages/ai/src/agents/content-schema.js';
import {normalizeBlockIntent,validateCreativeContext} from '../.test-build/packages/ai/src/services/generation-intent.js';
import {replaceExactContent} from '../.test-build/packages/ai/src/services/exact-content-replacement.js';
import {publicSectionCopy} from '../.test-build/packages/ai/src/contracts/content-publication.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {buildDeveloperWebsite} from '../.test-build/packages/ai/src/services/developer-website-builder.js';
import {WebsiteWorkflowOrchestrator} from '../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js';
const input=(fact)=>({business:validOutputs().business,design:validOutputs().design,confirmedBusinessFacts:fact?confirmed({productsOrServices:fact}):{facts:[]}});
const plan=text=>{const p=neutralBlockPlan();p.sections[0].text=text;return p;};
for(const [source,claim] of [
 ['Выполняем монтаж стеклянных перегородок','Устанавливаем стеклянные перегородки'],
 ['Выполняем монтаж окон только при оформлении заказа','Устанавливаем окна только при оформлении заказа'],
 ['Не выполняем монтаж окон','Не устанавливаем окна'],
 ['Собственное производство','Располагаем собственным производством'],
 ['Прозрачные цены','Прозрачное ценообразование'],
 ['Качественная фурнитура','Фурнитура высокого качества'],
 ['Гарантия 5 лет при соблюдении условий','Гарантийный срок 5 лет при соблюдении условий'],
 ['Цена 100 рублей','Стоимость 100 рублей'],
 ['Срок доставки 5 дней','Доставка занимает 5 дней'],
])test(`safe full-clause paraphrase: ${claim}`,()=>assert.equal(validateContentGrounding(plan(claim),input(source)),undefined));
for(const [source,claim] of [
 ['Выполняем монтаж окон','Выполняем монтаж'],
 ['Выполняем монтаж окон','Устанавливаем двери'],
 ['Выполняем монтаж окон в Москве','Устанавливаем окна'],
 ['Выполняем монтаж окон только при оформлении заказа','Устанавливаем окна'],
 ['Не выполняем монтаж окон','Устанавливаем окна'],
 ['Конкурент выполняет монтаж окон','Устанавливаем окна'],
 ['Гарантия 5 лет при соблюдении условий','Гарантийный срок 5 лет'],
 ['Гарантия 5 лет','Гарантийный срок 10 лет'],
 ['Цена -100 рублей','Цена 100 рублей'],
 ['Цена 1,5 рублей','Цена 15 рублей'],
 ['Собственное производство только для окон','Располагаем собственным производством'],
 ['Выполняем монтаж окон. Доставляем двери','Устанавливаем двери'],
 ['Собственное производство, прозрачные цены','Располагаем собственным производством'],
])test(`no widened/pooled/contradictory paraphrase: ${source}`,()=>assert.ok(validateContentGrounding(plan(claim),input(source))));
for(const field of ['pageGoal','toneOfVoice','keyMessages','notes','purpose'])test(`internal ${field} is neither public copy nor factual authority`,()=>{
 const p=neutralBlockPlan(),claim='Выполняем монтаж';
 if(field==='purpose')p.sections[0].purpose=claim;else p[field]=field==='keyMessages'?[claim]:claim;
 assert.equal(validateContentPlan(p).valid,true);assert.equal(validateContentGrounding(p,input()),undefined);
 const developed=buildDeveloperWebsite({...input(),content:p},{sections:[{sectionIndex:0,alignment:'left'}]},'project-1');
 assert.ok(!JSON.stringify(developed.website).includes(claim));assert.ok(!JSON.stringify(publicSectionCopy(p.sections[0])).includes(claim));
 p.sections[0].text=claim;assert.equal(validateContentGrounding(p,input()).rule,'UNGROUNDED_SERVICE_CLAIM');
});
test('internal fields still obey schema and security',()=>{
 for(const text of ['<script>alert(1)</script>','password: TEST_ONLY_PRIVATE','x'.repeat(5000),'']){const p=neutralBlockPlan();p.notes=text;assert.equal(validateContentPlan(p).valid,false);}
});
for(const claim of ['Цена 100 рублей','Гарантия 5 лет','Выполняем монтаж','Собственное производство','Закалённое стекло'])test(`creative context never proves ${claim}`,()=>{
 const i=validateContentInput({...input(),creativeContext:{marketInsights:[claim],competitorInsights:[claim],seoContext:{topics:[claim],intent:claim}}});
 assert.ok(validateContentGrounding(plan(claim),i));
});
test('creative context is bounded plain data without getters or unknown authority fields',()=>{
 for(const v of [{confirmedFacts:['Монтаж']},{marketInsights:['https://example.com']},{marketInsights:Array(9).fill('Выбор')},{seoContext:{topics:['Выбор'],confirmed:true}},{marketInsights:['password: TEST_ONLY_PRIVATE']}])assert.throws(()=>validateCreativeContext(v));
 let reads=0;const v={};Object.defineProperty(v,'marketInsights',{enumerable:true,get(){reads++;return [];}});assert.throws(()=>validateCreativeContext(v));assert.equal(reads,0);
});
test('typo/short intent normalizes only creative routing; exact replacement remains literal',()=>{
 assert.deepEqual(normalizeBlockIntent('сдеалй блок примущства'),{operation:'GENERATE',rawInstruction:'сдеалй блок примущства',normalizedInstruction:'сделай блок преимущества',blockType:'advantages'});
 const raw='Замени текст на сдеалй блок примущства';assert.equal(normalizeBlockIntent(raw).operation,'REPLACE_EXACT');assert.equal(normalizeBlockIntent(raw).normalizedInstruction,raw);
});
const owned={projectId:'project-1',pageId:'page-1',blockId:'block-1',sectionIndex:0};
const command=(p,text)=>({operation:'REPLACE_EXACT',target:{projectId:owned.projectId,pageId:owned.pageId,blockId:owned.blockId,field:'text'},expectedText:p.sections[0].text,replacementText:text});
test('exact replacement preserves typo/punctuation bytes and leaves siblings unchanged',()=>{
 const p=neutralBlockPlan();p.sections.push({...p.sections[0],heading:'Другая тема'});const before=structuredClone(p),replacement='  Ваш ваариант — детали.  ';
 const result=replaceExactContent(p,input(),owned,command(p,replacement));assert.equal(result.sections[0].text,replacement);assert.deepEqual(result.sections[1],before.sections[1]);assert.deepEqual(p,before);
});
test('exact replacement rejects wrong scope, stale text and unsupported or unsafe claims',()=>{
 const p=neutralBlockPlan();for(const field of ['projectId','pageId','blockId']){const c=command(p,'Ваш вариант');c.target[field]='other';assert.throws(()=>replaceExactContent(p,input(),owned,c));}
 for(const text of ['Выполняем монтаж','<script>alert(1)</script>','password: TEST_ONLY_PRIVATE'])assert.throws(()=>replaceExactContent(p,input(),owned,command(p,text)));
 const stale=command(p,'Ваш вариант');stale.expectedText='old';assert.throws(()=>replaceExactContent(p,input(),owned,stale));
});
test('CTA retains its independent exact authority',()=>{
 const p=neutralBlockPlan();p.sections[0].callToAction='Заказать консультацию';assert.equal(validateContentGrounding(p,input('Заказать консультацию')).rule,'CTA_NOT_ALLOWED');
 const i=input();i.business.desiredActions=['Заказать консультацию'];assert.equal(validateContentGrounding(p,i),undefined);p.sections[0].text='Консультация';assert.ok(validateContentGrounding(p,i));
});
test('block typo request with sparse facts produces neutral cards; internal notes stay private',async()=>{
 const p=neutralBlockPlan();p.notes='Нужно обсудить монтаж и гарантии';p.sections[0].type='advantages';p.sections[0].points=['Выберите подходящий вариант','Сравните детали','Определите ваши приоритеты'];
 const task=blockTask();task.instruction='сдеалй блок примущства';task.creativeContext={marketInsights:['Прозрачные цены'],seoContext:{topics:['Выбор']}};
 const o=blockOptions({plan:p}),r=await(await createBlockWorkflow(o)).run(task);assert.equal(r.success,true);assert.equal(o.calls.length,2);assert.ok(!JSON.stringify(r.block).includes(p.notes));
 const data=JSON.parse(o.calls[0].req.messages[1].content);assert.equal(data.intent.blockType,'advantages');assert.deepEqual(data.groundingFacts,[]);assert.deepEqual(data.creativeContext,task.creativeContext);
});
test('block creative instruction cannot confirm a service; safe Content diagnostic survives',async()=>{
 const o=blockOptions({plan:plan('Выполняем монтаж')}),task=blockTask();task.instruction='Сделай блок. Выполняем монтаж';
 const r=await(await createBlockWorkflow(o)).run(task);assert.equal(o.calls.length,2);assert.deepEqual(r.contentValidationError,{stage:'content-grounding',path:'sections[0].text',rule:'UNGROUNDED_SERVICE_CLAIM'});assert.ok(!JSON.stringify(r).includes('Выполняем монтаж'));
});
test('block generation does not silently execute edits',async()=>{
 for(const instruction of ['Замени текст на новый','Удали блок','Перепиши заголовок','Перемести блок']){const o=blockOptions(),task=blockTask();task.instruction=instruction;const r=await(await createBlockWorkflow(o)).run(task);assert.equal(r.errorCode,'INVALID_INPUT');assert.equal(o.calls.length,0);}
});
test('whole-site passes internal planning and creative context without expanding fact authority',async()=>{
 const v=validOutputs();v.content.notes='Выполняем монтаж';let seen=false;
 const agents=Object.fromEntries(Object.entries(v).map(([type,output])=>[type,{type,async run(c){if(type==='content'){assert.deepEqual(c.input.creativeContext,{marketInsights:['Выполняем монтаж']});assert.ok(validateContentGrounding(plan('Выполняем монтаж'),c.input));}if(type==='developer'){seen=true;return {success:false,error:'Unavailable'};}return {success:true,output};}}]));
 const r=await new WebsiteWorkflowOrchestrator(agents).run({projectId:'project-1',goal:'Draft',input:{},creativeContext:{marketInsights:['Выполняем монтаж']},confirmedBusinessFacts:{facts:[]}});
 assert.equal(seen,true);assert.equal(r.state.content.notes,v.content.notes);
});
test('Developer reuse refuses an internal field even when its value exactly matches Content',async()=>{
 const {validateDeveloperReuse}=await import('../.test-build/packages/ai/src/validation/developer-output-validator.js');
 const p=neutralBlockPlan(),i={...input(),content:p};const output=buildDeveloperWebsite(i,{sections:[{sectionIndex:0,alignment:'left'}]},'project-1');
 assert.equal(validateDeveloperReuse(output,i),true);output.website.pages[0].blocks[0].content.purpose=p.sections[0].purpose;assert.equal(validateDeveloperReuse(output,i),false);
});
test('supported service paraphrase survives block Developer and QA boundaries',async()=>{
 const task=blockTask();task.facts=confirmed({productsOrServices:'Выполняем монтаж окон только при оформлении заказа'});
 const o=blockOptions({plan:plan('Устанавливаем окна только при оформлении заказа')}),r=await(await createBlockWorkflow(o)).run(task);
 assert.equal(r.success,true);assert.equal(o.calls.length,2);assert.equal(r.block.content.text,'Устанавливаем окна только при оформлении заказа');
});
test('exact point replacement changes one item only and command accessors never execute',()=>{
 const p=neutralBlockPlan();p.sections[0].points=['Выбор формы','Выбор цвета','Выбор деталей'];
 const c=command(p,'Ваш ваариант');c.target.field='points';c.target.pointIndex=1;c.expectedText=p.sections[0].points[1];
 const r=replaceExactContent(p,input(),owned,c);assert.deepEqual(r.sections[0].points,['Выбор формы','Ваш ваариант','Выбор деталей']);
 let reads=0;Object.defineProperty(c,'replacementText',{enumerable:true,get(){reads++;return 'Новый текст';}});assert.throws(()=>replaceExactContent(p,input(),owned,c));assert.equal(reads,0);
});
