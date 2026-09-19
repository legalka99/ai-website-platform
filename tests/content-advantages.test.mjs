import test from 'node:test';
import assert from 'node:assert/strict';
import {Ajv} from 'ajv';
import {validateContentPlan} from '../.test-build/packages/ai/src/validation/content-plan-validator.js';
import {buildContentWireSchema,normalizeContentWire} from '../.test-build/packages/ai/src/agents/content-schema.js';
import {contentSectionSchema} from '../.test-build/packages/ai/src/contracts/content-plan-schema.js';
import {safeContentValidationError} from '../.test-build/packages/ai/src/contracts/content-validation-error.js';
import {createBlockWorkflow} from '../.test-build/packages/ai/src/services/block-workflow.js';
import {blockTask,blockOptions} from './fixtures/block.mjs';
import {validOutputs} from './fixtures/website.mjs';
const plan=(n,type='advantages')=>{const p=validOutputs().content;p.sections[0].type=type;if(n!==undefined)p.sections[0].points=Array.from({length:n},(_,i)=>`Option ${i+1}`);return p;};
const wire=p=>({...p,notes:null,sections:p.sections.map(s=>({heading:null,text:null,points:null,callToAction:null,...s}))});
const schema=buildContentWireSchema(['Request a quote']);
const validateWire=new Ajv({strict:true}).compile(schema);
for(const n of [undefined,1,2,3,8,9])test(`advantages points ${n??'missing'}: wire and local validator agree`,()=>{
 const p=plan(n),expected=n!==undefined&&n>=3&&n<=8,r=validateContentPlan(p);
 assert.equal(r.valid,expected);assert.equal(validateWire(wire(p)),expected);
 if(n===undefined||n<3){assert.deepEqual(r.validationError,{stage:'content-semantic',path:'sections[0].points',rule:'ADVANTAGES_POINTS_MIN'});assert.deepEqual(safeContentValidationError(r.validationError),r.validationError);}
 if(n===9)assert.equal(r.validationError.rule,'SCHEMA_MAX_ITEMS');
});
test('advantages requires non-null points in its sole wire branch, retains item limits and optional heading/text',()=>{
 const variants=schema.properties.sections.items.anyOf,branches=variants.filter(v=>v.properties.type.enum.includes('advantages'));
 assert.equal(branches.length,1);const b=branches[0];assert.deepEqual(b.properties.type.enum,['advantages']);assert.ok(b.required.includes('points'));
 assert.equal(b.properties.points.type,'array');assert.equal(b.properties.points.minItems,3);assert.equal(b.properties.points.maxItems,8);const {description,...itemConstraints}=b.properties.points.items;assert.deepEqual(itemConstraints,contentSectionSchema.properties.points.items);
 assert.equal(contentSectionSchema.properties.points.minItems,1);
 const p=wire(plan(3));p.sections[0].heading=null;p.sections[0].text=null;assert.equal(validateWire(p),true);assert.equal(validateContentPlan(normalizeContentWire(p)).valid,true);
 p.sections[0].points=null;assert.equal(validateWire(p),false);assert.equal(validateContentPlan(normalizeContentWire(p)).validationError.rule,'ADVANTAGES_POINTS_MIN');
 delete p.sections[0].points;assert.equal(validateWire(p),false);
});
for(const type of ['text','services','process','hero','cta','faq'])test(`${type} keeps one point and optional points; no artificial advantages minimum`,()=>{
 for(const n of [undefined,1,2]){const p=plan(n,type);assert.equal(validateContentPlan(p).valid,true);assert.equal(validateWire(wire(p)),true);}
});
test('FAQ keeps six-point maximum and single FAQ limit',()=>{
 assert.equal(validateContentPlan(plan(6,'faq')).valid,true);assert.equal(validateWire(wire(plan(6,'faq'))),true);
 assert.equal(validateContentPlan(plan(7,'faq')).validationError.rule,'FAQ_POINTS_LIMIT');assert.equal(validateWire(wire(plan(7,'faq'))),false);
 const p=plan(1,'faq');p.sections.push(structuredClone(p.sections[0]));assert.equal(validateContentPlan(p).validationError.rule,'FAQ_LIMIT');
});
test('advantages item security and existing text limits are unchanged; diagnostics never echo text',()=>{
 for(const text of ['', 'x'.repeat(401),'<script>PRIVATE_REJECTED</script>']){const p=plan(3);p.sections[0].points[0]=text;const r=validateContentPlan(p);assert.equal(r.valid,false);assert.ok(!JSON.stringify(r).includes('PRIVATE_REJECTED'));}
 const p=plan(undefined);delete p.sections[0].heading;delete p.sections[0].callToAction;assert.equal(validateContentPlan(p).validationError.rule,'ADVANTAGES_POINTS_MIN');
});
for(const n of [undefined,1,2])test(`block rejects advantages ${n??'missing'} points before Developer/QA without retry`,async()=>{
 const p=plan(n);if(n===1)p.sections[0].points=['Explore options, compare details, choose a direction'];
 const before=structuredClone(p),options=blockOptions({plan:p}),stages=[];
 const r=await(await createBlockWorkflow(options)).run({...blockTask(),onStage:async(s,phase)=>stages.push([s,phase])});
 assert.equal(r.errorCode,'INVALID_RESPONSE');assert.equal(r.success,false);assert.equal(options.calls.length,1);
 assert.deepEqual(stages,[['design','started'],['design','completed'],['content','started'],['content','failed']]);assert.deepEqual(p,before);assert.equal(r.block,undefined);
});
