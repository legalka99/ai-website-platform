import {confirmed} from './fixtures/confirmed-facts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { qaInput,qaWire,qaIssue } from './fixtures/qa.mjs';
import { snapshotQAInput,deterministicQA,parseQAWire,mergeQAFindings,qaWireSchema,QA_AI_CODES } from '../.test-build/packages/ai/src/agents/qa-schema.js';
import { Ajv } from 'ajv';
import { validateQAReport,QA_CODE_MINIMUM } from '../.test-build/packages/ai/src/validation/qa-report-validator.js';
import { safeQAValidationError } from '../.test-build/packages/ai/src/contracts/qa-validation-error.js';
test('QA input snapshot, deterministic checks and server report timestamp',()=>{
 const i=qaInput(),copy=snapshotQAInput(i);assert.notEqual(copy,i);assert.deepEqual(deterministicQA(copy,'project-1'),[]);
 const {report}=parseQAWire(qaWire(),copy);assert.equal(validateQAReport(report).valid,true);assert.equal(report.passed,true);assert.match(report.checkedAt,/^\d{4}-/);assert.deepEqual(i,copy);
});
for(const [code,severity] of [['BUSINESS_ALIGNMENT','critical'],['BUSINESS_ALIGNMENT','error']])test(`passed=true with ${severity} rejected even at score 99`,()=>{
 const p=qaWire();p.score=99;p.issues=[qaIssue({code,severity})];assert.deepEqual(parseQAWire(p,qaInput()).validationError,{stage:'qa-consistency',path:'passed',rule:'PASS_WITH_BLOCKING_ISSUE'});
});
test('severity below code minimum is raised server-side and still cannot create PASS',()=>{
 const failed=qaWire(false);failed.issues=[qaIssue({code:'BUSINESS_ALIGNMENT',severity:'info'})];
 const failedResult=parseQAWire(failed,qaInput());assert.equal(failedResult.report.issues[0].severity,'error');assert.equal(failedResult.report.passed,false);

 const passing=qaWire();passing.issues=[qaIssue({code:'BUSINESS_ALIGNMENT',severity:'info'})];
 assert.deepEqual(parseQAWire(passing,qaInput()).validationError,{stage:'qa-consistency',path:'passed',rule:'PASS_WITH_BLOCKING_ISSUE'});

 const elevated=qaWire(false);elevated.issues=[qaIssue({code:'SEO_INVALID',severity:'critical'})];
 assert.equal(parseQAWire(elevated,qaInput()).report.issues[0].severity,'critical');
});
test('valid failed verdict is a report, warnings may pass, score alone does not grant PASS',()=>{
 assert.equal(parseQAWire(qaWire(false),qaInput()).report.passed,false);
 const p=qaWire();p.score=0;p.issues=[qaIssue()];assert.equal(parseQAWire(p,qaInput()).report.passed,true);
});
for(const [label,edit] of [
 ['empty',p=>Object.keys(p).forEach(k=>delete p[k])],['extra',p=>p.projectId='PRIVATE'],['checkedAt',p=>p.checkedAt='2026-09-16T00:00:00.000Z'],['code',p=>p.issues=[qaIssue({code:'UNKNOWN'})]],['severity',p=>p.issues=[qaIssue({severity:'high'})]],
 ['score',p=>p.score=101],['negative score',p=>p.score=-1],['passed',p=>p.passed='true'],['too many',p=>p.issues=Array.from({length:21},()=>qaIssue())],['oversize',p=>p.issues=[qaIssue({message:'a'.repeat(601)})]],
 ['empty text',p=>p.issues=[qaIssue({message:''})]],['HTML',p=>p.issues=[qaIssue({message:'<script>alert(1)</script>'})]],['secret',p=>p.issues=[qaIssue({message:'password: TEST_ONLY'})]],['URL',p=>p.notes='https://evil.example'],
 ['duplicate',p=>p.issues=[qaIssue(),qaIssue()]],['missing page',p=>p.issues=[qaIssue({pageIndex:9})]],['missing block',p=>p.issues=[qaIssue({blockIndex:9})]],['unscoped block',p=>p.issues=[qaIssue({pageIndex:null})]],['LLM ID',p=>p.issues=[{...qaIssue(),pageId:'other'}]],
])test(`QA wire rejects ${label} without rejected values`,()=>{
 const p=qaWire();edit(p);const r=parseQAWire(p,qaInput());assert.equal(r.report,undefined);assert.ok(r.validationError);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.ok(!JSON.stringify(r).includes('TEST_ONLY'));
});
test('indexes map only to known Website IDs',()=>{
 const i=qaInput(),p=qaWire();p.issues=[qaIssue()];const report=parseQAWire(p,i).report;assert.equal(report.issues[0].pageId,i.website.pages[0].id);assert.equal(report.issues[0].blockId,i.website.pages[0].blocks[0].id);
});
for(const [name,edit] of [
 ['copy',i=>i.website.pages[0].blocks[0].content.heading='Different products'],['CTA',i=>i.website.pages[0].blocks[0].content.callToAction='Free consultation'],['deleted section',i=>i.website.pages[0].blocks=[]],
 ['duplicate ID',i=>i.website.pages[0].blocks.push(structuredClone(i.website.pages[0].blocks[0]))],['status',i=>i.website.status='published'],['custom',i=>i.website.pages[0].blocks[0].type='custom'],['slug',i=>i.website.pages[0].slug='/../private'],
 ['HTML',i=>i.website.pages[0].blocks[0].content.text='<script>alert(1)</script>'],['URL',i=>i.website.pages[0].blocks[0].content.text='javascript:alert(1)'],['secret',i=>i.website.pages[0].blocks[0].content.text='Bearer TEST_ONLY'],['font',i=>i.website.designSystem.typography.headingFont='url(example)'],
 ['missing copy',i=>delete i.website.pages[0].blocks[0].content.callToAction],['hidden block',i=>i.website.pages[0].blocks[0].visible=false],['order',i=>i.website.pages[0].blocks[0].order=1],
])test(`pre-QA detects ${name}`,()=>{
 const i=qaInput();edit(i);const findings=deterministicQA(snapshotQAInput(i),'project-1');assert.ok(findings.some(f=>['error','critical'].includes(f.severity)));assert.ok(!JSON.stringify(findings).includes('TEST_ONLY'));
});
for(const text of ['Высокое качество','Гарантия 5 лет','Изготовим за 3 дня','Бесплатный замер','Лучшие цены','Тысячи клиентов'])test(`QA independently rejects ungrounded source: ${text}`,()=>{
 const i=qaInput();i.reviewContext.content.sections[0].text=text;i.website.pages[0].blocks[0].content.text=text;assert.equal(deterministicQA(snapshotQAInput(i),'project-1')[0].code,'UNGROUNDED_CLAIM');
});
test('confirmed claim passes deterministic grounding',()=>{
 const i=qaInput();i.reviewContext.confirmedBusinessFacts=confirmed({advantages:'Гарантия 5 лет'});i.reviewContext.content.sections[0].text='Гарантия 5 лет';i.website.pages[0].blocks[0].content.text='Гарантия 5 лет';assert.deepEqual(deterministicQA(snapshotQAInput(i),'project-1'),[]);
});
test('deterministic Design/SEO warnings survive model PASS and do not mutate Website',()=>{
 const i=qaInput();delete i.website.pages[0].seo;i.website.designSystem.colors.primary='#123456';const before=structuredClone(i),findings=deterministicQA(snapshotQAInput(i),'project-1');assert.deepEqual(findings.map(i=>i.code),['DESIGN_MISMATCH','SEO_INVALID']);
 const r=mergeQAFindings(parseQAWire(qaWire(),i).report,findings);assert.equal(r.passed,true);assert.equal(r.issues.length,2);assert.deepEqual(i,before);
});
test('input and output getters/toJSON/cycles/symbols/hidden fields are rejected without invocation',()=>{
 let reads=0;
 for(const target of ['input','wire'])for(const kind of ['getter','toJSON','cycle','symbol','hidden','prototype','oversize']){
  const value=target==='input'?qaInput():qaWire();
  if(kind==='getter')Object.defineProperty(value,'extra',{enumerable:true,get(){reads++;return 'PRIVATE';}});if(kind==='toJSON')value.toJSON=()=>{reads++;return {};};if(kind==='cycle')value.self=value;if(kind==='symbol')value[Symbol('x')]='PRIVATE';if(kind==='hidden')Object.defineProperty(value,'extra',{value:'PRIVATE'});if(kind==='prototype')Object.setPrototypeOf(value,{extra:'PRIVATE'});if(kind==='oversize')value.extra='a'.repeat(120000);
  if(target==='input')assert.throws(()=>snapshotQAInput(value));else assert.ok(parseQAWire(value,qaInput()).validationError);
 }assert.equal(reads,0);
});
test('diagnostic allowlist excludes dynamic fields and getters',()=>{
 const e={stage:'qa-consistency',path:'passed',rule:'PASS_WITH_BLOCKING_ISSUE',raw:'PRIVATE'};assert.deepEqual(safeQAValidationError(e),{stage:e.stage,path:e.path,rule:e.rule});assert.equal(safeQAValidationError({...e,path:'PRIVATE'}),undefined);
 let reads=0;assert.equal(safeQAValidationError({get stage(){reads++;return 'qa-schema';}}),undefined);assert.equal(reads,0);
});
const validateWire=new Ajv({strict:true}).compile(qaWireSchema);
for(const code of Object.keys(QA_CODE_MINIMUM).filter(code=>!QA_AI_CODES.includes(code)))test(`provider wire rejects server/legacy code ${code}, final report retains it`,()=>{
 const wire=qaWire(false);wire.issues=[qaIssue({code,severity:QA_CODE_MINIMUM[code]})];
 assert.equal(validateWire(wire),false);assert.equal(parseQAWire(wire,qaInput()).validationError.rule,'SCHEMA_INVALID');
 const report={passed:false,score:0,checkedAt:new Date().toISOString(),issues:[{code,severity:QA_CODE_MINIMUM[code],message:'Server finding.'}]};
 assert.equal(validateQAReport(report).valid,true);
});
for(const code of QA_AI_CODES)test(`provider semantic code ${code} passes with server severity minimum`,()=>{
 const wire=qaWire(false);wire.issues=[qaIssue({code,severity:'info'})];assert.equal(validateWire(wire),true);
 const parsed=parseQAWire(wire,qaInput());assert.equal(parsed.report.issues[0].severity,QA_CODE_MINIMUM[code]);
});
for(const [code,edit] of [
 ['CONTENT_MISMATCH',i=>i.website.pages[0].blocks[0].content.heading='Different products'],
 ['CTA_MISMATCH',i=>i.website.pages[0].blocks[0].content.callToAction='Contact us'],
 ['UNSAFE_CONTENT',i=>i.website.pages[0].blocks[0].content.text='<script>alert(1)</script>'],
])test(`server still produces valid blocking ${code}`,()=>{
 const input=qaInput();edit(input);const issues=deterministicQA(snapshotQAInput(input),'project-1');assert.ok(issues.some(i=>i.code===code));
 assert.equal(validateQAReport({passed:false,score:0,issues,checkedAt:new Date().toISOString()}).valid,true);
});
test('final report validator still rejects lowered deterministic severity',()=>{
 assert.equal(validateQAReport({passed:false,score:0,checkedAt:new Date().toISOString(),issues:[{code:'UNSAFE_CONTENT',severity:'info',message:'Server finding.'}]}).valid,false);
});
