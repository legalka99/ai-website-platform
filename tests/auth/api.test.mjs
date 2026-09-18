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

const ownerBrief=()=>({companyName:'Owner studio',description:'Furniture design',productsOrServices:'Tables',targetAudience:'Businesses',geography:null,websiteGoals:'Enquiries',advantages:null,desiredActions:'Contact us',contacts:'hello@example.test',notes:null});
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
