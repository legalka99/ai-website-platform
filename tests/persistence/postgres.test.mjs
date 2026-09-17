import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresPersistence,migrate,runPersistedWorkflow } from '../../.test-build/packages/persistence/src/index.js';
import { qaInput } from '../fixtures/qa.mjs';
import { loadMigrations } from '../../scripts/persistence-db.mjs';
if(process.env.KLEO_ISOLATED_DB_TEST!=='1'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='kleo_test')throw Error('Use isolated test runner');
const pool=new Pool({max:5,connectionTimeoutMillis:2000}),repo=new PostgresPersistence(pool);
test.after(()=>pool.end());
async function tenant(){const {userId,organizationId}=await repo.provisionOrganization('Test organization');return {actorId:userId,organizationId,projectId:await repo.createProject(userId,organizationId,'Test project')};}
function result(scope,pass=true){const input=qaInput();input.website.projectId=scope.projectId;return {success:pass,state:{...input.reviewContext,developer:{website:input.website,generatedAt:input.generatedAt},qa:{passed:pass,score:pass?90:40,issues:pass?[]:[{code:'BUSINESS_ALIGNMENT',severity:'error',message:'Review alignment.'}],checkedAt:new Date().toISOString()}}};}
async function complete(scope){scope??=await tenant();const run=await repo.startRun(scope),value=result(scope),stored=await repo.finishRun(scope,run.id,value);return {scope,run,value,stored};}
test('clean migration creates all foundation tables and repeated migration is a no-op',async()=>{
 const tables=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='kleo'");
 for(const name of ['users','organizations','memberships','projects','workflow_runs','agent_executions','domain_snapshots','websites','website_versions','qa_reports','ai_usage','approvals','audit_events','schema_migrations'])assert.ok(tables.rows.some(r=>r.table_name===name));
 await migrate(pool,await loadMigrations());assert.equal((await pool.query('SELECT count(*) FROM kleo.schema_migrations')).rows[0].count,'1');
});
test('migration checksum mismatch fails safely',async()=>{
 const list=await loadMigrations();await assert.rejects(migrate(pool,[{...list[0],sql:list[0].sql+'\n-- changed'}]),e=>e.code==='MIGRATION_MISMATCH');
});
test('failed migration rolls back DDL and migration record atomically',async()=>{
 await assert.rejects(migrate(pool,[...await loadMigrations(),{name:'002_failure.sql',sql:'CREATE TABLE kleo.rollback_probe(id int); SELECT missing_function();'}]),e=>e.code==='DATABASE_FAILURE');
 assert.equal((await pool.query("SELECT to_regclass('kleo.rollback_probe') AS table")).rows[0].table,null);assert.equal((await pool.query('SELECT count(*) FROM kleo.schema_migrations')).rows[0].count,'1');
});
test('completed workflow stores snapshots, immutable draft, exact QA version and audit',async()=>{
 const {scope,stored,value}=await complete(),v=await repo.getVersion(scope,stored.versionId),details=await repo.getRunDetails(scope,stored.id);
 assert.equal(stored.status,'completed');assert.equal(v.document.projectId,scope.projectId);assert.equal(v.document.id,stored.websiteId);assert.equal(v.document.status,'draft');assert.equal(v.qa.passed,true);assert.equal(v.versionNumber,1);assert.equal(details.snapshots.length,3);assert.equal(details.executions.length,5);assert.equal(details.audit.length,2);
 assert.notEqual(v.document.id,value.state.developer.website.id);assert.equal(v.workflowRunId,stored.id);
});
test('repeat finalization is idempotent, conflicting result is rejected',async()=>{
 const {scope,run,value,stored}=await complete();assert.deepEqual(await repo.finishRun(scope,run.id,value),stored);
 const changed=structuredClone(value);changed.state.qa.score=89;await assert.rejects(repo.finishRun(scope,run.id,changed),e=>e.code==='CONFLICT');
 assert.equal((await repo.listRuns(scope)).length,1);assert.equal((await repo.getRunDetails(scope,run.id)).executions.length,5);
});
test('concurrent duplicate finalization creates one version and one set of executions',async()=>{
 const s=await tenant(),run=await repo.startRun(s),r=result(s);const [a,b]=await Promise.all([repo.finishRun(s,run.id,r),repo.finishRun(s,run.id,r)]);assert.deepEqual(a,b);assert.equal((await repo.getRunDetails(s,run.id)).executions.length,5);
});
test('concurrent versions of same Website serialize numbering without mutating previous version',async()=>{
 const {scope,stored}=await complete();const first=await repo.getVersion(scope,stored.versionId),runs=await Promise.all([repo.startRun(scope),repo.startRun(scope)]);
 const versions=await Promise.all(runs.map(run=>repo.finishRun(scope,run.id,result(scope),{websiteId:stored.websiteId})));
 assert.deepEqual(versions.map(v=>v.versionNumber).sort(),[2,3]);assert.deepEqual(await repo.getVersion(scope,stored.versionId),first);
});
for(const resource of ['run','version','details'])test(`foreign ${resource} cannot be read even with known ID`,async()=>{
 const a=await complete(),b=await tenant();const call=resource==='run'?()=>repo.getRun(b,a.run.id):resource==='version'?()=>repo.getVersion(b,a.stored.versionId):()=>repo.getRunDetails(b,a.run.id);
 await assert.rejects(call,e=>e.code==='NOT_FOUND');await assert.rejects(repo.getRun({...a.scope,actorId:b.actorId},a.run.id),e=>e.code==='ACCESS_DENIED');
});
test('forged organization/project pairing and revoked membership denied',async()=>{
 const a=await tenant(),b=await tenant();await assert.rejects(repo.startRun({...a,projectId:b.projectId}),e=>e.code==='ACCESS_DENIED');
 await pool.query("UPDATE kleo.memberships SET status='revoked' WHERE organization_id=$1 AND user_id=$2",[a.organizationId,a.actorId]);await assert.rejects(repo.startRun(a),e=>e.code==='ACCESS_DENIED');
});
test('viewer can read but cannot start or finalize workflow',async()=>{
 const a=await complete();await pool.query("UPDATE kleo.memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2",[a.scope.organizationId,a.scope.actorId]);
 assert.equal((await repo.getRun(a.scope,a.run.id)).status,'completed');await assert.rejects(repo.startRun(a.scope),e=>e.code==='ACCESS_DENIED');await assert.rejects(repo.finishRun(a.scope,a.run.id,a.value),e=>e.code==='ACCESS_DENIED');
});
test('database composite FK rejects cross-tenant version even for direct SQL',async()=>{
 const a=await complete(),b=await complete(),run=await repo.startRun(a.scope);await assert.rejects(pool.query('INSERT INTO kleo.website_versions(organization_id,project_id,website_id,workflow_run_id,version_number,document) VALUES($1,$2,$3,$4,99,$5)',[a.scope.organizationId,a.scope.projectId,b.stored.websiteId,run.id,JSON.stringify({...a.value.state.developer.website,id:b.stored.websiteId})]),e=>e.code==='23503');
});
test('QA cannot attach to a different run version within same project',async()=>{
 const scope=await tenant(),first=await repo.startRun(scope),r=result(scope);delete r.state.qa;r.success=false;
 const version=await repo.finishRun(scope,first.id,r),run=await repo.startRun(scope);await assert.rejects(pool.query('INSERT INTO kleo.qa_reports(organization_id,project_id,workflow_run_id,website_version_id,passed,score,document) VALUES($1,$2,$3,$4,true,90,$5)',[scope.organizationId,scope.projectId,run.id,version.versionId,JSON.stringify(result(scope).state.qa)]),e=>e.code==='23503');
});
for(const table of ['website_versions','qa_reports','domain_snapshots','agent_executions','audit_events'])test(`${table} rejects direct update and delete`,async()=>{
 const a=await complete();for(const verb of ['UPDATE','DELETE'])await assert.rejects(pool.query(verb==='UPDATE'?`UPDATE kleo.${table} SET created_at=now() WHERE workflow_run_id=$1`:`DELETE FROM kleo.${table} WHERE workflow_run_id=$1`,[a.run.id]),e=>e.code==='23514');
});
test('organization deletion is restrictive, no cascade destruction',async()=>{const a=await complete();await assert.rejects(pool.query('DELETE FROM kleo.organizations WHERE id=$1',[a.scope.organizationId]),e=>e.code==='23503');assert.ok(await repo.getRun(a.scope,a.run.id));});
test('valid QA FAIL persists report and draft; technical failure preserves previous snapshots only',async()=>{
 const s=await tenant(),a=await repo.startRun(s),negative=await repo.finishRun(s,a.id,result(s,false));assert.equal(negative.status,'qa_failed');assert.equal((await repo.getVersion(s,negative.versionId)).qa.passed,false);
 const b=await repo.startRun(s),r=result(s);delete r.state.qa;r.success=false;r.error='PRIVATE_PROVIDER_RESPONSE';const failure=await repo.finishRun(s,b.id,r);assert.equal(failure.status,'failed');assert.equal((await repo.getVersion(s,failure.versionId)).qa,null);assert.ok(!JSON.stringify(await repo.getRunDetails(s,b.id)).includes('PRIVATE_PROVIDER_RESPONSE'));
});
test('failed finalization rolls back previously inserted snapshots',async()=>{
 const s=await tenant(),run=await repo.startRun(s);await assert.rejects(repo.finishRun(s,run.id,result(s),{websiteId:randomUUID()}),e=>e.code==='NOT_FOUND');
 const details=await repo.getRunDetails(s,run.id);assert.equal(details.run.status,'running');assert.equal(details.snapshots.length,0);assert.equal(details.executions.length,0);assert.equal(details.audit.length,1);
});
test('late database failure rolls back versions, QA, executions, usage and snapshots',async()=>{
 const s=await tenant(),run=await repo.startRun(s); // Force final audit uniqueness conflict after all data inserts.
 await pool.query("INSERT INTO kleo.audit_events(organization_id,project_id,actor_id,workflow_run_id,event_type) VALUES($1,$2,$3,$4,'workflow_completed')",[s.organizationId,s.projectId,s.actorId,run.id]);
 await assert.rejects(repo.finishRun(s,run.id,result(s)),e=>e.code==='CONFLICT');const d=await repo.getRunDetails(s,run.id);assert.equal(d.run.status,'running');assert.equal(d.run.versionId,undefined);assert.equal(d.snapshots.length,0);assert.equal(d.executions.length,0);
});
test('fallback attempts persisted once, missing usage remains NULL, arbitrary metadata excluded',async()=>{
 const s=await tenant(),run=await repo.startRun(s),r=result(s),usage={provider:'yandex',model:'test-model',projectId:s.projectId,organizationId:s.organizationId,actorId:s.actorId,workflowId:run.id,agentType:'qa',inputTokens:10,outputTokens:20,totalTokens:30,cachedInputTokens:2,durationMs:4,requestId:'safe-id',timestamp:'arbitrary-time',raw:'PRIVATE_RESPONSE'};
 r.executions={qa:{projectId:s.projectId,goal:'PRIVATE_PROMPT',usage,routing:{attempts:[{provider:'openai',model:'test-model',outcome:'failure'},{provider:'yandex',model:'test-model',outcome:'success',usage}]},headers:'PRIVATE_HEADERS'}};
 await repo.finishRun(s,run.id,r);const d=await repo.getRunDetails(s,run.id);assert.equal(d.usage.length,2);assert.equal(d.usage[0].total_tokens,null);assert.equal(d.usage[1].total_tokens,'30');assert.equal(d.usage[1].cached_input_tokens,'2');assert.ok(!JSON.stringify(d).includes('PRIVATE_'));
});
test('foreign telemetry scope or raw secrets in domain output rejected before writes',async()=>{
 const s=await tenant(),run=await repo.startRun(s),r=result(s);r.state.business.notes='password: TEST_ONLY_PRIVATE';await assert.rejects(repo.finishRun(s,run.id,r),e=>e.code==='INVALID_INPUT');
 const clean=result(s);clean.executions={qa:{projectId:s.projectId,usage:{provider:'openai',model:'test',projectId:randomUUID()}}};await assert.rejects(repo.finishRun(s,run.id,clean),e=>e.code==='INVALID_INPUT');assert.equal((await repo.getRunDetails(s,run.id)).snapshots.length,0);
});
test('workflow wrapper supplies server run ID to runner factory and records cancellation',async()=>{
 const s=await tenant();let calls=0;const output=await runPersistedWorkflow(repo,s,{goal:'Build',input:{},signal:AbortSignal.abort()},async runId=>{calls++;assert.match(runId,/^[a-f0-9-]{36}$/);return {async run(task){assert.equal(task.projectId,s.projectId);return {success:false,state:{},error:'PRIVATE_ERROR'};}};});assert.equal(calls,1);assert.equal(output.stored.status,'cancelled');assert.equal((await repo.getRunDetails(s,output.stored.id)).executions[0].error_code,'CANCELLED');
});
test('terminal run cannot be overwritten by direct SQL',async()=>{const a=await complete();await assert.rejects(pool.query("UPDATE kleo.workflow_runs SET status='failed' WHERE id=$1",[a.run.id]),e=>e.code==='23514');});
test('server invocation retry, including concurrent starts, returns one run and one audit',async()=>{
 const s=await tenant(),invocationId=randomUUID();const [a,b]=await Promise.all([repo.startRun(s,invocationId),repo.startRun(s,invocationId)]);assert.deepEqual(a,b);assert.equal((await repo.listRuns(s)).length,1);assert.equal((await repo.getRunDetails(s,a.id)).audit.length,1);
});
test('same organization project resources cannot be crossed through repository selectors',async()=>{
 const a=await complete(),scope={...a.scope,projectId:await repo.createProject(a.scope.actorId,a.scope.organizationId,'Another project')};
 await assert.rejects(repo.getVersion(scope,a.stored.versionId),e=>e.code==='NOT_FOUND');const run=await repo.startRun(scope);await assert.rejects(repo.finishRun(scope,run.id,result(scope),{websiteId:a.stored.websiteId}),e=>e.code==='NOT_FOUND');
});
test('SQL-looking name stays parameter data; timestamps replace model metadata',async()=>{
 const s=await tenant();await repo.createProject(s.actorId,s.organizationId,"Name'; DROP TABLE kleo.projects; --");assert.ok(await repo.startRun(s));
 const run=await repo.startRun(s),r=result(s);r.state.developer.website.createdAt='2000-01-01T00:00:00.000Z';r.state.developer.website.updatedAt='2000-01-01T00:00:00.000Z';r.state.qa.checkedAt='2000-01-01T00:00:00.000Z';
 const saved=await repo.finishRun(s,run.id,r),v=await repo.getVersion(s,saved.versionId);assert.notEqual(v.document.createdAt,r.state.developer.website.createdAt);assert.notEqual(v.qa.checkedAt,r.state.qa.checkedAt);
});
test('disabled user and archived project cannot access stored runs',async()=>{
 const a=await complete();await pool.query("UPDATE kleo.users SET status='disabled' WHERE id=$1",[a.scope.actorId]);await assert.rejects(repo.getRun(a.scope,a.run.id),e=>e.code==='ACCESS_DENIED');
 const b=await complete();await pool.query("UPDATE kleo.projects SET status='archived' WHERE id=$1",[b.scope.projectId]);await assert.rejects(repo.getRun(b.scope,b.run.id),e=>e.code==='ACCESS_DENIED');
});
test('invalid lifecycle status, version number and telemetry counts rejected by database',async()=>{
 const a=await complete();await assert.rejects(pool.query("UPDATE kleo.projects SET status='published' WHERE id=$1",[a.scope.projectId]),e=>e.code==='23514');
 const run=await repo.startRun(a.scope);await assert.rejects(pool.query('INSERT INTO kleo.website_versions(organization_id,project_id,website_id,workflow_run_id,version_number,document) VALUES($1,$2,$3,$4,0,$5)',[a.scope.organizationId,a.scope.projectId,a.stored.websiteId,run.id,JSON.stringify({...a.value.state.developer.website,id:a.stored.websiteId})]),e=>e.code==='23514');
 const d=await repo.getRunDetails(a.scope,a.run.id);await assert.rejects(pool.query("INSERT INTO kleo.ai_usage(organization_id,project_id,workflow_run_id,execution_id,attempt,provider,model,outcome,input_tokens) VALUES($1,$2,$3,$4,1,'openai','test','success',-1)",[a.scope.organizationId,a.scope.projectId,a.run.id,d.executions[0].id]),e=>e.code==='23514');
});
test('persisted wrapper integrates the existing five-stage WebsiteWorkflowOrchestrator',async()=>{
 const {WebsiteWorkflowOrchestrator}=await import('../../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js');
 const scope=await tenant(),r=result(scope),calls=[];
 const out=await runPersistedWorkflow(repo,scope,{goal:'Build a draft',input:{}},async runId=>new WebsiteWorkflowOrchestrator(Object.fromEntries(['business','design','content','developer','qa'].map(type=>[type,{type,async run(context){calls.push(type);assert.equal(context.projectId,scope.projectId);return {success:true,output:r.state[type],execution:{projectId:scope.projectId,goal:'PRIVATE_GOAL',usage:{provider:'openai',model:'test',workflowId:runId,agentType:type,totalTokens:30,durationMs:1}}};}}]))));
 assert.equal(out.result.success,true);assert.equal(out.stored.status,'completed');assert.equal(calls.length,5);const d=await repo.getRunDetails(scope,out.stored.id);assert.equal(d.usage.length,5);assert.ok(!JSON.stringify(d).includes('PRIVATE_GOAL'));
});
test('restricted runtime role performs workflow operations but cannot delete, provision or change membership roles',async()=>{
 const {readFile}=await import('node:fs/promises'),scope=await tenant();await pool.query(await readFile(new URL('../../packages/persistence/sql/runtime-grants.sql',import.meta.url),'utf8'));
 const restricted=new Pool({max:2,options:'-c role=kleo_runtime'}),store=new PostgresPersistence(restricted);
 try{const run=await store.startRun(scope),done=await store.finishRun(scope,run.id,result(scope));assert.equal(done.status,'completed');assert.equal((await store.getRunDetails(scope,run.id)).snapshots.length,3);
  await assert.rejects(restricted.query('DELETE FROM kleo.projects WHERE id=$1',[scope.projectId]),e=>e.code==='42501');await assert.rejects(restricted.query("UPDATE kleo.memberships SET role='owner'"),e=>e.code==='42501');await assert.rejects(store.provisionOrganization('Disallowed'),e=>e.code==='DATABASE_FAILURE');
 }finally{await restricted.end();}
});
test('JSON null cannot bypass SQL Website ownership consistency',async()=>{
 const a=await complete(),run=await repo.startRun(a.scope);await assert.rejects(pool.query('INSERT INTO kleo.website_versions(organization_id,project_id,website_id,workflow_run_id,version_number,document) VALUES($1,$2,$3,$4,2,$5)',[a.scope.organizationId,a.scope.projectId,a.stored.websiteId,run.id,JSON.stringify({...a.value.state.developer.website,id:a.stored.websiteId,projectId:null})]),e=>e.code==='23514');
});
