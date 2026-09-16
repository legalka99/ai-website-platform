import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContentPlan } from '../.test-build/packages/ai/src/validation/content-plan-validator.js';
import { validateWebsiteAgentOutput } from '../.test-build/packages/ai/src/orchestrator/website-result-validator.js';
import { validOutputs } from './fixtures/website.mjs';
const valid=()=>validOutputs().content;
test('valid ContentPlan supports ordered copy, bullets, FAQ directions and plain paragraphs',()=>{
 const plan=valid();plan.sections.push({type:'faq',purpose:'Resolve questions',heading:'Questions',points:['What information is needed for a quote?']});plan.sections[0].text='Custom glass partitions\nRequest a quote';
 assert.equal(validateContentPlan(plan).valid,true);assert.equal(validateWebsiteAgentOutput('content',plan,'project-1').valid,true);
});
for(const field of ['pageTitle','pageGoal','sections','toneOfVoice','keyMessages']) test(`Content requires ${field}`,()=>{
 const p=valid();delete p[field];assert.equal(validateContentPlan(p).valid,false);
});
for(const [label,mutate] of [
 ['empty sections',p=>p.sections=[]],['malformed section',p=>p.sections=[null]],['extra root',p=>p.private='UNSAFE_VALUE'],
 ['extra nested',p=>p.sections[0].private='UNSAFE_VALUE'],['oversized string',p=>p.pageTitle='a'.repeat(201)],
 ['oversized sections',p=>p.sections=Array.from({length:11},()=>({...p.sections[0]}))],['invalid CTA',p=>p.sections[0].callToAction=' '],
 ['missing CTA',p=>p.sections[0]={type:'cta',purpose:'Act',heading:'Ask'}],['too many CTAs',p=>p.sections=Array.from({length:5},()=>({...p.sections[0]}))],
 ['invalid section enum',p=>p.sections[0].type='arbitrary'],['no copy',p=>p.sections[0]={type:'text',purpose:'Describe'}],
 ['empty points',p=>p.sections[0].points=[]],['oversized points',p=>p.sections[0].points=Array(9).fill('A point')],
 ['empty point',p=>p.sections[0].points=['']],['too many FAQ directions',p=>p.sections=[{type:'faq',purpose:'Answer',points:Array(7).fill('Question?')}]],
 ['code',p=>p.notes='const code = 1;'],['script',p=>p.notes='<script>alert(1)</script>'],['markup',p=>p.notes='<b>Copy</b>'],
 ['credential',p=>p.notes='password: UNSAFE_VALUE'],['url',p=>p.notes='https://example.com'],['email',p=>p.notes='user@example.com'],
 ['blank purpose',p=>p.sections[0].purpose=' '],['invalid optional null',p=>p.notes=null],
])test(`Content rejects ${label} without echoing input`,()=>{
 const p=valid();mutate(p);const result=validateContentPlan(p);assert.equal(result.valid,false);assert.ok(!JSON.stringify(result).includes('UNSAFE_VALUE'));
});
for(const value of [null,{},[],undefined,'UNSAFE_VALUE'])test('non-object or empty Content rejected',()=>assert.equal(validateContentPlan(value).valid,false));
test('cycles/accessors/symbols/hidden properties safely rejected',()=>{
 const cycle=valid();cycle.loop=cycle;assert.equal(validateContentPlan(cycle).valid,false);
 const accessor=valid();let calls=0;Object.defineProperty(accessor,'notes',{get(){calls++;return 'secret';},enumerable:true});assert.equal(validateContentPlan(accessor).valid,false);assert.equal(calls,0);
 for(const key of ['hidden',Symbol('hidden')]){const p=valid();Object.defineProperty(p,key,{value:'UNSAFE_VALUE'});assert.equal(validateContentPlan(p).valid,false);}
});
