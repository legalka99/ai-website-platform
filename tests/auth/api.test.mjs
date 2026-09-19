import {WorkflowLaunchService} from '../../.test-build/apps/api/src/workflow-launch.js';
import {WORKFLOW_LIMITS} from '../../.test-build/packages/core/src/workflow-launch.js';
import {fakeLaunchFactory,launchBrief} from '../fixtures/launch.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createApi } from '../../.test-build/apps/api/src/server.js';
import { AuthRepository,sessionHash } from '../../.test-build/packages/persistence/src/auth.js';
import { hashPassword } from '../../.test-build/packages/security/src/password.js';
import { PostgresPersistence } from '../../.test-build/packages/persistence/src/postgres.js';
import { qaInput } from '../fixtures/qa.mjs';
import { loadMigrations } from '../../scripts/persistence-db.mjs';
import { migrate } from '../../.test-build/packages/persistence/src/migrations.js';
import { AIProviderError } from '../../.test-build/packages/ai/src/providers/errors.js';
if(process.env.KLEO_ISOLATED_DB_TEST!=='1'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='kleo_test')throw Error('Use isolated auth runner');
const pool=new Pool({max:3}),repo=new PostgresPersistence(pool),password='TEST_ONLY_Long_Passphrase_42';
const config={production:false,apiOrigin:'http://localhost:3001',origins:['http://localhost:3000'],sessionSeconds:3600,loginLimit:20};
let runtime,auth,operator,A,B,owner,hash;
const forbiddenNetwork=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Live calls forbidden');};
test.before(async()=>{
 await pool.query(await readFile(new URL('../../packages/persistence/sql/api-grants.sql',import.meta.url),'utf8'));
 runtime=new Pool({max:4,options:'-c role=kleo_api'});auth=await AuthRepository.create(runtime,3600);operator=await AuthRepository.create(pool);hash=await hashPassword(password);
 A=await tenant();B=await tenant();await operator.bootstrapOwner('owner@example.test',password);owner={email:'owner@example.test'};
});
test.after(async()=>{globalThis.fetch=forbiddenNetwork;await runtime?.end();await pool.end();});
async function tenant(){const {userId,organizationId}=await repo.provisionOrganization('Private tenant'),projectId=await repo.createProject(userId,organizationId,'Private project'),email=`${randomUUID()}@example.test`;
 await pool.query('INSERT INTO kleo.auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',[userId,email,hash]);
 const scope={actorId:userId,organizationId,projectId},input=qaInput();input.website.projectId=projectId;const run=await repo.startRun(scope);
 const stored=await repo.finishRun(scope,run.id,{success:true,state:{...input.reviewContext,developer:{website:input.website,generatedAt:input.generatedAt},qa:{passed:true,score:90,issues:[],checkedAt:new Date().toISOString()}},executions:{qa:{projectId,usage:{provider:'openai',model:'test',workflowId:run.id,totalTokens:30,durationMs:1}}}});
 return {...scope,userId,email,stored};
}
async function app(t,overrides={},store=auth,options={}){const logs=[],api=await createApi(store,{...config,...overrides},{...options,log:e=>logs.push(e)});t.after(()=>api.close());return {api,logs};}
function request(api,path,opts={}){return api.inject({method:opts.method??'GET',url:path,headers:{host:'localhost:3001',...(opts.method==='POST'?{origin:config.origins[0],'content-type':'application/json'}:{}),...(opts.cookie?{cookie:opts.cookie}:{}),...(opts.csrf?{'x-csrf-token':opts.csrf}:{}),...opts.headers},...(opts.body!==undefined?{payload:opts.body}:{})});}
async function login(api,user=A,headers={}){const r=await request(api,'/api/v1/auth/login',{method:'POST',body:{email:user.email,password},headers});assert.equal(r.statusCode,200);return {cookie:r.headers['set-cookie'].split(';')[0],csrf:r.json().csrfToken,response:r};}
for(const label of ['wrong','unknown','disabled'])test(`login ${label} has generic indistinguishable external error`,async t=>{const {api}=await app(t);let email=A.email,pass=password+'x';if(label==='unknown'){email='missing@example.test';pass=password;}if(label==='disabled'){const c=await tenant();email=c.email;pass=password;await pool.query("UPDATE kleo.users SET status='disabled' WHERE id=$1",[c.userId]);}
 const r=await request(api,'/api/v1/auth/login',{method:'POST',body:{email,password:pass}});assert.equal(r.statusCode,401);assert.deepEqual(r.json().error,{code:'INVALID_CREDENTIALS',message:'Invalid credentials.'});assert.equal(r.headers['set-cookie'],undefined);
});
test('correct login uses HttpOnly bounded cookie, raw tokens and passwords absent from DB/public DTO/logs',async t=>{
 const {api,logs}=await app(t),session=await login(api);assert.match(session.response.headers['set-cookie'],/HttpOnly/);assert.match(session.response.headers['set-cookie'],/SameSite=Strict/);assert.match(session.response.headers['set-cookie'],/Path=\//);assert.match(session.response.headers['set-cookie'],/Max-Age=3600/);
 const token=session.cookie.split('=')[1],stored=(await pool.query('SELECT token_hash FROM kleo.auth_sessions WHERE token_hash=$1',[sessionHash(token)])).rows[0];assert.ok(stored);assert.notEqual(stored.token_hash,token);
 const me=await request(api,'/api/v1/auth/me',session);assert.equal(me.json().user.id,A.userId);assert.equal(me.json().user.platformRole,'user');assert.equal(me.json().csrfToken,session.csrf);
 assert.ok(!me.body.includes(token));for(const marker of [password,token,stored.token_hash,A.email,'Cookie','password_hash'])assert.ok(!JSON.stringify(logs).includes(marker));assert.ok(!session.response.body.includes(password));
});
test('email normalization and DB uniqueness are enforced',async t=>{const {api}=await app(t);const r=await request(api,'/api/v1/auth/login',{method:'POST',body:{email:`  ${A.email.toUpperCase()}  `,password}});assert.equal(r.statusCode,200);await assert.rejects(pool.query('INSERT INTO kleo.auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',[B.userId,A.email,hash]),e=>e.code==='23505');});
for(const body of [{email:'invalid',password},{email:A?.email,password:'short'},{email:'x@example.test',password,role:'platform_owner'},{email:'x@example.test',password,userId:randomUUID()},{email:'x@example.test',password:'x'.repeat(129)},{}])test('strict bounded login rejects malformed or privileged input',async t=>{const {api}=await app(t);assert.equal((await request(api,'/api/v1/auth/login',{method:'POST',body})).statusCode,400);});
test('oversized and non-JSON bodies fail before authentication',async t=>{const {api}=await app(t);assert.equal((await request(api,'/api/v1/auth/login',{method:'POST',body:{email:'x@example.test',password:'x'.repeat(3000)}})).statusCode,413);assert.equal((await request(api,'/api/v1/auth/login',{method:'POST',body:'text',headers:{'content-type':'text/plain'}})).statusCode,415);});
test('logout invalidates server session and cannot replay old token',async t=>{const {api}=await app(t),s=await login(api);const r=await request(api,'/api/v1/auth/logout',{method:'POST',body:{},...s});assert.equal(r.statusCode,200);assert.match(r.headers['set-cookie'],/Max-Age=0/);assert.equal((await request(api,'/api/v1/auth/me',s)).statusCode,401);});
for(const mode of ['expired','revoked','disabled'])test(`${mode} session cannot authorize next request`,async t=>{const {api}=await app(t),c=await tenant(),s=await login(api,c),token=s.cookie.split('=')[1];
 if(mode==='disabled')await pool.query("UPDATE kleo.users SET status='disabled' WHERE id=$1",[c.userId]);else if(mode==='revoked')await pool.query('UPDATE kleo.auth_sessions SET revoked_at=now() WHERE token_hash=$1',[sessionHash(token)]);else await pool.query("UPDATE kleo.auth_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE token_hash=$1",[sessionHash(token)]);
 assert.equal((await request(api,'/api/v1/auth/me',s)).statusCode,401);
});
test('login always issues a fresh token, ignores preauth cookie and never adopts forged identity header',async t=>{const {api}=await app(t),a=await login(api),b=await login(api,A,{cookie:a.cookie,'x-user-id':B.userId,'x-role':'platform_owner'});assert.notEqual(a.cookie,b.cookie);assert.equal((await request(api,'/api/v1/auth/me',b)).json().user.id,A.userId);});
for(const direction of ['AtoB','BtoA'])test(`${direction}: guessed valid resource IDs cannot cross tenants`,async t=>{const {api}=await app(t),a=direction==='AtoB'?A:B,b=direction==='AtoB'?B:A,s=await login(api,a);
 const routes=[`/api/v1/projects/${b.projectId}`,`/api/v1/projects/${b.projectId}/workflows`,`/api/v1/projects/${b.projectId}/websites`,`/api/v1/projects/${b.projectId}/websites/${b.stored.websiteId}/versions`,`/api/v1/projects/${b.projectId}/versions/${b.stored.versionId}/qa`,`/api/v1/projects/${b.projectId}/usage`];
 for(const path of routes){const r=await request(api,path,{...s,headers:{'x-user-id':b.userId,'x-organization-id':b.organizationId,'x-role':'platform_owner'}});assert.equal(r.statusCode,404);assert.ok(!r.body.includes(b.organizationId));}
 const filtered=await request(api,`/api/v1/projects?organizationId=${b.organizationId}`,s);assert.deepEqual(filtered.json().data,[]);assert.equal((await request(api,`/api/v1/projects/${a.projectId}/websites/${b.stored.websiteId}/versions`,s)).statusCode,404);assert.equal((await request(api,`/api/v1/projects/${a.projectId}/versions/${b.stored.versionId}/qa`,s)).statusCode,404);
});
test('own scoped read endpoints return bounded explicit DTOs',async t=>{const {api}=await app(t),s=await login(api);for(const path of ['/api/v1/organizations','/api/v1/projects',`/api/v1/projects/${A.projectId}/workflows`,`/api/v1/projects/${A.projectId}/websites`,`/api/v1/projects/${A.projectId}/websites/${A.stored.websiteId}/versions`,`/api/v1/projects/${A.projectId}/versions/${A.stored.versionId}/qa`,`/api/v1/projects/${A.projectId}/usage`]){const r=await request(api,path+'?limit=1&offset=0',s);assert.equal(r.statusCode,200);assert.ok(r.json().data.length<=1);for(const marker of ['password_hash','token_hash','document','secretRef','raw'])assert.ok(!r.body.includes(marker));}});
for(const role of ['owner','admin','member','viewer'])test(`organization ${role} project-create permissions use DB role`,async t=>{const {api}=await app(t),c=await tenant();await pool.query('UPDATE kleo.memberships SET role=$1 WHERE organization_id=$2 AND user_id=$3',[role,c.organizationId,c.userId]);const s=await login(api,c);const r=await request(api,'/api/v1/projects',{method:'POST',...s,body:{organizationId:c.organizationId,name:'New project'}});assert.equal(r.statusCode,['owner','admin'].includes(role)?200:403);});
test('membership revoke and archive take effect next request, not cached in session',async t=>{const {api}=await app(t),c=await tenant(),s=await login(api,c);await pool.query("UPDATE kleo.memberships SET status='revoked' WHERE organization_id=$1 AND user_id=$2",[c.organizationId,c.userId]);assert.equal((await request(api,`/api/v1/projects/${c.projectId}`,s)).statusCode,404);
 const d=await tenant(),sd=await login(api,d);await pool.query("UPDATE kleo.organizations SET status='archived' WHERE id=$1",[d.organizationId]);assert.equal((await request(api,`/api/v1/projects/${d.projectId}`,sd)).statusCode,404);
});
test('platform owner/admin cross-tenant reads explicit and audited, no bypass on tenant routes',async t=>{const {api}=await app(t),s=await login(api,owner);for(const kind of ['users','organizations','projects','workflows']){const r=await request(api,`/api/v1/admin/${kind}?limit=2`,s);assert.equal(r.statusCode,200);assert.ok(r.json().data.length<=2);const audit=(await pool.query("SELECT resource_type FROM kleo.security_audit_events WHERE request_id=$1 AND event_type='platform_read'",[r.headers['x-request-id']])).rows;assert.equal(audit[0].resource_type,kind);}
 assert.equal((await request(api,`/api/v1/projects/${A.projectId}`,s)).statusCode,404);
 const c=await tenant();await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[c.userId]);const cs=await login(api,c);assert.equal((await request(api,'/api/v1/admin/users',cs)).statusCode,200);await pool.query('DELETE FROM kleo.platform_roles WHERE user_id=$1',[c.userId]);assert.equal((await request(api,'/api/v1/admin/users',cs)).statusCode,403);
});
test('tenant owner cannot become platform admin via body/header/query/userId',async t=>{const {api}=await app(t),s=await login(api);assert.equal((await request(api,'/api/v1/admin/users',{...s,headers:{'x-role':'platform_owner','x-user-id':B.userId}})).statusCode,403);assert.equal((await request(api,'/api/v1/admin/users?role=platform_owner',s)).statusCode,400);const r=await request(api,'/api/v1/projects',{method:'POST',...s,body:{name:'Attack',organizationId:A.organizationId,role:'owner',userId:B.userId}});assert.equal(r.statusCode,400);});
for(const mode of ['missing-origin','wrong-origin','missing-csrf','wrong-csrf','unicode-csrf'])test(`mutating cookie request ${mode} denied`,async t=>{const {api}=await app(t),s=await login(api);const opts={method:'POST',cookie:s.cookie,csrf:s.csrf,body:{organizationId:A.organizationId,name:'Not created'},headers:{}};
 if(mode==='missing-origin')opts.headers.origin='';if(mode==='wrong-origin')opts.headers.origin='https://attacker.example';if(mode==='missing-csrf')delete opts.csrf;if(mode==='wrong-csrf')opts.csrf='a'.repeat(43);if(mode==='unicode-csrf')opts.csrf='я'.repeat(43);
 assert.equal((await request(api,'/api/v1/projects',opts)).statusCode,403);
});
test('CSRF token of another session is not accepted',async t=>{const {api}=await app(t),a=await login(api),b=await login(api,B);assert.equal((await request(api,'/api/v1/auth/logout',{method:'POST',cookie:a.cookie,csrf:b.csrf,body:{}})).statusCode,403);});
test('CORS has explicit credential allowlist, denied origin gets no grant',async t=>{const {api}=await app(t);const bad=await request(api,'/health',{headers:{origin:'https://attacker.example'}});assert.equal(bad.statusCode,403);assert.equal(bad.headers['access-control-allow-origin'],undefined);const good=await request(api,'/health',{headers:{origin:config.origins[0]}});assert.equal(good.headers['access-control-allow-origin'],config.origins[0]);assert.equal(good.headers['access-control-allow-credentials'],'true');const pre=await request(api,'/api/v1/projects',{method:'OPTIONS',headers:{origin:config.origins[0],'access-control-request-method':'POST','access-control-request-headers':'content-type,x-csrf-token'}});assert.equal(pre.statusCode,204);});
test('headers, server request ID, generic errors and disabled public registration',async t=>{const {api}=await app(t);const r=await request(api,'/health',{headers:{'x-request-id':'PRIVATE_CLIENT_ID'}});assert.equal(r.headers['x-content-type-options'],'nosniff');assert.equal(r.headers['x-frame-options'],'DENY');assert.match(r.headers['content-security-policy'],/default-src 'none'/);assert.equal(r.headers['strict-transport-security'],undefined);assert.notEqual(r.headers['x-request-id'],'PRIVATE_CLIENT_ID');assert.equal((await request(api,'/api/v1/auth/register',{method:'POST',body:{}})).statusCode,404);assert.equal((await request(api,'/api/v1/auth/logout')).statusCode,404);});
test('login rate limit cannot be bypassed with X-Forwarded-For or account existence',async t=>{const {api}=await app(t,{loginLimit:2});for(let i=0;i<2;i++)assert.equal((await request(api,'/api/v1/auth/login',{method:'POST',body:{email:'missing@example.test',password},headers:{'x-forwarded-for':`1.2.3.${i}`}})).statusCode,401);assert.equal((await request(api,'/api/v1/auth/login',{method:'POST',body:{email:A.email,password},headers:{'x-forwarded-for':'8.8.8.8'}})).statusCode,429);});
for(const query of ['limit=51','limit=0','offset=10001','offset=-1','sort=id;DROP','limit=1&limit=2','organizationId=bad'])test(`query validation rejects ${query}`,async t=>{const {api}=await app(t),s=await login(api);assert.equal((await request(api,'/api/v1/projects?'+query,s)).statusCode,400);});
test('pool max=1 connection reuse cannot leak actor, membership or platform role',async t=>{const {api}=await app(t),a=await login(api),b=await login(api,B),o=await login(api,owner);for(let i=0;i<3;i++){assert.equal((await request(api,`/api/v1/projects/${A.projectId}`,a)).statusCode,200);assert.equal((await request(api,`/api/v1/projects/${A.projectId}`,b)).statusCode,404);assert.equal((await request(api,'/api/v1/admin/users',o)).statusCode,200);assert.equal((await request(api,'/api/v1/admin/users',a)).statusCode,403);}});
test('bootstrap owner is explicit singleton, password only Argon2id hash; runtime cannot grant roles or mutate credentials',async()=>{
 await assert.rejects(operator.bootstrapOwner('second@example.test',password),e=>e.code==='CONFLICT');const row=(await pool.query('SELECT password_hash FROM kleo.auth_accounts WHERE email=$1',[owner.email])).rows[0];assert.match(row.password_hash,/^\$argon2id\$/);assert.ok(!row.password_hash.includes(password));
 for(const sql of ["UPDATE kleo.platform_roles SET role='platform_owner'","UPDATE kleo.auth_accounts SET password_hash='bad'",'DELETE FROM kleo.auth_sessions','CREATE TABLE kleo.forbidden(id int)',"UPDATE kleo.memberships SET role='owner'"])await assert.rejects(runtime.query(sql),e=>e.code==='42501');
});
test('DB failures produce safe errors without upstream messages or SQL',async t=>{const fake={...auth,withSession:async()=>{throw Error('password=PRIVATE SQL /Users/private postgres://secret');}};const {api,logs}=await app(t,{},fake);const r=await request(api,'/api/v1/auth/me',{cookie:'kleo_session='+'a'.repeat(43)});assert.equal(r.statusCode,500);for(const marker of ['PRIVATE','SQL','/Users','postgres://','password'])assert.ok(!r.body.includes(marker)&&!JSON.stringify(logs).includes(marker));});
test('auth migration replay and checksum protection remain active',async()=>{const migrations=await loadMigrations();await migrate(pool,migrations);assert.equal((await pool.query('SELECT count(*) FROM kleo.schema_migrations')).rows[0].count,String(migrations.length));const changed=migrations.map(m=>m.name.startsWith('002')?{...m,sql:m.sql+'\n-- drift'}:m);await assert.rejects(migrate(pool,changed),e=>e.code==='MIGRATION_MISMATCH');});
test('security audit records login/logout and denials without raw email/password/token',async t=>{
 const {api}=await app(t),s=await login(api),denied=await request(api,'/api/v1/admin/users',s),out=await request(api,'/api/v1/auth/logout',{method:'POST',...s,body:{}});
 const rows=(await pool.query('SELECT event_type,request_id,actor_id,resource_type FROM kleo.security_audit_events WHERE request_id=ANY($1::uuid[])',[[s.response.headers['x-request-id'],denied.headers['x-request-id'],out.headers['x-request-id']]])).rows;
 assert.deepEqual(rows.map(r=>r.event_type).sort(),['access_denied','login_success','logout']);for(const marker of [A.email,password,s.cookie.split('=')[1],s.csrf])assert.ok(!JSON.stringify(rows).includes(marker));
});
test('actual SQL authorization failure is sanitized to 503',async t=>{
 const {api}=await app(t),s=await login(api);await pool.query('REVOKE SELECT ON kleo.auth_sessions FROM kleo_api');
 try{const r=await request(api,'/api/v1/auth/me',s);assert.equal(r.statusCode,503);assert.equal(r.json().error.code,'UNAVAILABLE');for(const marker of ['auth_sessions','SELECT','permission denied','postgres','password'])assert.ok(!r.body.includes(marker));}
 finally{await pool.query('GRANT SELECT ON kleo.auth_sessions TO kleo_api');}
});
test('production sends Secure __Host cookie and HSTS only over real TLS',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{request:httpsRequest}=await import('node:https');
 const dir=await mkdtemp(join(tmpdir(),'kleo-auth-tls-'));let api;
 try{await promisify(execFile)('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost'],{timeout:20000});
  api=await createApi(auth,{...config,production:true,apiOrigin:'https://localhost',origins:['https://localhost:3000']},{https:{key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))}});
  await api.listen({host:'127.0.0.1',port:0});const port=api.server.address().port;
  const response=await new Promise((resolve,reject)=>{const req=httpsRequest({host:'127.0.0.1',port,path:'/api/v1/auth/login',method:'POST',rejectUnauthorized:false,headers:{host:'localhost',origin:'https://localhost:3000','content-type':'application/json'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end(JSON.stringify({email:A.email,password}));});
  assert.equal(response.status,200);assert.match(response.headers['set-cookie'][0],/^__Host-kleo_session=/);assert.match(response.headers['set-cookie'][0],/; Secure/);assert.match(response.headers['set-cookie'][0],/HttpOnly/);assert.ok(response.headers['strict-transport-security']);
 }finally{await api?.close();await rm(dir,{recursive:true,force:true});}
});
test('X-Forwarded-Proto cannot turn insecure production transport into authenticated HTTPS',async t=>{
 const api=await createApi(auth,{...config,production:true,apiOrigin:'https://localhost:3001',origins:['https://localhost:3000']});t.after(()=>api.close());const r=await request(api,'/health',{headers:{'x-forwarded-proto':'https'}});assert.equal(r.statusCode,403);
});
test('membership downgrade takes effect with the same authenticated session',async t=>{
 const {api}=await app(t),c=await tenant(),s=await login(api,c);const opts={method:'POST',...s,body:{organizationId:c.organizationId,name:'Allowed'}};assert.equal((await request(api,'/api/v1/projects',opts)).statusCode,200);
 await pool.query("UPDATE kleo.memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",[c.organizationId,c.userId]);assert.equal((await request(api,'/api/v1/projects',opts)).statusCode,403);
});
test('cross-tenant admin read fails closed when its audit cannot be persisted',async t=>{
 const {api}=await app(t),s=await login(api,owner);await pool.query('REVOKE INSERT ON kleo.security_audit_events FROM kleo_api');
 try{const r=await request(api,'/api/v1/admin/organizations',s);assert.equal(r.statusCode,503);assert.equal(r.json().data,undefined);assert.ok(!r.body.includes(A.organizationId));}
 finally{await pool.query('GRANT INSERT ON kleo.security_audit_events TO kleo_api');}
});
test('database rejects second platform owner independently of CLI policy',async()=>{await assert.rejects(pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_owner')",[A.userId]),e=>e.code==='23505');});

// Console extensions keep the real restricted PostgreSQL role and existing tests.
for(const kind of ['dashboard','websites','versions','qa','usage','audit-events']){
 test(`console ${kind}: tenant denied, owner/admin allowed, explicit audited projection`,async t=>{
  const {api}=await app(t),tenantSession=await login(api),ownerSession=await login(api,owner);
  assert.equal((await request(api,`/api/v1/admin/${kind}`,tenantSession)).statusCode,403);
  const c=await tenant();await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[c.userId]);const adminSession=await login(api,c);
  for(const s of [ownerSession,adminSession]){const r=await request(api,`/api/v1/admin/${kind}`,s);assert.equal(r.statusCode,200);assert.equal((await pool.query("SELECT count(*) FROM kleo.security_audit_events WHERE request_id=$1 AND event_type='platform_read'",[r.headers['x-request-id']])).rows[0].count,'1');
   for(const marker of ['password_hash','token_hash','document','headers','Bearer ','csrfToken',password])assert.ok(!r.body.includes(marker),marker);
  }
 });
}
for(const kind of ['organizations','users','projects','workflows'])test(`console ${kind} detail protected and bounded`,async t=>{
 const {api}=await app(t),s=await login(api,owner),a=await login(api);
 const target=kind==='organizations'?A.organizationId:kind==='users'?A.userId:kind==='projects'?A.projectId:undefined;
 // Obtain workflow UUID from its project rather than relying on fixture return shape.
 const id=kind==='workflows'?(await pool.query('SELECT id FROM kleo.workflow_runs WHERE project_id=$1 LIMIT 1',[A.projectId])).rows[0].id:target;
 const r=await request(api,`/api/v1/admin/${kind}/${id}`,s);assert.equal(r.statusCode,200);assert.equal(r.json().item.id,id);assert.equal((await request(api,`/api/v1/admin/${kind}/${id}`,a)).statusCode,403);
 assert.equal((await request(api,`/api/v1/admin/${kind}/${randomUUID()}`,s)).statusCode,404);assert.equal((await request(api,`/api/v1/admin/${kind}/bad`,s)).statusCode,400);
 if(kind==='workflows')assert.ok(r.json().executions.length<=5);
});
test('console filters preserve both tenant scopes and nested website identity',async t=>{
 const {api}=await app(t),s=await login(api,owner);
 for(const tenant of [A,B])for(const kind of ['workflows','websites','versions','qa','usage']){const r=await request(api,`/api/v1/admin/${kind}?projectId=${tenant.projectId}`,s);assert.equal(r.statusCode,200);assert.ok(r.json().data.length);assert.ok(r.json().data.every(row=>row.project_id===tenant.projectId&&row.organization_id===tenant.organizationId));}
 const mixed=await request(api,`/api/v1/admin/versions?projectId=${A.projectId}&websiteId=${B.stored.websiteId}`,s);assert.deepEqual(mixed.json().data,[]);
});
for(const query of ['limit=51','offset=10001','sort=id','userId=bad','role=platform_owner','projectId=bad'])test(`console rejects unsafe/bounded query ${query}`,async t=>{
 const {api}=await app(t),s=await login(api,owner);assert.equal((await request(api,'/api/v1/admin/usage?'+query,s)).statusCode,400);
});
test('console pagination has non-overlapping stable pages',async t=>{
 const {api}=await app(t),s=await login(api,owner),a=await request(api,'/api/v1/admin/projects?limit=1&offset=0',s),b=await request(api,'/api/v1/admin/projects?limit=1&offset=1',s);assert.equal(a.json().data.length,1);assert.notEqual(a.json().data[0].id,b.json().data[0].id);
});
test('console QA displays validated persisted issue projection, no canonical Website JSON',async t=>{
 const c=await tenant(),scope={actorId:c.userId,organizationId:c.organizationId,projectId:c.projectId},input=qaInput();input.website.projectId=c.projectId;const run=await repo.startRun(scope);
 await repo.finishRun(scope,run.id,{success:false,state:{...input.reviewContext,developer:{website:input.website,generatedAt:input.generatedAt},qa:{passed:false,score:40,issues:[{code:'BUSINESS_ALIGNMENT',severity:'error',message:'Content needs review.',recommendation:'Review audience alignment.'}],checkedAt:new Date().toISOString()}}});
 const {api}=await app(t),s=await login(api,owner),r=await request(api,`/api/v1/admin/qa?workflowId=${run.id}`,s);assert.equal(r.statusCode,200);assert.deepEqual(r.json().data[0].issues,[{code:'BUSINESS_ALIGNMENT',severity:'error',message:'Content needs review.',recommendation:'Review audience alignment.'}]);assert.equal(r.json().data[0].passed,false);assert.ok(!r.body.includes('document'));
 const usage=await request(api,`/api/v1/admin/usage?projectId=${A.projectId}`,s);assert.equal(usage.json().data[0].input_tokens,null);assert.equal(usage.json().data[0].total_tokens,'30');
});
test('all new console read families fail closed on audit write failure',async t=>{
 const {api}=await app(t),s=await login(api,owner);await pool.query('REVOKE INSERT ON kleo.security_audit_events FROM kleo_api');
 try{for(const path of ['dashboard','websites','versions','qa','usage','audit-events',`projects/${A.projectId}`]){const r=await request(api,`/api/v1/admin/${path}`,s);assert.equal(r.statusCode,503);assert.equal(r.json().data,undefined);assert.equal(r.json().item,undefined);}}
 finally{await pool.query('GRANT INSERT ON kleo.security_audit_events TO kleo_api');}
});
test('persisted names remain text and credential-looking labels are redacted at console boundary',async t=>{
 const c=await tenant(),{api}=await app(t),s=await login(api,owner);
 await pool.query('UPDATE kleo.organizations SET name=$1 WHERE id=$2',['<script>alert(1)</script>',c.organizationId]);
 const html=await request(api,`/api/v1/admin/organizations/${c.organizationId}`,s);assert.equal(html.json().item.name,'<script>alert(1)</script>');
 await pool.query('UPDATE kleo.projects SET name=$1 WHERE id=$2',['Bearer '+ 'x'.repeat(32),c.projectId]);
 const secret=await request(api,`/api/v1/admin/projects/${c.projectId}`,s);assert.equal(secret.json().item.name,'[redacted]');assert.ok(!secret.body.includes('x'.repeat(32)));
});

const ownerBrief=()=>({companyName:'Owner studio',description:'Furniture design',productsOrServices:'Tables',targetAudience:'Businesses',geography:null,websiteGoals:'Enquiries',advantages:[],desiredActions:'Contact us',contacts:'hello@example.test',notes:null});
const nameCommand=(name='New client')=>({operationId:randomUUID(),name});
async function ownerProject(api,s){const o=await request(api,'/api/v1/admin/organizations',{...s,method:'POST',body:nameCommand()});assert.equal(o.statusCode,200);const org=o.json();const p=await request(api,`/api/v1/admin/organizations/${org.id}/projects`,{...s,method:'POST',body:nameCommand('New project')});assert.equal(p.statusCode,200);return {org,project:p.json()};}
for(const mode of ['anonymous','user','platform_admin'])test(`owner write endpoints reject ${mode}`,async t=>{const {api}=await app(t);let s={};if(mode==='user')s=await login(api);if(mode==='platform_admin'){const c=await tenant();await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[c.userId]);s=await login(api,c);}
 for(const [path,body] of [['/api/v1/admin/organizations',nameCommand()],[`/api/v1/admin/organizations/${A.organizationId}/projects`,nameCommand()],[`/api/v1/admin/projects/${A.projectId}/brief`,{operationId:randomUUID(),organizationId:A.organizationId,expectedVersion:0,brief:ownerBrief()}]])assert.equal((await request(api,path,{...s,method:'POST',body})).statusCode,mode==='anonymous'?401:403);
});
test('owner creates persisted org/project and immutable versioned brief without workflow',async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s),path=`/api/v1/admin/projects/${project.id}/brief`;
 assert.equal((await request(api,path,s)).json().snapshot,null);
 const body={operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()},r=await request(api,path,{...s,method:'POST',body});assert.equal(r.statusCode,200);assert.equal(r.json().version,1);
 const saved=(await request(api,path,s)).json().snapshot;assert.deepEqual(saved.brief,body.brief);assert.equal(saved.organizationId,org.id);assert.equal(saved.projectId,project.id);
 assert.equal((await pool.query('SELECT count(*) FROM kleo.workflow_runs WHERE project_id=$1',[project.id])).rows[0].count,'0');
 assert.equal((await pool.query('SELECT count(*) FROM kleo.websites WHERE project_id=$1',[project.id])).rows[0].count,'0');
 const v2=await request(api,path,{...s,method:'POST',body:{...body,operationId:randomUUID(),expectedVersion:1,brief:{...body.brief,notes:'Second version'}}});assert.equal(v2.statusCode,200);
 assert.equal((await pool.query('SELECT count(*) FROM kleo.project_briefs WHERE project_id=$1',[project.id])).rows[0].count,'2');
 const audit=(await pool.query('SELECT * FROM kleo.security_audit_events WHERE request_id=$1',[r.headers['x-request-id']])).rows[0];assert.equal(audit.event_type,'brief_saved');assert.equal(audit.organization_id,org.id);assert.equal(audit.project_id,project.id);assert.ok(!JSON.stringify(audit).includes('hello@example.test'));
 for(const verb of ['UPDATE','DELETE'])await assert.rejects(pool.query(verb==='UPDATE'?'UPDATE kleo.project_briefs SET version=3 WHERE id=$1':'DELETE FROM kleo.project_briefs WHERE id=$1',[saved.id]),e=>e.code==='23514');
});
test('legacy Brief reads unchanged and explicit owner re-save creates a new structured immutable version',async t=>{
 const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s),path=`/api/v1/admin/projects/${project.id}/brief`;
 const actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id;
 const legacy='лучшие на рынке цены, собственное производство, от замера до монтажа "под ключ", качественная фурнитура, прозрачные цены',oldId=randomUUID();
 await pool.query('INSERT INTO kleo.project_briefs(id,organization_id,project_id,version,actor_id,document) VALUES($1,$2,$3,1,$4,$5)',[oldId,org.id,project.id,actorId,JSON.stringify({...ownerBrief(),advantages:legacy})]);
 const oldRead=(await request(api,path,s)).json().snapshot;assert.equal(oldRead.id,oldId);assert.equal(oldRead.brief.advantages,legacy);
 const items=['лучшие на рынке цены','собственное производство','от замера до монтажа "под ключ"','качественная фурнитура','прозрачные цены'].map(text=>({text}));
 const saved=await request(api,path,{...s,method:'POST',body:{operationId:randomUUID(),organizationId:org.id,expectedVersion:1,brief:{...ownerBrief(),advantages:items}}});assert.equal(saved.statusCode,200);assert.equal(saved.json().version,2);
 const latest=(await request(api,path,s)).json().snapshot;assert.deepEqual(latest.brief.advantages,items);
 const rows=(await pool.query('SELECT id,version,document FROM kleo.project_briefs WHERE project_id=$1 ORDER BY version',[project.id])).rows;assert.equal(rows.length,2);assert.equal(rows[0].id,oldId);assert.equal(rows[0].document.advantages,legacy);assert.deepEqual(rows[1].document.advantages,items);
});
for(const kind of ['organization','project','brief'])test(`concurrent duplicate ${kind} retries are durable and conflicting payload rejected`,async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s);let path='/api/v1/admin/organizations',body=nameCommand();if(kind==='project')path=`/api/v1/admin/organizations/${org.id}/projects`;if(kind==='brief'){path=`/api/v1/admin/projects/${project.id}/brief`;body={operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()};}
 const [a,b]=await Promise.all([request(api,path,{...s,method:'POST',body}),request(api,path,{...s,method:'POST',body})]);assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.deepEqual(a.json(),b.json());
 const conflict=kind==='brief'?{...body,brief:{...body.brief,notes:'Changed'}}:{...body,name:'Changed'};assert.equal((await request(api,path,{...s,method:'POST',body:conflict})).statusCode,409);
 if(kind==='brief')assert.equal((await request(api,path,{...s,method:'POST',body:{...body,operationId:randomUUID()}})).statusCode,409);
});
for(const mode of ['csrf','origin','missing-origin'])test(`owner writes require ${mode}`,async t=>{const {api}=await app(t),s=await login(api,owner);const headers=mode==='origin'?{origin:'https://evil.test'}:mode==='missing-origin'?{origin:''}:{};
 assert.equal((await request(api,'/api/v1/admin/organizations',{...s,csrf:mode==='csrf'?'invalid':s.csrf,method:'POST',headers,body:nameCommand()})).statusCode,403);
});
test('owner targets enforce existence, active state and exact organization/project binding',async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s),path=`/api/v1/admin/projects/${project.id}/brief`,body={operationId:randomUUID(),organizationId:B.organizationId,expectedVersion:0,brief:ownerBrief()};
 assert.equal((await request(api,path,{...s,method:'POST',body})).statusCode,404);
 assert.equal((await request(api,`/api/v1/admin/organizations/${randomUUID()}/projects`,{...s,method:'POST',body:nameCommand()})).statusCode,404);
 await pool.query("UPDATE kleo.organizations SET status='archived' WHERE id=$1",[org.id]);assert.equal((await request(api,path,{...s,method:'POST',body:{...body,organizationId:org.id}})).statusCode,404);
 assert.equal((await request(api,`/api/v1/admin/organizations/${org.id}/projects`,{...s,method:'POST',body:nameCommand()})).statusCode,404);
});
test('owner write audit failure rolls back business write and idempotency receipt',async t=>{const {api}=await app(t),s=await login(api,owner),body=nameCommand('Rollback client');
 await pool.query("CREATE FUNCTION kleo.fail_owner_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type IN ('organization_created','brief_saved') THEN RAISE EXCEPTION 'TEST_ONLY'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_owner_audit BEFORE INSERT ON kleo.security_audit_events FOR EACH ROW EXECUTE FUNCTION kleo.fail_owner_audit()");
 try {const r=await request(api,'/api/v1/admin/organizations',{...s,method:'POST',body});assert.equal(r.statusCode,503);assert.ok(!r.body.includes('TEST_ONLY'));assert.equal((await pool.query('SELECT count(*) FROM kleo.organizations WHERE name=$1',[body.name])).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM kleo.owner_commands WHERE operation_id=$1',[body.operationId])).rows[0].count,'0');}
 finally{await pool.query('DROP TRIGGER fail_owner_audit ON kleo.security_audit_events; DROP FUNCTION kleo.fail_owner_audit()');}
 assert.equal((await request(api,'/api/v1/admin/organizations',{...s,method:'POST',body})).statusCode,200);
});
for(const body of [{...nameCommand(),role:'platform_owner'},nameCommand(' '),nameCommand('<script>x</script>'),nameCommand('x'.repeat(201)),{...nameCommand(),operationId:'bad'}])test('owner create strict request validation',async t=>{const {api}=await app(t),s=await login(api,owner);assert.equal((await request(api,'/api/v1/admin/organizations',{...s,method:'POST',body})).statusCode,400);});
test('brief limits, secret rejection and safe read permissions',async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s),path=`/api/v1/admin/projects/${project.id}/brief`,body={operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()};
 for(const notes of ['<script>alert(1)</script>','-----BEGIN PRIVATE KEY-----','x'.repeat(2001)])assert.equal((await request(api,path,{...s,method:'POST',body:{...body,brief:{...body.brief,notes}}})).statusCode,400);
 assert.equal((await request(api,path,{...s,method:'POST',body:{...body,brief:{...body.brief,notes:'x'.repeat(40000)}}})).statusCode,413);
 assert.equal((await request(api,path,await login(api,A))).statusCode,403);
 const c=await tenant();await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[c.userId]);assert.equal((await request(api,path,await login(api,c))).statusCode,200);
});
test('Brief API accepts only bounded structured advantage items for new writes',async t=>{
 const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s),path=`/api/v1/admin/projects/${project.id}/brief`,base={operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()};
 for(const advantages of ['legacy string',[{text:'ok',extra:'x'}],[{text:'<script>x</script>'}],Array.from({length:9},(_,i)=>({text:`Пункт ${i}`})),[{text:'x'.repeat(301)}]]){
  const response=await request(api,path,{...s,method:'POST',body:{...base,operationId:randomUUID(),brief:{...base.brief,advantages}}});assert.equal(response.statusCode,400);
 }
});
test('brief FK prevents direct wrong tenant binding and runtime cannot mutate immutable inputs',async t=>{await assert.rejects(pool.query('INSERT INTO kleo.project_briefs(organization_id,project_id,version,actor_id,document) VALUES($1,$2,1,$3,$4)',[A.organizationId,B.projectId,A.userId,JSON.stringify(ownerBrief())]),e=>e.code==='23503');
 for(const sql of ['DELETE FROM kleo.project_briefs','UPDATE kleo.project_briefs SET version=2','DELETE FROM kleo.owner_commands'])await assert.rejects(runtime.query(sql),e=>e.code==='42501');
});

test('new migration checksum is protected',async()=>{const migrations=await loadMigrations();await assert.rejects(migrate(pool,migrations.map(m=>m.name.startsWith('003')?{...m,sql:m.sql+'\n-- drift'}:m)),e=>e.code==='MIGRATION_MISMATCH');});
for(const kind of ['project','brief'])test(`${kind} audit failure leaves no business rows or receipts`,async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s);
 const event=kind==='project'?'project_created':'brief_saved',path=kind==='project'?`/api/v1/admin/organizations/${org.id}/projects`:`/api/v1/admin/projects/${project.id}/brief`,body=kind==='project'?nameCommand('Rollback project'):{operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()};
 await pool.query(`CREATE FUNCTION kleo.fail_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = '${event}' THEN RAISE EXCEPTION 'TEST_ONLY'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_write_audit BEFORE INSERT ON kleo.security_audit_events FOR EACH ROW EXECUTE FUNCTION kleo.fail_write_audit()`);
 try{assert.equal((await request(api,path,{...s,method:'POST',body})).statusCode,503);assert.equal((await pool.query('SELECT count(*) FROM kleo.owner_commands WHERE operation_id=$1',[body.operationId])).rows[0].count,'0');if(kind==='brief')assert.equal((await pool.query('SELECT count(*) FROM kleo.project_briefs WHERE project_id=$1',[project.id])).rows[0].count,'0');else assert.equal((await pool.query("SELECT count(*) FROM kleo.projects WHERE organization_id=$1 AND name='Rollback project'",[org.id])).rows[0].count,'0');}
 finally{await pool.query('DROP TRIGGER fail_write_audit ON kleo.security_audit_events; DROP FUNCTION kleo.fail_write_audit()');}
});
test('nested project/brief writes require CSRF and Origin independently',async t=>{const {api}=await app(t),s=await login(api,owner);
 for(const [path,body] of [[`/api/v1/admin/organizations/${A.organizationId}/projects`,nameCommand()],[`/api/v1/admin/projects/${A.projectId}/brief`,{operationId:randomUUID(),organizationId:A.organizationId,expectedVersion:0,brief:ownerBrief()}]]){
 assert.equal((await request(api,path,{...s,csrf:'',method:'POST',body})).statusCode,403);assert.equal((await request(api,path,{...s,method:'POST',body,headers:{origin:'https://evil.test'}})).statusCode,403);
 }
});
test('names are not globally unique and archived project cannot accept new brief',async t=>{const {api}=await app(t),s=await login(api,owner),{org,project}=await ownerProject(api,s);
 const a=await request(api,'/api/v1/admin/organizations',{...s,method:'POST',body:nameCommand(org.name)});assert.equal(a.statusCode,200);assert.notEqual(a.json().id,org.id);
 await pool.query("UPDATE kleo.projects SET status='archived' WHERE id=$1",[project.id]);assert.equal((await request(api,`/api/v1/admin/projects/${project.id}/brief`,{...s,method:'POST',body:{operationId:randomUUID(),organizationId:org.id,expectedVersion:0,brief:ownerBrief()}})).statusCode,404);
});

async function launchSetup(t, fakeOptions={}, limits=WORKFLOW_LIMITS,report){
 const fake=fakeLaunchFactory(fakeOptions),workflows=new WorkflowLaunchService(runtime,fake.factory,limits,report);
 const {api,logs}=await app(t,{},auth,{workflows}),session=await login(api,owner);
 const post=(path,body,opts={})=>request(api,path,{method:'POST',...session,body,...opts});
 const org=await post('/api/v1/admin/organizations',{operationId:randomUUID(),name:'Launch fixture'});assert.equal(org.statusCode,200);
 const organizationId=org.json().id;
 const project=await post(`/api/v1/admin/organizations/${organizationId}/projects`,{operationId:randomUUID(),name:'Launch test'});assert.equal(project.statusCode,200);const projectId=project.json().id;
 const saved=await post(`/api/v1/admin/projects/${projectId}/brief`,{operationId:randomUUID(),organizationId,expectedVersion:0,brief:launchBrief()});assert.equal(saved.statusCode,200);
 const briefVersionId=saved.json().id,path=`/api/v1/admin/projects/${projectId}/workflows`,body={briefVersionId,idempotencyKey:randomUUID()};
 const state=async()=>{const res=await request(api,`/api/v1/admin/projects/${projectId}/workflow-state`,session);assert.equal(res.statusCode,200);return res.json().run;};
 return {...fake,api,logs,post,organizationId,projectId,briefVersionId,path,body,session,state};
}
for(const primary of ['openai','yandex'])test(`owner launch real routed fake ${primary} persists all stages, outputs and usage without membership`,async t=>{
 const x=await launchSetup(t,{primary});const response=await x.post(x.path,x.body);assert.equal(response.statusCode,201,response.body);assert.deepEqual(Object.keys(response.json()),['runId']);
 const state=await x.state();assert.equal(state.status,'completed');assert.equal(state.briefVersionId,x.briefVersionId);assert.equal(state.stages.filter(s=>s.status==='completed').length,5);assert.ok(state.versionId&&state.qaId);
 for(const [table,count] of [['domain_snapshots',3],['agent_executions',5],['ai_usage',5],['website_versions',1],['qa_reports',1],['audit_events',2]])assert.equal(Number((await pool.query(`SELECT count(*) FROM kleo.${table} WHERE workflow_run_id=$1`,[state.id])).rows[0].count),count,table);
 assert.equal(Number((await pool.query('SELECT count(*) FROM kleo.memberships WHERE organization_id=$1',[x.organizationId])).rows[0].count),0);
 assert.equal((await pool.query('SELECT request_id FROM kleo.workflow_runs WHERE id=$1',[state.id])).rows[0].request_id,response.headers['x-request-id']);
 const repeat=await x.post(x.path,x.body);assert.equal(repeat.statusCode,200);assert.equal(repeat.json().runId,state.id);assert.equal(x.calls.length,5);
 const revised=await x.post(`/api/v1/admin/projects/${x.projectId}/brief`,{operationId:randomUUID(),organizationId:x.organizationId,expectedVersion:1,brief:{...launchBrief(),notes:'Revised'}});assert.equal(revised.statusCode,200);
 assert.equal((await x.state()).briefVersionId,x.briefVersionId);assert.equal((await x.post(x.path,{...x.body,briefVersionId:revised.json().id})).statusCode,409);
 for(const marker of ['TEST_ONLY_LAUNCH_CREDENTIAL','RAW_PROVIDER','system prompt','document','password_hash'])assert.ok(!JSON.stringify([state,x.logs,response.json()]).includes(marker));
});
test('owner launch concurrency: active duplicate and key replay never execute twice; status survives a second API instance',async t=>{
 let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);const x=await launchSetup(t,{hold:async stage=>{if(stage==='business'){entered();await wait;}}});
 const first=x.post(x.path,x.body);await Promise.race([started,first.then(r=>{throw Error('Launch ended before provider: '+r.statusCode);})]);
 try{
  const state=await x.state();assert.equal(state.status,'running');assert.equal(state.stages[0].status,'running');
  const second=await x.post(x.path,x.body);assert.equal(second.statusCode,200);assert.equal(second.json().runId,state.id);
  assert.equal((await x.post(x.path,{...x.body,idempotencyKey:randomUUID()})).statusCode,409);
  const {api}=await app(t),session=await login(api,owner);const recovered=await request(api,`/api/v1/admin/projects/${x.projectId}/workflow-state`,session);assert.equal(recovered.json().run.id,state.id);assert.equal(recovered.json().run.status,'running');
  const changed=await x.post(`/api/v1/admin/projects/${x.projectId}/brief`,{operationId:randomUUID(),organizationId:x.organizationId,expectedVersion:1,brief:{...launchBrief(),notes:'New brief during run'}});assert.equal(changed.statusCode,200);
  assert.equal((await x.post(x.path,{briefVersionId:changed.json().id,idempotencyKey:randomUUID()})).statusCode,409);
  assert.equal((await x.state()).briefVersionId,x.briefVersionId);
 }finally{release();}assert.equal((await first).statusCode,201);assert.equal(x.calls.length,5);
});
for(const fail of ['business','design','content','developer','qa'])test(`owner launch ${fail} failure stops downstream and preserves consumed usage`,async t=>{
 const x=await launchSetup(t,{fail});const response=await x.post(x.path,x.body);assert.equal(response.statusCode,201);const state=await x.state();assert.equal(state.status,'failed');assert.equal(state.failureCode,'WORKFLOW_FAILED');
 const index=['business','design','content','developer','qa'].indexOf(fail);assert.equal(x.calls.length,index+1);assert.equal(state.stages[index].status,'failed');assert.equal(state.stages.filter(s=>s.status==='completed').length,index);assert.ok(!JSON.stringify(state).includes('RAW_PROVIDER'));
 const usage=await pool.query('SELECT * FROM kleo.ai_usage WHERE workflow_run_id=$1',[state.id]);assert.ok(usage.rows.length>=index);
});
test('owner launch valid semantic QA fail is a persisted qa_failed result, not HTTP 500',async t=>{const x=await launchSetup(t,{qaPass:false});assert.equal((await x.post(x.path,x.body)).statusCode,201);const state=await x.state();assert.equal(state.status,'qa_failed');assert.ok(state.qaId&&state.versionId);assert.equal(state.stages[4].status,'completed');});
test('owner launch shared budget exhaustion blocks downstream and keeps prior usage',async t=>{
 const x=await launchSetup(t,{}, {...WORKFLOW_LIMITS,maxRequestsPerWorkflow:2});assert.equal((await x.post(x.path,x.body)).statusCode,201);const state=await x.state();assert.equal(state.status,'failed');assert.equal(state.failureCode,'BUDGET_EXCEEDED');assert.equal(x.calls.length,2);assert.equal(state.stages[2].status,'failed');assert.equal(Number((await pool.query('SELECT count(*) FROM kleo.ai_usage WHERE workflow_run_id=$1 AND total_tokens=30',[state.id])).rows[0].count),2);
});
test('owner launch transient fallback uses existing Router and shared accounting',async t=>{const x=await launchSetup(t,{transient:true});assert.equal((await x.post(x.path,x.body)).statusCode,201);const state=await x.state();assert.equal(state.status,'completed');assert.equal(x.calls.length,6);assert.equal(Number((await pool.query('SELECT count(*) FROM kleo.ai_usage WHERE workflow_run_id=$1',[state.id])).rows[0].count),6);});
for(const role of ['anonymous','tenant','platform_admin'])test(`owner launch denies ${role}`,async t=>{
 const x=await launchSetup(t);let session={};if(role==='tenant')session=await login(x.api,A);if(role==='platform_admin'){const c=await tenant();await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[c.userId]);session=await login(x.api,c);}
 const res=await request(x.api,x.path,{method:'POST',...session,body:x.body});assert.equal(res.statusCode,role==='anonymous'?401:403);assert.equal(x.calls.length,0);
});
for(const mode of ['csrf','origin','extra','missing-brief','wrong-project','inactive-project','inactive-org'])test(`owner launch rejects ${mode} before AI`,async t=>{
 const x=await launchSetup(t);let body={...x.body},path=x.path,opts={},expected=400;
 if(mode==='csrf'){opts.csrf='invalid';expected=403;}if(mode==='origin'){opts.headers={origin:'https://evil.test'};expected=403;}
 if(mode==='extra')body.budgetBypass=true;if(mode==='missing-brief'){body.briefVersionId=randomUUID();expected=404;}
 if(mode==='wrong-project'){path=`/api/v1/admin/projects/${B.projectId}/workflows`;expected=404;}
 if(mode==='inactive-project'){await pool.query("UPDATE kleo.projects SET status='archived' WHERE id=$1",[x.projectId]);expected=404;}
 if(mode==='inactive-org'){await pool.query("UPDATE kleo.organizations SET status='archived' WHERE id=$1",[x.organizationId]);expected=404;}
 assert.equal((await x.post(path,body,opts)).statusCode,expected);assert.equal(x.calls.length,0);
});
test('owner launch audit failure rolls back run and command before AI',async t=>{
 const x=await launchSetup(t);await pool.query("CREATE FUNCTION kleo.fail_launch_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test only'; END $$; CREATE TRIGGER fail_launch_audit BEFORE INSERT ON kleo.audit_events FOR EACH ROW EXECUTE FUNCTION kleo.fail_launch_audit()");
 try{assert.equal((await x.post(x.path,x.body)).statusCode,503);assert.equal(x.calls.length,0);assert.equal(await x.state(),null);assert.equal(Number((await pool.query('SELECT count(*) FROM kleo.owner_commands WHERE operation_id=$1',[x.body.idempotencyKey])).rows[0].count),0);}finally{await pool.query('DROP TRIGGER fail_launch_audit ON kleo.audit_events; DROP FUNCTION kleo.fail_launch_audit()');}
});
test('owner launch status selector cannot expose another project run',async t=>{const x=await launchSetup(t);const response=await x.post(x.path,x.body);assert.equal((await request(x.api,`/api/v1/admin/projects/${B.projectId}/workflow-state?workflowId=${response.json().runId}`,x.session)).statusCode,404);});
test('owner launch timeout is persisted, consumes no fallback or downstream stage',async t=>{
 const x=await launchSetup(t,{hold:async(_stage,signal)=>{await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});}},{...WORKFLOW_LIMITS,timeoutMs:30});
 const res=await x.post(x.path,x.body);assert.equal(res.statusCode,201);const state=await x.state();assert.equal(state.status,'failed');assert.equal(state.failureCode,'TIMEOUT');assert.equal(x.calls.length,1);assert.equal(state.stages[0].status,'failed');
});
test('owner launch binding and provenance immutable at DB; scope-bound store cannot finish another run',async t=>{
 const x=await launchSetup(t);await x.post(x.path,x.body);const state=await x.state();
 await assert.rejects(runtime.query('UPDATE kleo.workflow_runs SET source_brief_version_id=$2 WHERE id=$1',[state.id,randomUUID()]),e=>e.code==='42501');
 await assert.rejects(pool.query('UPDATE kleo.workflow_runs SET source_brief_version_id=$2 WHERE id=$1',[state.id,randomUUID()]),e=>e.code==='23514');
 const s={actorId:A.userId,projectId:x.projectId,organizationId:x.organizationId};await assert.rejects(new PostgresPersistence(runtime,{id:state.id,scope:s}).getRun(s,state.id),e=>e.code==='ACCESS_DENIED');
});
test('owner workflow DB binding rejects cross-project source, tenant owner launch forgery and preserves legacy membership FK',async t=>{
 const x=await launchSetup(t);const ownerId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id;
 const sql="INSERT INTO kleo.workflow_runs(organization_id,project_id,actor_id,invocation_id,source_brief_version_id,request_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')";
 await assert.rejects(pool.query(sql,[B.organizationId,B.projectId,ownerId,randomUUID(),x.briefVersionId,randomUUID()]),e=>e.code==='23503');
 await assert.rejects(pool.query(sql,[x.organizationId,x.projectId,A.userId,randomUUID(),x.briefVersionId,randomUUID()]),e=>e.code==='23503');
 await assert.rejects(pool.query('DELETE FROM kleo.memberships WHERE organization_id=$1 AND user_id=$2',[A.organizationId,A.userId]),e=>e.code==='23503');
 assert.equal(x.calls.length,0);
});
test('terminal failure relaunch is explicit new run; old history remains immutable',async t=>{
 const x=await launchSetup(t,{qaPass:false});const first=await x.post(x.path,x.body),second=await x.post(x.path,{...x.body,idempotencyKey:randomUUID()});assert.equal(first.statusCode,201);assert.equal(second.statusCode,201);assert.notEqual(first.json().runId,second.json().runId);assert.equal(x.calls.length,10);
 const history=await pool.query('SELECT source_brief_version_id,status FROM kleo.workflow_runs WHERE project_id=$1',[x.projectId]);assert.equal(history.rows.length,2);assert.ok(history.rows.every(r=>r.status==='qa_failed'&&r.source_brief_version_id===x.briefVersionId));
});
test('owner launch rate limit and disabled composition cannot create unbounded work',async t=>{
 const x=await launchSetup(t);await x.post(x.path,x.body);for(let i=0;i<4;i++)assert.equal((await x.post(x.path,x.body)).statusCode,200);assert.equal((await x.post(x.path,x.body)).statusCode,429);assert.equal(x.calls.length,5);
 const {api}=await app(t),session=await login(api,owner);const res=await request(api,x.path,{method:'POST',...session,body:{...x.body,idempotencyKey:randomUUID()}});assert.equal(res.statusCode,503);assert.equal(Number((await pool.query('SELECT count(*) FROM kleo.workflow_runs WHERE project_id=$1',[x.projectId])).rows[0].count),1);
});
test('restart leaves expired interrupted run visible and blocks automatic/duplicate execution',async t=>{
 const x=await launchSetup(t),actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id,runId=randomUUID();
 await pool.query("INSERT INTO kleo.workflow_runs(id,organization_id,project_id,actor_id,invocation_id,source_brief_version_id,request_id,started_at,deadline_at,current_stage) VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '11 minutes',now()-interval '1 minute','business')",[runId,x.organizationId,x.projectId,actorId,randomUUID(),x.briefVersionId,randomUUID()]);
 const state=await x.state();assert.equal(state.id,runId);assert.equal(state.status,'running');assert.ok(Date.parse(state.deadlineAt)<Date.now());assert.equal((await x.post(x.path,x.body)).statusCode,409);assert.equal(x.calls.length,0);
});
test('migration 004 checksum and generated membership binding survive replay',async()=>{
 const files=await loadMigrations(),last=files.find(f=>f.name.startsWith('004_'));assert.ok(last);await assert.rejects(migrate(pool,files.map(f=>f===last?{...f,sql:f.sql+'\n-- tamper'}:f)),e=>e.code==='MIGRATION_MISMATCH');
});

test('Design validation diagnostic reaches internal reporter after launch without public response or DB payload leakage',async t=>{
 const events=[],x=await launchSetup(t,{invalidDesign:true},WORKFLOW_LIMITS,event=>events.push(event));
 const response=await x.post(x.path,x.body);assert.equal(response.statusCode,201);const run=await x.state();assert.equal(run.status,'failed');
 assert.equal(events.length,1);assert.equal(events[0].runId,run.id);assert.equal(events[0].event,'design_validation_failed');assert.equal(events[0].diagnostic.stage,'design-domain');
 assert.ok(events[0].diagnostic.issues.some(i=>i.code==='INVALID_OUTPUT'&&i.field==='design.styleName'));
 assert.ok(events[0].diagnostic.issues.every(i=>Object.keys(i).sort().join(',')==='code,field'));
 assert.deepEqual(Object.keys(response.json()),['runId']);assert.equal(run.diagnostic,undefined);
 const rows=(await pool.query("SELECT error_code FROM kleo.agent_executions WHERE workflow_run_id=$1 AND agent_type='design'",[run.id])).rows;assert.equal(rows[0].error_code,'INVALID_RESPONSE');
 assert.equal(x.calls.length,2);
});

test('Content validation diagnostic reaches internal launch log with unchanged public response',async t=>{
 const events=[],x=await launchSetup(t,{invalidContent:true},WORKFLOW_LIMITS,event=>events.push(event));
 const response=await x.post(x.path,x.body);assert.equal(response.statusCode,201);const run=await x.state();assert.equal(run.status,'failed');
 assert.equal(events.length,1);assert.equal(events[0].event,'content_validation_failed');assert.equal(events[0].runId,run.id);
 assert.equal(events[0].diagnostic.stage,'content-schema');assert.equal(events[0].diagnostic.rule,'SCHEMA_REQUIRED');assert.deepEqual(Object.keys(events[0].diagnostic).sort(),['path','rule','stage']);
 assert.deepEqual(Object.keys(response.json()),['runId']);assert.equal(run.diagnostic,undefined);assert.equal(x.calls.length,3);
 const executions=(await pool.query('SELECT agent_type,status,error_code FROM kleo.agent_executions WHERE workflow_run_id=$1',[run.id])).rows;
 assert.equal(executions.find(e=>e.agent_type==='content').error_code,'INVALID_RESPONSE');assert.ok(executions.filter(e=>e.agent_type!=='content').every(e=>e.status==='completed'&&e.error_code===null));
});

test('Owner Brief evidence is identical across agents and validators; supported service persists without 006',async t=>{
 const seen={};const claim='Выполняем монтаж';
 const x=await launchSetup(t,{contentText:claim,inspectRequest(stage,req){seen[stage]=JSON.parse(req.messages[1].content);}});
 const saved=await x.post(`/api/v1/admin/projects/${x.projectId}/brief`,{operationId:randomUUID(),organizationId:x.organizationId,expectedVersion:1,brief:{...launchBrief(),productsOrServices:claim}});
 assert.equal(saved.statusCode,200);const version=saved.json().id;
 const r=await x.post(x.path,{...x.body,briefVersionId:version});assert.equal(r.statusCode,201);
 const state=await x.state();assert.equal(state.status,'completed');assert.equal(x.calls.length,5);
 const facts=seen.business.confirmedBusinessFacts;
 assert.ok(facts.facts.every(f=>f.source.briefVersionId===version));
 assert.deepEqual(seen.content.confirmedBusinessFacts,facts);assert.ok(seen.content.groundingFacts.includes(claim));
 // Persisted successful Content proves the independent DB revalidation uses the bound Brief.
 const content=(await pool.query("SELECT document FROM kleo.domain_snapshots WHERE workflow_run_id=$1 AND kind='content'",[state.id])).rows[0].document;
 assert.equal(content.sections[0].text,claim);
 assert.equal((await pool.query("SELECT count(*) FROM kleo.schema_migrations WHERE name='006_content_correction_usage.sql'")).rows[0].count,'0');
 // A new run bound to v1 must not borrow evidence from v2 or from caller-supplied metadata.
 const actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id;
 const runId=randomUUID(),scope={actorId,organizationId:x.organizationId,projectId:x.projectId};
 await pool.query("INSERT INTO kleo.workflow_runs(id,organization_id,project_id,actor_id,invocation_id,source_brief_version_id,request_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",[runId,scope.organizationId,scope.projectId,actorId,randomUUID(),x.briefVersionId,randomUUID()]);
 const snapshots=(await pool.query('SELECT kind,document FROM kleo.domain_snapshots WHERE workflow_run_id=$1',[state.id])).rows;
 const forged={success:false,state:Object.fromEntries(snapshots.map(r=>[r.kind,r.document])),confirmedBusinessFacts:facts};
 const store=new PostgresPersistence(runtime,{id:runId,scope});
 await assert.rejects(store.finishRun(scope,runId,forged),e=>e.code==='INVALID_INPUT');
 assert.equal((await pool.query('SELECT count(*) FROM kleo.domain_snapshots WHERE workflow_run_id=$1',[runId])).rows[0].count,'0');
});
test('Owner Launch rejects unconfirmed service in one Content generation and ignores request evidence injection',async t=>{
 const x=await launchSetup(t,{contentText:'Доставляем изделия'});
 const forged={...x.body,confirmedBusinessFacts:{facts:[]}};
 assert.equal((await x.post(x.path,forged)).statusCode,400);
 assert.equal((await x.post(x.path,x.body)).statusCode,201);
 assert.equal((await x.state()).status,'failed');assert.deepEqual(x.calls.map(c=>c.stage),['business','design','content']);
});


// Block generation uses the restricted API DB role and fake guarded providers only.
import {BlockLaunchService,configuredBlockFactory} from '../../.test-build/apps/api/src/block-launch.js';
import {fakeBlockFactory,neutralBlockPlan} from '../fixtures/block.mjs';
import {qaWire} from '../fixtures/qa.mjs';
import {readBlockTask} from '../../.test-build/packages/persistence/src/block-workflow.js';
async function blockSetup(t,options={}){
 const events=[],fake=fakeBlockFactory(options),sourceFactory=options.launchFactory??fake.factory;
 const factory=options.inspectTask?async(...args)=>{const runner=await sourceFactory(...args);return {run:task=>{options.inspectTask(task);return runner.run(task);}};}:sourceFactory;
 const blocks=new BlockLaunchService(runtime,factory,event=>events.push(event));
 const {api,logs}=await app(t,{},auth,{blocks}),session=await login(api,owner),{org,project}=await ownerProject(api,session);
 const base=`/api/v1/admin/projects/${project.id}`,post=(path,body,opts={})=>request(api,path,{method:'POST',...session,body,...opts});
 if(options.baseOrders){
  const pageId=randomUUID(),document={id:pageId,slug:'/',title:'Главная',status:'draft',order:0,blocks:options.baseOrders.map((order,index)=>({id:`base-${index}`,type:'text',order,visible:true,content:{text:`Base ${index}`}}))};
  const designSystem={colors:{primary:'#334455',background:'#ffffff',text:'#111111'},typography:{headingFont:'Arial',bodyFont:'Arial',baseFontSize:16},spacing:{section:64,block:24},borderRadius:8};
  await pool.query('INSERT INTO kleo.block_pages(id,organization_id,project_id,document,design_system) VALUES($1,$2,$3,$4,$5)',[pageId,org.id,project.id,JSON.stringify(document),JSON.stringify(designSystem)]);
 }
 assert.equal((await post(base+'/block-pages',{idempotencyKey:randomUUID()})).statusCode,200);
 const view=async()=>{const r=await request(api,base+'/block-workflows',session);assert.equal(r.statusCode,200);return r.json();};
 const pageId=(await view()).pages[0].id,body={pageId,instruction:'Сделай информационный блок',idempotencyKey:randomUUID()};
 return {...fake,api,logs,events,session,org,project,base,post,view,body};
}
async function seedBlockOrders(x,orders){
 const actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id;
 for(const [index,order] of orders.entries()){
  const runId=randomUUID(),blockId=randomUUID();
  await pool.query("INSERT INTO kleo.block_runs(id,organization_id,project_id,page_id,block_id,actor_id,request_id,instruction,status,stage,started_at,deadline_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Existing block','completed','qa',now()-interval '2 minutes',now()+interval '1 minute',now())",[runId,x.org.id,x.project.id,x.body.pageId,blockId,actorId,randomUUID()]);
  await pool.query('INSERT INTO kleo.blocks(id,organization_id,project_id,page_id) VALUES($1,$2,$3,$4)',[blockId,x.org.id,x.project.id,x.body.pageId]);
  const document={id:blockId,type:'text',order,visible:true,content:{text:`Existing ${index}`}};
  const qa={passed:true,score:100,issues:[],summary:'Existing',recommendations:[]};
  await pool.query('INSERT INTO kleo.block_versions(id,organization_id,project_id,page_id,block_id,run_id,version,document,qa) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8)',[randomUUID(),x.org.id,x.project.id,x.body.pageId,blockId,runId,JSON.stringify(document),JSON.stringify(qa)]);
 }
}
test('block create without Brief persists canonical version, server IDs, QA, usage and audit; replay is exactly once',async t=>{
 const x=await blockSetup(t),url=x.base+'/block-workflows';const r=await x.post(url,x.body);assert.equal(r.statusCode,201,r.body);
 assert.equal(r.json().status,'accepted');
 const run=(await x.view()).run;assert.equal(run.status,'completed');assert.equal(run.id,r.json().runId);assert.notEqual(run.blockId,x.body.pageId);assert.ok(run.versionId);
 assert.equal((await x.post(url,x.body)).statusCode,200);assert.equal(x.calls.length,2);
 const versions=(await request(x.api,x.base+'/blocks/'+run.blockId+'/versions',x.session)).json().items;assert.equal(versions.length,1);assert.equal(versions[0].document.id,run.blockId);assert.equal(versions[0].page_id,x.body.pageId);assert.equal(versions[0].document.type,'text');assert.equal(versions[0].qa.passed,true);
 const record=(await pool.query('SELECT * FROM kleo.block_runs WHERE id=$1',[run.id])).rows[0];assert.equal(record.source_brief_id,null);assert.equal(record.request_id,r.headers['x-request-id']);assert.equal(record.instruction,x.body.instruction);
 const phases=(await pool.query('SELECT * FROM kleo.block_execution WHERE run_id=$1',[run.id])).rows;assert.equal(phases.length,4);assert.ok(phases.every(p=>p.status==='completed'));assert.equal(phases.reduce((n,p)=>n+p.usage.length,0),2);assert.equal(phases.flatMap(p=>p.usage).reduce((n,p)=>n+p.totalTokens,0),20);
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_audit WHERE run_id=$1',[run.id])).rows[0].count,'2');
 assert.equal((await pool.query("SELECT count(*) FROM kleo.security_audit_events WHERE resource_id=$1 AND event_type='block_pages_prepared'",[x.project.id])).rows[0].count,'1');
 for(const table of ['block_versions','block_pages','blocks'])await assert.rejects(pool.query(`DELETE FROM kleo.${table} WHERE project_id=$1`,[x.project.id]),e=>e.code==='23514');
 await assert.rejects(runtime.query('UPDATE kleo.block_versions SET version=2 WHERE id=$1',[run.versionId]),e=>e.code==='42501');
 await assert.rejects(pool.query("UPDATE kleo.block_runs SET status='running' WHERE id=$1",[run.id]),e=>e.code==='23514');
 assert.equal((await x.post(url,{...x.body,instruction:'Другой блок'})).statusCode,409);
 const {api}=await app(t),session=await login(api,owner);const recovered=await request(api,x.base+'/block-workflows/'+run.id,session);assert.equal(recovered.json().run.versionId,run.versionId);
 assert.ok(!JSON.stringify(x.logs).includes(x.body.instruction));
});
test('ambiguous Block instruction returns application clarification and never reaches AI generation',async t=>{
 const x=await blockSetup(t);const response=await x.post(x.base+'/block-workflows',{...x.body,instruction:'сделай шапку сайта'});assert.equal(response.statusCode,200,response.body);
 const body=response.json();assert.equal(body.status,'needs_clarification');assert.equal(body.clarification.code,'TARGET_UNCLEAR');assert.ok(body.clarification.question);assert.equal(x.calls.length,0);
 const run=(await x.view()).run;assert.equal(run.status,'failed');assert.ok(!JSON.stringify(body).includes('сделай шапку сайта'));
});
test('unclear factual Block instruction on orders 5-9 remains CLAIM_UNCLEAR through API and persistence',async t=>{
 let effectiveOrders;const instruction='цены стекло быстро монтаж там хорошо',x=await blockSetup(t,{unavailableSecrets:true,baseOrders:[0,1,2,3,4],inspectTask:task=>{effectiveOrders=task.page.blocks.map(block=>block.order);}});
 await seedBlockOrders(x,[5,6,7,8,9]);
 const response=await x.post(x.base+'/block-workflows',{...x.body,instruction});assert.equal(response.statusCode,200,response.body);
 const body=response.json();assert.equal(body.status,'needs_clarification');assert.equal(body.clarification.code,'CLAIM_UNCLEAR');assert.ok(body.clarification.question);assert.equal(x.calls.length,0);
 assert.deepEqual(effectiveOrders,[0,1,2,3,4,5,6,7,8,9]);
 const run=(await x.view()).run;assert.equal(run.status,'failed');assert.equal(run.errorCode,'INVALID_INPUT');
 const persisted=(await pool.query('SELECT status,stage,error_code FROM kleo.block_runs WHERE id=$1',[run.id])).rows[0];assert.deepEqual(persisted,{status:'failed',stage:'starting',error_code:'INVALID_INPUT'});
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_versions WHERE run_id=$1',[run.id])).rows[0].count,'0');
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_execution WHERE run_id=$1',[run.id])).rows[0].count,'0');
 const diagnostic=x.events.find(event=>event.event==='input_interpretation_completed');assert.equal(diagnostic?.runId,run.id);assert.equal(diagnostic?.outcome,'needs_clarification');assert.deepEqual(diagnostic?.ambiguityCodes,['CLAIM_UNCLEAR']);
 const observable=JSON.stringify({logs:x.logs,events:x.events});assert.ok(!observable.includes(instruction));assert.ok(!observable.includes(body.clarification.question));
});
test('normal Block generation persists append order 10 after existing orders 5-9',async t=>{
 const x=await blockSetup(t);await seedBlockOrders(x,[5,6,7,8,9]);
 const response=await x.post(x.base+'/block-workflows',x.body);assert.equal(response.statusCode,201,response.body);
 const run=(await x.view()).run;assert.equal(run.status,'completed');assert.equal(x.calls.length,2);
 const version=(await pool.query('SELECT document FROM kleo.block_versions WHERE run_id=$1',[run.id])).rows[0];assert.equal(version.document.order,10);
});
test('actual ten-block page limit rejects safely before AI with LIMIT_EXCEEDED',async t=>{
 let effectiveOrders;const x=await blockSetup(t,{baseOrders:[0,1,2,3,4],inspectTask:task=>{effectiveOrders=task.page.blocks.map(block=>block.order);}});await seedBlockOrders(x,[5,6,7,8,9]);
 const response=await x.post(x.base+'/block-workflows',{...x.body,instruction:'создай блок преимуществ'});assert.equal(response.statusCode,201,response.body);
 const run=(await x.view()).run;assert.equal(run.status,'failed');assert.equal(run.stage,'starting');assert.equal(run.errorCode,'LIMIT_EXCEEDED');assert.equal(x.calls.length,0);
 assert.deepEqual(effectiveOrders,[0,1,2,3,4,5,6,7,8,9]);
 const understanding=x.events.find(event=>event.event==='input_interpretation_completed');assert.equal(understanding?.outcome,'understood');assert.equal(understanding?.operation,'GENERATE');assert.equal(understanding?.targetType,'advantages');assert.equal(understanding?.provider,'deterministic');
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_execution WHERE run_id=$1',[run.id])).rows[0].count,'0');
});
test('effective nine-block page still creates and persists its tenth block',async t=>{
 let effectiveOrders;const x=await blockSetup(t,{baseOrders:[0,1,2,3,4],inspectTask:task=>{effectiveOrders=task.page.blocks.map(block=>block.order);}});await seedBlockOrders(x,[5,6,7,8]);
 const response=await x.post(x.base+'/block-workflows',{...x.body,instruction:'создай информационный блок'});assert.equal(response.statusCode,201,response.body);
 const run=(await x.view()).run;assert.equal(run.status,'completed');assert.equal(x.calls.length,2);assert.deepEqual(effectiveOrders,[0,1,2,3,4,5,6,7,8]);
 const version=(await pool.query('SELECT document FROM kleo.block_versions WHERE run_id=$1',[run.id])).rows[0];assert.equal(version.document.order,9);
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_versions WHERE page_id=$1',[x.body.pageId])).rows[0].count,'5');
});
test('real configured Block factory resolves deterministic CLAIM_UNCLEAR without provider configuration',async t=>{
 let providerConfigReads=0;
 const env=new Proxy({KLEO_WORKFLOW_ENABLED:'1',NODE_ENV:'test'},{get(target,key){if(typeof key==='string'&&/(?:OPENAI|YANDEX|AI_PRIMARY|AI_FALLBACK)/u.test(key))providerConfigReads++;return target[key];}});
 const launchFactory=configuredBlockFactory(env);assert.ok(launchFactory);
 const instruction='цены стекло быстро монтаж там хорошо',x=await blockSetup(t,{launchFactory,baseOrders:[0,1,2,3,4]});await seedBlockOrders(x,[5,6,7,8,9]);
 const response=await x.post(x.base+'/block-workflows',{...x.body,instruction});assert.equal(response.statusCode,200,response.body);
 const body=response.json();assert.equal(body.status,'needs_clarification');assert.equal(body.clarification.code,'CLAIM_UNCLEAR');assert.equal(providerConfigReads,0);
 const run=(await x.view()).run;assert.equal(run.status,'failed');assert.equal(run.stage,'starting');assert.equal(run.errorCode,'INVALID_INPUT');
 assert.equal((await pool.query('SELECT count(*) FROM kleo.block_versions WHERE run_id=$1',[run.id])).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM kleo.block_execution WHERE run_id=$1',[run.id])).rows[0].count,'0');
 const event=x.events.find(value=>value.event==='input_interpretation_completed');assert.equal(event?.runId,run.id);assert.equal(event?.provider,'deterministic');assert.equal(event?.operation,'EDIT');assert.deepEqual(event?.ambiguityCodes,['CLAIM_UNCLEAR']);
 const observable=JSON.stringify({logs:x.logs,events:x.events});assert.ok(!observable.includes(instruction));assert.ok(!observable.includes(body.clarification.question));
});
test('real configured Block factory still validates provider configuration when AI understanding is required',async t=>{
 let providerConfigReads=0;
 const env=new Proxy({KLEO_WORKFLOW_ENABLED:'1',NODE_ENV:'test'},{get(target,key){if(typeof key==='string'&&/(?:OPENAI|YANDEX|AI_PRIMARY|AI_FALLBACK)/u.test(key))providerConfigReads++;return target[key];}}),launchFactory=configuredBlockFactory(env);assert.ok(launchFactory);
 const x=await blockSetup(t,{launchFactory}),response=await x.post(x.base+'/block-workflows',{...x.body,instruction:'там сделай по нормальному'});assert.equal(response.statusCode,201,response.body);assert.equal(response.json().status,'accepted');assert.ok(providerConfigReads>0);
 const run=(await x.view()).run;assert.equal(run.status,'failed');assert.equal(run.errorCode,'MISSING_API_KEY');assert.equal(run.versionId,null);assert.equal((await pool.query('SELECT count(*) FROM kleo.block_versions WHERE run_id=$1',[run.id])).rows[0].count,'0');
 assert.ok(!JSON.stringify({logs:x.logs,events:x.events}).includes('Добавьте OPENAI_API_KEY'));
});
test('second block append leaves previous version, page and global website untouched',async t=>{
 const x=await blockSetup(t);const before=(await pool.query('SELECT document,design_system FROM kleo.block_pages WHERE project_id=$1',[x.project.id])).rows;
 await x.post(x.base+'/block-workflows',x.body);const first=(await request(x.api,x.base+'/blocks',x.session)).json().items[0];
 assert.equal((await x.post(x.base+'/block-workflows',{...x.body,idempotencyKey:randomUUID()})).statusCode,201);
 const items=(await request(x.api,x.base+'/blocks',x.session)).json().items;assert.equal(items.length,2);assert.deepEqual(items[0],first);assert.equal(items[1].document.order,1);
 assert.deepEqual((await pool.query('SELECT document,design_system FROM kleo.block_pages WHERE project_id=$1',[x.project.id])).rows,before);
 assert.equal((await pool.query('SELECT count(*) FROM kleo.website_versions WHERE project_id=$1',[x.project.id])).rows[0].count,'0');
});
test('active block prevents concurrent new launch; identical in-flight request recovers run without second execution',async t=>{
 let release,started;const barrier=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 const x=await blockSetup(t,{hold:async()=>{started();await barrier;}});const pending=x.post(x.base+'/block-workflows',x.body);await ready;
 try{
  const duplicate=await x.post(x.base+'/block-workflows',x.body);assert.equal(duplicate.statusCode,200);assert.equal((await x.post(x.base+'/block-workflows',{...x.body,idempotencyKey:randomUUID()})).statusCode,409);assert.equal(x.calls.length,1);
  const {api}=await app(t),session=await login(api,owner);const recovered=await request(api,x.base+'/block-workflows',session);assert.equal(recovered.json().run.status,'running');assert.equal(recovered.json().run.stage,'content');
 }finally{release();}assert.equal((await pending).statusCode,201);assert.equal(x.calls.length,2);
});
for(const role of ['tenant','platform_admin'])test(`block ${role} cannot launch or initialize; only admin may read`,async t=>{
 const x=await blockSetup(t),u=await tenant();if(role==='platform_admin')await pool.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_admin')",[u.userId]);const session=await login(x.api,u);
 for(const [suffix,body] of [['/block-pages',{idempotencyKey:randomUUID()}],['/block-workflows',x.body]])assert.equal((await x.post(x.base+suffix,body,session)).statusCode,403);
 for(const suffix of ['/block-workflows','/blocks'])assert.equal((await request(x.api,x.base+suffix,session)).statusCode,role==='tenant'?403:200);assert.equal(x.calls.length,0);
});
for(const variant of ['foreign-page','foreign-project','foreign-block','scope','status','budget','type','oversize','csrf'])test(`block launch rejects ${variant} before AI`,async t=>{
 const x=await blockSetup(t);let path=x.base+'/block-workflows',body={...x.body},opts={},status=400;
 if(variant==='foreign-page'){body.pageId=randomUUID();status=404;}
 if(variant==='foreign-project'){path=`/api/v1/admin/projects/${B.projectId}/block-workflows`;status=404;}
 if(variant==='foreign-block'){body.blockId=randomUUID();status=404;}
 if(variant==='scope')body.organizationId=B.organizationId;
 if(variant==='status')body.status='published';
 if(variant==='budget')body.maxRequestsPerWorkflow=999;
 if(variant==='type')body.blockType='script';
 if(variant==='oversize')body.instruction='x'.repeat(2001);
 if(variant==='csrf'){opts.csrf='wrong';status=403;}
 assert.equal((await x.post(path,body,opts)).statusCode,status);assert.equal(x.calls.length,0);
});
test('foreign run/version cannot be selected through another organization project',async t=>{
 const x=await blockSetup(t);await x.post(x.base+'/block-workflows',x.body);const run=(await x.view()).run;
 for(const suffix of ['/block-workflows/'+run.id,'/blocks/'+run.blockId+'/versions'])assert.equal((await request(x.api,`/api/v1/admin/projects/${B.projectId}`+suffix,x.session)).statusCode,404);
 await assert.rejects(pool.query('INSERT INTO kleo.blocks(id,organization_id,project_id,page_id) VALUES($1,$2,$3,$4)',[randomUUID(),B.organizationId,x.project.id,x.body.pageId]),e=>e.code==='23503');
});
for(const mode of ['invalid','qa','provider'])test(`block ${mode} failure creates no version and exposes only safe code`,async t=>{
 const x=await blockSetup(t,mode==='invalid'?{plan:{}}:mode==='qa'?{qa:qaWire(false)}:{fail:Error('RAW_RESPONSE_PRIVATE')});
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,201);const view=await x.view();assert.equal(view.run.status,'failed');assert.equal(view.run.versionId,null);assert.ok(view.run.errorCode);assert.ok(!JSON.stringify(view).includes('PRIVATE'));
 assert.equal((await request(x.api,x.base+'/blocks',x.session)).json().items.length,0);assert.ok(!JSON.stringify(x.logs).includes('PRIVATE'));
});
test('block persistence preserves safe provider error code instead of collapsing to STAGE_FAILED',async t=>{
 const x=await blockSetup(t,{fail:new AIProviderError('NETWORK')});
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,201);
 const view=await x.view();
 assert.equal(view.run.status,'failed');
 assert.equal(view.run.errorCode,'NETWORK');
 assert.equal(view.run.versionId,null);
 assert.equal((await request(x.api,x.base+'/blocks',x.session)).json().items.length,0);
});
test('block binds immutable Brief evidence and never elevates user instruction to facts',async t=>{
 let captured;const plan=neutralBlockPlan();plan.sections[0].text='Выполняем монтаж';const x=await blockSetup(t,{plan,inspect:req=>{if(req.structuredOutput.name==='block_content')captured=JSON.parse(req.messages[1].content);}});
 const saved=await x.post(x.base+'/brief',{operationId:randomUUID(),organizationId:x.org.id,expectedVersion:0,brief:{...launchBrief(),productsOrServices:'Выполняем монтаж'}});assert.equal(saved.statusCode,200);
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,201);assert.equal((await x.view()).run.status,'completed');assert.ok(captured.groundingFacts.includes('Выполняем монтаж'));
 const row=(await pool.query('SELECT source_brief_id FROM kleo.block_runs WHERE project_id=$1',[x.project.id])).rows[0];assert.equal(row.source_brief_id,saved.json().id);
 const y=await blockSetup(t,{plan});y.body.instruction='Сделай блок с услугой монтаж';await y.post(y.base+'/block-workflows',y.body);assert.equal((await y.view()).run.errorCode,'INVALID_RESPONSE');
});
test('block imports existing canonical pages once without modifying full-site version',async t=>{
 const {api}=await app(t),s=await login(api,owner),base=`/api/v1/admin/projects/${A.projectId}`;
 const before=(await pool.query('SELECT document FROM kleo.website_versions WHERE project_id=$1',[A.projectId])).rows;
 const key=randomUUID();for(let i=0;i<2;i++)assert.equal((await request(api,base+'/block-pages',{method:'POST',...s,body:{idempotencyKey:key}})).statusCode,200);
 const pages=(await request(api,base+'/block-workflows',s)).json().pages;assert.equal(pages[0].id,before[0].document.pages[0].id);
 assert.deepEqual((await pool.query('SELECT document FROM kleo.website_versions WHERE project_id=$1',[A.projectId])).rows,before);
});

test('expired persisted block after restart is never relaunched and rejects late success',async t=>{
 const x=await blockSetup(t),actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id;
 const runId=randomUUID(),scope={actorId,projectId:x.project.id,organizationId:x.org.id};
 await pool.query("INSERT INTO kleo.block_runs(id,organization_id,project_id,page_id,block_id,actor_id,request_id,instruction,started_at,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Draft',now()-interval '3 minutes',now()-interval '1 minute')",[runId,x.org.id,x.project.id,x.body.pageId,randomUUID(),actorId,randomUUID()]);
 const before=(await x.view()).run;assert.equal(before.status,'running');assert.ok(Date.parse(before.deadlineAt)<Date.now());
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,409);
 const service=new BlockLaunchService(runtime,x.factory);await service.execute({runId,scope,created:false});assert.equal(x.calls.length,0);
 await service.execute({runId,scope,created:true});assert.equal(x.calls.length,0);assert.equal((await x.view()).run.errorCode,'TIMEOUT');
});
test('malformed internal block success fails persistence safely with no partial version',async t=>{
 const x=await blockSetup(t),blocks=new BlockLaunchService(runtime,async()=>({run:async()=>({success:true,block:{id:'foreign'}})}));
 const {api}=await app(t,{},auth,{blocks}),session=await login(api,owner);
 assert.equal((await request(api,x.base+'/block-workflows',{method:'POST',...session,body:x.body})).statusCode,201);
 assert.equal((await x.view()).run.errorCode,'STAGE_FAILED');assert.equal((await request(api,x.base+'/blocks',session)).json().items.length,0);
});
test('block and full-site launches share project exclusion in both directions',async t=>{
 const x=await launchSetup(t);const prepared=await x.post(`/api/v1/admin/projects/${x.projectId}/block-pages`,{idempotencyKey:randomUUID()});assert.equal(prepared.statusCode,200);
 const pageId=(await request(x.api,`/api/v1/admin/projects/${x.projectId}/block-workflows`,x.session)).json().pages[0].id;
 const actorId=(await pool.query("SELECT user_id FROM kleo.platform_roles WHERE role='platform_owner'")).rows[0].user_id,blockRun=randomUUID();
 await pool.query("INSERT INTO kleo.block_runs(id,organization_id,project_id,page_id,block_id,actor_id,request_id,instruction,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Draft',now()+interval '1 minute')",[blockRun,x.organizationId,x.projectId,pageId,randomUUID(),actorId,randomUUID()]);
 assert.equal((await x.post(x.path,x.body)).statusCode,409);assert.equal(x.calls.length,0);
 await pool.query("UPDATE kleo.block_runs SET status='failed',error_code='CANCELLED',completed_at=now() WHERE id=$1",[blockRun]);
 await pool.query("INSERT INTO kleo.workflow_runs(id,organization_id,project_id,actor_id,invocation_id,source_brief_version_id,request_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 minute')",[randomUUID(),x.organizationId,x.projectId,actorId,randomUUID(),x.briefVersionId,randomUUID()]);
 const fake=fakeBlockFactory(),{api}=await app(t,{},auth,{blocks:new BlockLaunchService(runtime,fake.factory)}),session=await login(api,owner);
 assert.equal((await request(api,`/api/v1/admin/projects/${x.projectId}/block-workflows`,{method:'POST',...session,body:{pageId,instruction:'Draft',idempotencyKey:randomUUID()}})).statusCode,409);assert.equal(fake.calls.length,0);
});

test('block QA validation diagnostic reaches internal logger only; DB and public DTO stay unchanged',async t=>{
 const x=await blockSetup(t),events=[],fake=fakeBlockFactory({qa:{}});
 const blocks=new BlockLaunchService(runtime,fake.factory,event=>events.push(event));
 const {api}=await app(t,{},auth,{blocks}),session=await login(api,owner);
 const response=await request(api,x.base+'/block-workflows',{method:'POST',...session,body:x.body});assert.equal(response.statusCode,201);
 assert.deepEqual(Object.keys(response.json()).sort(),['runId','status']);const runId=response.json().runId;
 const event=events.find(value=>value.event==='block_qa_validation_failed');assert.ok(event);assert.deepEqual(Object.keys(event).sort(),['diagnostic','event','runId']);assert.equal(event.runId,runId);
 assert.deepEqual(Object.keys(event.diagnostic).sort(),['path','rule','stage']);assert.equal(event.diagnostic.stage,'qa-schema');
 const state=(await request(api,x.base+'/block-workflows/'+runId,session)).json();assert.equal(state.run.errorCode,'INVALID_RESPONSE');assert.ok(!JSON.stringify(state).includes('diagnostic'));
 const row=(await pool.query('SELECT * FROM kleo.block_runs WHERE id=$1',[runId])).rows[0];assert.equal(row.error_code,'INVALID_RESPONSE');assert.equal(row.qaValidationError,undefined);
 const execution=(await pool.query("SELECT status,usage FROM kleo.block_execution WHERE run_id=$1 AND stage='qa'",[runId])).rows[0];assert.equal(execution.status,'failed');assert.equal(execution.usage[0].outcome,'success');
 for(const text of ['Website','Brief','prompt','content',x.body.instruction])assert.ok(!JSON.stringify(event).includes(text));
});

test('block runtime diagnostic is correlated to the HTTP run and remains internal',async t=>{
 const x=await blockSetup(t),events=[],fake=fakeBlockFactory(),marker={buildIdentifier:'0123456789abcdef',buildTimestamp:'2026-09-18T12:00:00.000Z',sourceArtifact:'.test-build/apps/api/src/index.js',processPid:12345,configuredApiPort:3001};
 const blocks=new BlockLaunchService(runtime,fake.factory,event=>events.push(event),marker);
 const {api}=await app(t,{},auth,{blocks}),session=await login(api,owner),response=await request(api,x.base+'/block-workflows',{method:'POST',...session,body:x.body});assert.equal(response.statusCode,201);
 const runId=response.json().runId,event=events.find(value=>value.event==='block_runtime_diagnostic');assert.ok(event);assert.equal(event.runId,runId);assert.equal(event.processPid,12345);assert.equal(event.configuredApiPort,3001);assert.equal(event.sourceArtifact,'.test-build/apps/api/src/index.js');
 assert.equal(event.initialValidation,'pass');assert.equal(event.finalValidation,'pass');assert.equal(event.developerReached,true);assert.equal(event.qaReached,true);
 const state=(await request(api,x.base+'/block-workflows/'+runId,session)).json();assert.ok(!JSON.stringify(state).includes('runtime_diagnostic'));assert.ok(!JSON.stringify(state).includes('buildIdentifier'));
 for(const privateValue of [x.body.instruction,'prompt','Brief','Website','TEST_ONLY_BLOCK_KEY'])assert.ok(!JSON.stringify(events).includes(privateValue));
});

test('block correction persists both Content generations and only the grounded block',async t=>{
 const plan=neutralBlockPlan();plan.sections[0].text='Высокое качество';let generations=0;
 const x=await blockSetup(t,{plan,hold:async req=>{if(req.structuredOutput.name==='block_content'&&++generations===2){
  const prior=(await pool.query("SELECT e.status,e.usage FROM kleo.block_execution e JOIN kleo.block_runs r ON r.id=e.run_id WHERE r.project_id=$1 AND e.stage='content'",[x.project.id])).rows[0];
  assert.equal(prior.status,'started');assert.equal(prior.usage.length,1);Object.assign(plan,neutralBlockPlan());
 }}});
 const r=await x.post(x.base+'/block-workflows',x.body);assert.equal(r.statusCode,201);
 const run=(await x.view()).run;assert.equal(run.status,'completed');assert.equal(x.calls.length,3);
 const content=(await pool.query("SELECT status,usage FROM kleo.block_execution WHERE run_id=$1 AND stage='content'",[run.id])).rows[0];
 assert.equal(content.status,'completed');assert.equal(content.usage.length,2);assert.equal(content.usage.reduce((n,v)=>n+v.totalTokens,0),20);assert.ok(!JSON.stringify(content).includes('Высокое качество'));
 const versions=(await request(x.api,x.base+'/blocks/'+run.blockId+'/versions',x.session)).json().items;assert.equal(versions.length,1);assert.ok(!JSON.stringify(versions).includes('Высокое качество'));
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,200);assert.equal(x.calls.length,3);
});

test('saved structured Brief reconstructs independent item provenance through Block launch and persistence',async t=>{
 const original=['собственное производство','качественная фурнитура','прозрачные цены'].map(text=>({text}));let captured;
 const plan=neutralBlockPlan();plan.sections[0].type='advantages';plan.sections[0].points=['Собственное производство','Фурнитура высокого качества','Прозрачное ценообразование'];
 const x=await blockSetup(t,{plan,inspect:req=>{if(req.structuredOutput.name==='block_content')captured=JSON.parse(req.messages[1].content);}});
 const saved=await x.post(x.base+'/brief',{operationId:randomUUID(),organizationId:x.org.id,expectedVersion:0,brief:{...launchBrief(),advantages:original}});assert.equal(saved.statusCode,200);
 assert.equal((await x.post(x.base+'/block-workflows',{...x.body,blockType:'advantages'})).statusCode,201);
 const run=(await x.view()).run;assert.equal(run.status,'completed');assert.equal(x.calls.length,2);
 const atoms=captured.confirmedBusinessFacts.facts.filter(f=>f.category==='advantages');assert.equal(atoms.length,3);
 for(const [index,f] of atoms.entries())assert.deepEqual(f.source,{kind:'owner_brief',briefVersionId:saved.json().id,field:'advantages',item:{index,count:3}});
 const stored=(await pool.query('SELECT document FROM kleo.project_briefs WHERE id=$1',[saved.json().id])).rows[0].document;assert.deepEqual(stored.advantages,original);
 const {confirmedFactsFromBrief}=await import('../../.test-build/packages/core/src/confirmed-business-facts.js');
 assert.deepEqual(confirmedFactsFromBrief(stored,saved.json().id),captured.confirmedBusinessFacts);
 const versions=(await request(x.api,x.base+'/blocks/'+run.blockId+'/versions',x.session)).json().items;assert.deepEqual(versions[0].document.content.points,['собственное производство','качественная фурнитура','прозрачные цены']);
});

test('whole-site persistence independently grounds atomic paraphrase from its exact saved Brief',async t=>{
 const claim='Фурнитура высокого качества',seen={};
 const x=await launchSetup(t,{contentText:claim,inspectRequest(stage,req){seen[stage]=JSON.parse(req.messages[1].content);}});
 const saved=await x.post(`/api/v1/admin/projects/${x.projectId}/brief`,{operationId:randomUUID(),organizationId:x.organizationId,expectedVersion:1,brief:{...launchBrief(),advantages:['собственное производство','качественная фурнитура','прозрачные цены'].map(text=>({text}))}});
 assert.equal(saved.statusCode,200);assert.equal((await x.post(x.path,{...x.body,briefVersionId:saved.json().id})).statusCode,201);
 const state=await x.state();assert.equal(state.status,'completed');assert.equal(x.calls.length,5);
 assert.deepEqual(seen.business.confirmedBusinessFacts,seen.content.confirmedBusinessFacts);
 assert.equal(seen.content.confirmedBusinessFacts.facts.filter(f=>f.category==='advantages').length,3);
 const content=(await pool.query("SELECT document FROM kleo.domain_snapshots WHERE workflow_run_id=$1 AND kind='content'",[state.id])).rows[0].document;assert.equal(content.sections[0].text,claim);
});

test('Block API selects isolated QA scope and persists block quality observations',async t=>{
 let requestQA;const qa={...qaWire(),issues:[{code:'CONTENT_QUALITY',severity:'warning',message:'Clarify the individual benefits.',pageIndex:0,blockIndex:0,recommendation:null}]};
 const x=await blockSetup(t,{qa,inspect:req=>{if(req.structuredOutput.name==='qa_report')requestQA=req;}});
 assert.equal((await x.post(x.base+'/block-workflows',x.body)).statusCode,201);const run=(await x.view()).run;assert.equal(run.status,'completed');
 assert.ok(!requestQA.structuredOutput.schema.properties.issues.items.properties.code.enum.includes('SEO_INVALID'));
 assert.equal(JSON.parse(requestQA.messages[1].content).website.pages[0].seo,undefined);
 const versions=(await request(x.api,x.base+'/blocks/'+run.blockId+'/versions',x.session)).json().items;assert.equal(versions[0].qa.issues[0].code,'CONTENT_QUALITY');assert.equal(x.calls.length,2);
});
