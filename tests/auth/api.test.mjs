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
 runtime=new Pool({max:1,options:'-c role=kleo_api'});auth=await AuthRepository.create(runtime,3600);operator=await AuthRepository.create(pool);hash=await hashPassword(password);
 A=await tenant();B=await tenant();await operator.bootstrapOwner('owner@example.test',password);owner={email:'owner@example.test'};
});
test.after(async()=>{globalThis.fetch=forbiddenNetwork;await runtime?.end();await pool.end();});
async function tenant(){const {userId,organizationId}=await repo.provisionOrganization('Private tenant'),projectId=await repo.createProject(userId,organizationId,'Private project'),email=`${randomUUID()}@example.test`;
 await pool.query('INSERT INTO kleo.auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',[userId,email,hash]);
 const scope={actorId:userId,organizationId,projectId},input=qaInput();input.website.projectId=projectId;const run=await repo.startRun(scope);
 const stored=await repo.finishRun(scope,run.id,{success:true,state:{...input.reviewContext,developer:{website:input.website,generatedAt:input.generatedAt},qa:{passed:true,score:90,issues:[],checkedAt:new Date().toISOString()}},executions:{qa:{projectId,usage:{provider:'openai',model:'test',workflowId:run.id,totalTokens:30,durationMs:1}}}});
 return {...scope,userId,email,stored};
}
async function app(t,overrides={},store=auth){const logs=[],api=await createApi(store,{...config,...overrides},{log:e=>logs.push(e)});t.after(()=>api.close());return {api,logs};}
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
test('auth migration replay and checksum protection remain active',async()=>{const migrations=await loadMigrations();await migrate(pool,migrations);assert.equal((await pool.query('SELECT count(*) FROM kleo.schema_migrations')).rows[0].count,'2');const changed=migrations.map(m=>m.name.startsWith('002')?{...m,sql:m.sql+'\n-- drift'}:m);await assert.rejects(migrate(pool,changed),e=>e.code==='MIGRATION_MISMATCH');});
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
