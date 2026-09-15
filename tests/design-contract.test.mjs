import test from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { designDirectionSchema } from '../.test-build/packages/ai/src/contracts/design-direction-schema.js';
import { validateDesignDirection } from '../.test-build/packages/ai/src/validation/design-direction-validator.js';
import { validateWebsiteAgentOutput } from '../.test-build/packages/ai/src/orchestrator/website-result-validator.js';
import { WebsiteWorkflowOrchestrator } from '../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js';
import { validOutputs } from './fixtures/website.mjs';
const valid=()=>validOutputs().design;
const schema=new Ajv({strict:true}).compile(designDirectionSchema);
function rejected(value){const result=validateDesignDirection(value);assert.equal(result.valid,false);assert.ok(result.issues.length);assert.equal(validateWebsiteAgentOutput('design',value,'project-1').valid,false);return result;}
test('valid design accepts bounded Russian and English descriptions with optional fields',()=>{
 const output={...valid(),styleName:'Спокойная архитектура',description:'Светлая палитра, чёткая иерархия и свободное пространство.',colors:{primary:'#abc',secondary:'#123456',background:'#FFFFFF',text:'#111',accent:'#FfAa00'},
 typography:{headingStyle:'Крупный геометрический гротеск',bodyStyle:'Нейтральный гротеск с комфортным интервалом'},visualReferences:['Матовые поверхности и мягкий боковой свет'],notes:'Сохранить единый ритм.'};
 const copy=structuredClone(output);assert.equal(schema(output),true);assert.deepEqual(validateDesignDirection(output),{valid:true,issues:[]});assert.deepEqual(output,copy);
 assert.equal(validateDesignDirection({...valid(),visualReferences:[]}).valid,true);
});
for(const field of ['styleName','description','mood','colors','typography','layoutPrinciples'])test(`design rejects missing ${field}`,()=>{const output=valid();delete output[field];rejected(output);assert.equal(schema(output),false);});
for(const value of [undefined,null,{},[],'',0])test('empty/non-object design rejected',()=>rejected(value));
for(const color of ['red','rgb(1,2,3)','#12','#1234','#12345g','#12345678',' #abc','#abc ','url(example.com)','var(--color)'])test(`design rejects color format ${color}`,()=>{const output=valid();output.colors.primary=color;rejected(output);assert.equal(schema(output),false);});
test('nested required fields and unknown properties rejected at every level',()=>{
 for(const mutate of [d=>delete d.colors.background,d=>delete d.typography.headingStyle,d=>{d.extra='x';},d=>{d.colors.extra='#fff';},d=>{d.typography.css='color red';}]){const d=valid();mutate(d);rejected(d);assert.equal(schema(d),false);}
});
for(const [field,max] of [['styleName',100],['description',2000],['notes',1000]])test(`design ${field} rejects oversized value and permits exact limit`,()=>{
 const d=valid();d[field]='А'.repeat(max);assert.equal(validateDesignDirection(d).valid,true);d[field]+='А';rejected(d);
});
test('array and typography limits enforced',()=>{
 for(const mutate of [d=>{d.mood=Array(9).fill('Calm');},d=>{d.mood=['a'.repeat(81)];},d=>{d.layoutPrinciples=Array(13).fill('Readable');},d=>{d.layoutPrinciples=['a'.repeat(301)];},d=>{d.visualReferences=Array(9).fill('Natural');},d=>{d.visualReferences=['a'.repeat(301)];},d=>{d.typography.bodyStyle='a'.repeat(301);}]){const d=valid();mutate(d);rejected(d);}
});
for(const text of ['<script>alert(1)</script>','<b>Design</b>','&lt;script&gt;alert(1)','%3Cscript%3E','```js alert(1)```','body { color: red; }','const value = 1','alert(1)','import os','print(1)','echo hello','rm -rf','color: red','font-size: 16px','localhost','::1','custom:resource','DROP TABLE users','https://example.com','example.com','//example.com','user@example.com','file:///etc/passwd','data:text/html,test','Bearer TEST_ONLY_PRIVATE_VALUE','Api-Key TEST_ONLY_PRIVATE_VALUE','password: TEST_ONLY_PRIVATE_VALUE','sk-'+ 'a'.repeat(25),'AQVN'+'a1'.repeat(20)])test('design rejects markup/code/address/credential-like prose',()=>{
 const d=valid();d.notes=text;const result=rejected(d);assert.ok(!JSON.stringify(result).includes(text));
});
test('unsafe text rejected in every prose field, not only notes',()=>{
 for(const mutate of [d=>{d.styleName='alert(1)';},d=>{d.description='https://example.com';},d=>{d.mood=['Bearer TEST_ONLY_PRIVATE_VALUE'];},d=>{d.typography.headingStyle='<script>';},d=>{d.typography.bodyStyle='color: red;';},d=>{d.layoutPrinciples=['print(1)'];},d=>{d.visualReferences=['example.com'];}]){const d=valid();mutate(d);rejected(d);}
});
for(const values of [[],[''],['   '],['\n'],[null],[1],[{}],'Calm'])test('design rejects malformed mood arrays',()=>{const d=valid();d.mood=values;rejected(d);});
test('optional present fields cannot be null, blank or malformed',()=>{
 for(const mutate of [d=>{d.notes=null;},d=>{d.notes='  ';},d=>{d.visualReferences=[''];},d=>{d.visualReferences=null;},d=>{d.colors.accent='';}]){const d=valid();mutate(d);rejected(d);}
});
test('design boundary refuses cycles/accessors and does not expose extra-field values in errors',()=>{
 const cycle=valid();cycle.loop=cycle;rejected(cycle);
 const accessor=valid();Object.defineProperty(accessor,'notes',{enumerable:true,get(){assert.fail('getter executed');}});rejected(accessor);
 const hidden=valid();Object.defineProperty(hidden,'hidden',{value:'private'});rejected(hidden);
 const symbol=valid();symbol[Symbol('hidden')]='private';rejected(symbol);
 const d=valid();d['TEST_ONLY_PRIVATE_FIELD']='TEST_ONLY_PRIVATE_VALUE';const result=rejected(d);assert.ok(!JSON.stringify(result).includes('TEST_ONLY_PRIVATE'));
});
test('workflow rejects unsafe design before content and preserves Business state',async()=>{
 const outputs=validOutputs();let contentCalled=false;
 const agents=Object.fromEntries(Object.entries(outputs).map(([type,output])=>[type,{type,async run(){if(type==='content')contentCalled=true;return{success:true,output};}}]));
 outputs.design.visualReferences=['https://example.com'];
 const result=await new WebsiteWorkflowOrchestrator(agents).run({projectId:'project-1',goal:'Create page',input:{}});
 assert.equal(result.success,false);assert.deepEqual(result.state.business,outputs.business);assert.equal(result.state.design,undefined);assert.equal(contentCalled,false);assert.ok(!result.error.includes('https://example.com'));
});
