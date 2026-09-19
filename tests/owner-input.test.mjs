import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseNameRequest,parseBriefRequest,parseBrief } from '../.test-build/packages/persistence/src/owner-validation.js';
const brief=()=>({companyName:'Студия',description:'Разработка мебели',productsOrServices:'Столы',targetAudience:'Компании',geography:null,websiteGoals:'Заявки',advantages:null,desiredActions:'Оставить заявку',contacts:null,notes:null});
const writeBrief=()=>({...brief(),advantages:[]});
test('brief uses owner input names without claiming AI analysis; optional empties normalize',()=>{assert.deepEqual(parseBrief({...brief(),notes:'  '}),brief());assert.equal(parseNameRequest({operationId:randomUUID(),name:' Клиент '}).name,'Клиент');});
for(const name of ['', '  ', '<script>alert(1)</script>', 'x'.repeat(201)])test('invalid organization/project name rejected '+name.length,()=>assert.throws(()=>parseNameRequest({operationId:randomUUID(),name}),e=>e.code==='INVALID_INPUT'));
for(const patch of [{extra:'x'},{companyName:''},{description:' '.repeat(3)},{notes:'x'.repeat(2001)},{contacts:'javascript:alert(1)'},{notes:'<img src=x>'},{notes:'-----BEGIN PRIVATE KEY-----'},{targetAudience:[]},{companyName:null}])test('invalid brief rejected '+Object.keys(patch).join(),()=>assert.throws(()=>parseBrief({...brief(),...patch}),e=>e.code==='INVALID_INPUT'));
for(const patch of [{operationId:'bad'},{organizationId:'bad'},{expectedVersion:-1},{expectedVersion:1.5},{actorId:randomUUID()}])test('strict write envelope rejects '+Object.keys(patch).join(),()=>assert.throws(()=>parseBriefRequest({operationId:randomUUID(),organizationId:randomUUID(),expectedVersion:0,brief:writeBrief(),...patch}),e=>e.code==='INVALID_INPUT'));
test('required missing brief field rejected',()=>{const b=brief();delete b.companyName;assert.throws(()=>parseBrief(b));});
test('international public contacts and Unicode preserved as text',()=>{const contacts='+49 30 123456 · hello@example.test · https://example.test';assert.equal(parseBrief({...brief(),contacts}).contacts,contacts);});
for(const contacts of ['https://user:password@example.test','пароль: example-value','IBAN: DE001234567890','номер карты: 4111111111111111'])test('credential/payment-looking contact rejected',()=>assert.throws(()=>parseBrief({...brief(),contacts}),e=>e.code==='INVALID_INPUT'));
test('legacy advantages parse without reinterpretation while new writes require structured items',()=>{
 const legacy='лучшие на рынке цены, собственное производство, от замера до монтажа "под ключ", качественная фурнитура, прозрачные цены';
 assert.equal(parseBrief({...brief(),advantages:legacy}).advantages,legacy);
 assert.throws(()=>parseBriefRequest({operationId:randomUUID(),organizationId:randomUUID(),expectedVersion:0,brief:{...brief(),advantages:legacy}}),e=>e.code==='INVALID_INPUT');
 assert.deepEqual(parseBriefRequest({operationId:randomUUID(),organizationId:randomUUID(),expectedVersion:0,brief:{...writeBrief(),advantages:[{text:' Первое '},{text:'Второе'}]}}).brief.advantages,[{text:'Первое'},{text:'Второе'}]);
});
for(const advantages of [
 [{text:''}],Array.from({length:9},(_,i)=>({text:`Пункт ${i}`})),[{text:'x'.repeat(301)}],[{text:'Повтор'},{text:'повтор'}],[{text:'<script>x</script>'}],[{text:'password: TEST_ONLY_PRIVATE'}],[{text:'https://user:pass@example.test'}],[{text:'ok',extra:true}],['text'],null,
])test('new structured advantages reject unsafe or malformed input',()=>assert.throws(()=>parseBriefRequest({operationId:randomUUID(),organizationId:randomUUID(),expectedVersion:0,brief:{...writeBrief(),advantages}}),e=>e.code==='INVALID_INPUT'));
test('structured advantages enforce the legacy total bound and never invoke accessors',()=>{
 assert.throws(()=>parseBriefRequest({operationId:randomUUID(),organizationId:randomUUID(),expectedVersion:0,brief:{...writeBrief(),advantages:Array.from({length:6},(_,i)=>({text:String(i).repeat(300)}))}}),e=>e.code==='INVALID_INPUT');
 let reads=0;const item={};Object.defineProperty(item,'text',{enumerable:true,get(){reads++;return 'secret';}});
 assert.throws(()=>parseBrief({...brief(),advantages:[item]}),e=>e.code==='INVALID_INPUT');assert.equal(reads,0);
 const symbolItem={text:'Пункт'};symbolItem[Symbol('private')]='x';assert.throws(()=>parseBrief({...brief(),advantages:[symbolItem]}),e=>e.code==='INVALID_INPUT');
});
