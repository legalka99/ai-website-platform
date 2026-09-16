import test from 'node:test';
import assert from 'node:assert/strict';
import { developerInput,layout } from './fixtures/developer.mjs';
import { validateDeveloperInput,validateDeveloperProposal,developerLayoutSchema } from '../.test-build/packages/ai/src/agents/developer-schema.js';
import { buildDeveloperWebsite,developerBlockType } from '../.test-build/packages/ai/src/services/developer-website-builder.js';
import { validateDeveloperOutput,validateDeveloperReuse } from '../.test-build/packages/ai/src/validation/developer-output-validator.js';
import { safeDeveloperValidationError } from '../.test-build/packages/ai/src/contracts/developer-validation-error.js';
import { Ajv } from 'ajv';
const output=()=>buildDeveloperWebsite(developerInput(),layout(),'project-1');
test('strict proposal -> canonical draft Website; server IDs, dates, palette, defaults and copy',()=>{
 const input=validateDeveloperInput(developerInput()),p=layout();assert.equal(new Ajv({strict:true}).compile(developerLayoutSchema(1))(p),true);assert.equal(validateDeveloperProposal(p,1),undefined);
 const result=buildDeveloperWebsite(input,p,'project-1');assert.equal(validateDeveloperOutput(result,'project-1').valid,true);assert.equal(validateDeveloperReuse(result,input),true);
 const w=result.website,page=w.pages[0];assert.equal(w.status,'draft');assert.equal(w.projectId,'project-1');assert.equal(page.slug,'/');assert.equal(page.status,'draft');assert.equal(page.title,input.content.pageTitle);assert.equal(page.seo.title,page.title);
 assert.deepEqual(w.designSystem.colors,input.design.colors);assert.deepEqual(w.designSystem.typography,{headingFont:'Arial',bodyFont:'Arial',baseFontSize:16});assert.deepEqual(w.designSystem.spacing,{section:64,block:24});assert.equal(w.designSystem.borderRadius,8);
 assert.equal(page.blocks[0].content.heading,input.content.sections[0].heading);assert.equal(page.blocks[0].content.callToAction,input.content.sections[0].callToAction);assert.equal(page.blocks[0].settings.alignment,'left');
 assert.match(w.id,/^[a-f0-9-]{36}$/);assert.ok(page.id.startsWith(w.id));assert.ok(page.blocks[0].id.startsWith(page.id));assert.equal(w.createdAt,result.generatedAt);assert.equal(w.updatedAt,result.generatedAt);assert.notEqual(output().website.id,w.id);
});
for(const type of ['hero','services','advantages','faq','cta','process','custom','gallery','contacts','testimonials','text'])test(`section mapping: ${type}`,()=>{
 const i=developerInput();i.content.sections[0].type=type;const result=buildDeveloperWebsite(validateDeveloperInput(i),layout(),'project-1');
 const expected=['process','custom','gallery','contacts','testimonials'].includes(type)?'text':type;
 assert.equal(developerBlockType(type),expected);assert.equal(result.website.pages[0].blocks[0].type,expected);assert.equal(validateDeveloperOutput(result,'project-1').valid,true);
});
test('all approved section fields survive byte-for-byte and order is preserved',()=>{
 const i=developerInput();i.content.sections=[{type:'hero',purpose:'Introduce services',heading:'Glass partitions',text:'Describe your project.',points:['Partitions','Shower enclosures'],callToAction:'Request a quote'},{type:'process',purpose:'Explain steps',text:'Describe the room.'}];
 const w=buildDeveloperWebsite(validateDeveloperInput(i),layout(2),'project-1').website;
 assert.deepEqual(w.pages[0].blocks.map(b=>b.order),[0,1]);assert.deepEqual(w.pages[0].blocks[0].content,{heading:i.content.sections[0].heading,text:i.content.sections[0].text,points:i.content.sections[0].points,callToAction:i.content.sections[0].callToAction});assert.equal(w.pages[0].seo.description,i.content.sections[0].text);
});
for(const [name,mutate] of [
 ['bad color',i=>i.design.colors.primary='red'],['css',i=>i.design.typography.headingStyle='url(https://evil.example)'],['style',i=>i.design.notes='<style>body</style>'],['font URL',i=>i.design.typography.bodyStyle='https://font.example'],['credential',i=>i.content.sections[0].text='password: TEST_ONLY'],['oversized',i=>i.design.description='a'.repeat(2001)],['ungrounded',i=>i.content.sections[0].text='High quality'],['new CTA',i=>i.content.sections[0].callToAction='Buy now'],['extra',i=>i.projectId='other'],['missing',i=>delete i.content]
])test(`Developer input rejected: ${name}`,()=>{const i=developerInput();mutate(i);assert.throws(()=>validateDeveloperInput(i));});
test('confirmed facts remain allowed through Developer',()=>{
 const i=developerInput();i.businessFacts=['Гарантия 5 лет'];i.content.sections[0].text='Гарантия 5 лет';const valid=validateDeveloperInput(i);assert.equal(validateDeveloperOutput(buildDeveloperWebsite(valid,layout(),'project-1'),'project-1').valid,true);
});
for(const bad of [{},{sections:[]},{sections:[{sectionIndex:0,alignment:'center',text:'High quality'}]},{sections:[{sectionIndex:1,alignment:'left'}]},{sections:[{sectionIndex:0,alignment:'url(evil)'}]}, {...layout(),projectId:'other'},{...layout(),status:'published'}])test('strict layout rejects extra fields, bad references and unsafe enums',()=>assert.ok(validateDeveloperProposal(bad,1)));
test('layout cannot duplicate, omit or reorder references',()=>{
 for(const indexes of [[0,0],[1,0]])assert.equal(validateDeveloperProposal({sections:indexes.map(sectionIndex=>({sectionIndex,alignment:'left'}))},2).rule,'SECTION_ORDER');
 assert.ok(validateDeveloperProposal(layout(1),2));
});
for(const [name,mutate] of [
 ['empty',o=>delete o.website],['pages',o=>o.website.pages=[]],['project',o=>o.website.projectId='other'],['malicious ID',o=>o.website.id='../private'],['empty ID',o=>o.website.id=''],['large ID',o=>o.website.id='a'.repeat(201)],
 ['duplicate page ID',o=>o.website.pages.push(structuredClone(o.website.pages[0]))],['duplicate block ID',o=>o.website.pages[0].blocks.push(structuredClone(o.website.pages[0].blocks[0]))],['cross level ID',o=>o.website.pages[0].id=o.website.id],
 ['duplicate slug',o=>{const p=structuredClone(o.website.pages[0]);p.id='page-other';p.blocks[0].id='block-other';p.order=1;o.website.pages.push(p);}],
 ['duplicate order',o=>{const b=structuredClone(o.website.pages[0].blocks[0]);b.id='block-other';o.website.pages[0].blocks.push(b);}],
 ['slug traversal',o=>o.website.pages[0].slug='/../secret'],['slug query',o=>o.website.pages[0].slug='/?a=1'],['slug protocol',o=>o.website.pages[0].slug='https://evil.example'],['slug case',o=>o.website.pages[0].slug='/Home'],
 ['unknown block',o=>o.website.pages[0].blocks[0].type='widget'],['custom block',o=>o.website.pages[0].blocks[0].type='custom'],['media block',o=>o.website.pages[0].blocks[0].type='image'],['contacts',o=>o.website.pages[0].blocks[0].type='contacts'],
 ['settings',o=>o.website.pages[0].blocks[0].settings={html:'<script>'}],['unknown content',o=>o.website.pages[0].blocks[0].content.component='Arbitrary'],['HTML',o=>o.website.pages[0].blocks[0].content.text='<b>text</b>'],['script',o=>o.website.pages[0].blocks[0].content.text='<script>alert(1)</script>'],['url',o=>o.website.pages[0].blocks[0].content.text='https://evil.example'],['secret',o=>o.website.pages[0].blocks[0].content.text='password: TEST_ONLY'],
 ['SEO',o=>o.website.pages[0].seo={description:'https://evil.example'}],['bad color',o=>o.website.designSystem.colors.primary='red'],['external font',o=>o.website.designSystem.typography.headingFont='https://evil.example'],['radius',o=>o.website.designSystem.borderRadius=10000],['invalid date',o=>o.generatedAt='2026-02-31T00:00:00.000Z'],['extra',o=>o.website.permissions=['admin']],
 ...['published','live','production','approved'].map(status=>[status,o=>o.website.status=status]),
])test(`Website runtime rejects ${name}`,()=>{const o=output();mutate(o);assert.equal(validateDeveloperOutput(o,'project-1').valid,false);});
for(const value of ['High quality glass partitions','Гарантия 5 лет','Изготовим за 3 дня','Бесплатный замер'])test(`copy reuse rejects new claim: ${value}`,()=>{
 const o=output();o.website.pages[0].blocks[0].content.heading=value;assert.equal(validateDeveloperReuse(o,developerInput()),false);
});
test('JSON boundaries reject getters, toJSON, cycles and huge data without executing code',()=>{
 let reads=0;
 for(const kind of ['getter','toJSON','cycle','oversize']){
  const p=layout();if(kind==='getter')Object.defineProperty(p,'extra',{enumerable:true,get(){reads++;return 'PRIVATE';}});if(kind==='toJSON')p.toJSON=()=>{reads++;return {};};if(kind==='cycle')p.self=p;if(kind==='oversize')p.extra='a'.repeat(5000);
  assert.ok(validateDeveloperProposal(p,1));
  const o=output();if(kind==='getter')Object.defineProperty(o.website,'name',{get(){reads++;return 'PRIVATE';}});if(kind==='toJSON')o.toJSON=()=>{reads++;return {};};if(kind==='cycle')o.self=o;if(kind==='oversize')o.notes='a'.repeat(65000);
  assert.equal(validateDeveloperOutput(o,'project-1').valid,false);
 }
 assert.equal(reads,0);
});
test('safe diagnostic projection excludes values and dynamic names',()=>{
 const e={stage:'developer-schema',path:'sections[0].alignment',rule:'SCHEMA_INVALID',value:'PRIVATE'};assert.deepEqual(safeDeveloperValidationError(e),{stage:e.stage,path:e.path,rule:e.rule});
 for(const bad of [{...e,path:'PRIVATE'},{...e,rule:'PRIVATE'},{...e,stage:'PRIVATE'}])assert.equal(safeDeveloperValidationError(bad),undefined);
 let reads=0;assert.equal(safeDeveloperValidationError({get stage(){reads++;return 'PRIVATE';}}),undefined);assert.equal(reads,0);
});

test('strict ID/slug end anchors reject trailing newline and controls',()=>{
 for(const field of ['id','slug'])for(const control of ['\n','\r','\u0000','\u200b']){
  const o=output();if(field==='id')o.website.pages[0].id+=''+control;else o.website.pages[0].slug+=control;
  assert.equal(validateDeveloperOutput(o,'project-1').valid,false);
 }
});
test('duplicate page order is rejected independently of IDs and slugs',()=>{
 const o=output(),page=structuredClone(o.website.pages[0]);page.id='other-page';page.slug='/other';page.blocks[0].id='other-block';o.website.pages.push(page);
 assert.ok(validateDeveloperOutput(o,'project-1').issues.some(i=>i.field==='developer.website.pages[1].order'));
});
test('typography maps descriptive serif intent to local font tokens only',()=>{
 const i=developerInput();i.design.typography={headingStyle:'Serif',bodyStyle:'Sans serif'};
 const o=buildDeveloperWebsite(validateDeveloperInput(i),layout(),'project-1');assert.equal(o.website.designSystem.typography.headingFont,'Georgia');assert.equal(o.website.designSystem.typography.bodyFont,'Arial');
});
