import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import type { WebsiteWorkflowResult } from '../../ai/src/orchestrator/website-workflow-types.js';
import { PersistenceError,type PersistenceScope,type StoredRun,type WorkflowPersistence } from './contracts.js';
import { digest,invalid,safeLabel,scopeCopy,stages,telemetry,uuid,validateResult,snapshot } from './validation.js';

/** Trusted server infrastructure only. No instance or pool is exposed to AI agents. */
export class PostgresPersistence implements WorkflowPersistence {
 constructor(private readonly pool:Pool) {}
 private async transaction<T>(work:(db:PoolClient)=>Promise<T>):Promise<T> {
  let db;
  try{db=await this.pool.connect();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='10s'");await db.query("SET LOCAL lock_timeout='5s'");const out=await work(db);await db.query('COMMIT');return out;}
  catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});if(e instanceof PersistenceError)throw e;
   const code= e&&typeof e==='object'&&'code' in e?e.code:undefined;
   throw new PersistenceError(['23505','23503','23514','40001','40P01'].includes(String(code))?'CONFLICT':'DATABASE_FAILURE');
  }finally{db?.release();}
 }
 private async authorize(db:PoolClient,s:PersistenceScope,write:boolean):Promise<void>{
  const r=await db.query(`SELECT m.role FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id
   JOIN kleo.memberships m ON m.organization_id=o.id JOIN kleo.users u ON u.id=m.user_id
   WHERE p.id=$1 AND o.id=$2 AND u.id=$3 AND p.status='active' AND o.status='active' AND u.status='active' AND m.status='active'
   FOR SHARE OF p,o,m,u`,[s.projectId,s.organizationId,s.actorId]);
  if(!r.rows.length||write&&!['owner','admin','member'].includes(r.rows[0].role))throw new PersistenceError('ACCESS_DENIED');
 }
 /** Local bootstrap/provisioning port; deliberately not part of tenant repository interface.
  * Requires privileged server caller. It implements no signup/authentication endpoint. */
 async provisionOrganization(name:string):Promise<{userId:string;organizationId:string}>{
  name=safeLabel(name);return this.transaction(async db=>{
   const userId=randomUUID(),organizationId=randomUUID();
   await db.query('INSERT INTO kleo.users(id) VALUES($1)',[userId]);
   await db.query('INSERT INTO kleo.organizations(id,name) VALUES($1,$2)',[organizationId,name]);
   await db.query("INSERT INTO kleo.memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",[organizationId,userId]);return {userId,organizationId};
  });
 }
 async createProject(actorId:string,organizationId:string,name:string):Promise<string>{
  uuid(actorId);uuid(organizationId);name=safeLabel(name);
  return this.transaction(async db=>{
   const access=await db.query(`SELECT m.role FROM kleo.memberships m JOIN kleo.users u ON u.id=m.user_id JOIN kleo.organizations o ON o.id=m.organization_id
    WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND u.status='active' AND o.status='active' FOR SHARE OF m,u,o`,[actorId,organizationId]);
   if(!access.rows.length||!['owner','admin'].includes(access.rows[0].role))throw new PersistenceError('ACCESS_DENIED');
   const id=randomUUID();await db.query('INSERT INTO kleo.projects(id,organization_id,name) VALUES($1,$2,$3)',[id,organizationId,name]);return id;
  });
 }
 async startRun(scope:PersistenceScope,invocationId=randomUUID()):Promise<StoredRun>{const s=scopeCopy(scope);uuid(invocationId);return this.transaction(async db=>{
  await this.authorize(db,s,true);const id=randomUUID();const inserted=await db.query('INSERT INTO kleo.workflow_runs(id,organization_id,project_id,actor_id,invocation_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,project_id,invocation_id) DO NOTHING RETURNING id',[id,s.organizationId,s.projectId,s.actorId,invocationId]);
  if(!inserted.rows.length){const existing=(await db.query('SELECT id,status,actor_id FROM kleo.workflow_runs WHERE organization_id=$1 AND project_id=$2 AND invocation_id=$3',[s.organizationId,s.projectId,invocationId])).rows[0];
   if(existing.actor_id!==s.actorId)throw new PersistenceError('ACCESS_DENIED');return this.summary(db,s,existing);}
  await this.audit(db,s,id,'workflow_started');return {id,status:'running'};
 });}
 private async audit(db:PoolClient,s:PersistenceScope,run:string,event:string){await db.query('INSERT INTO kleo.audit_events(organization_id,project_id,actor_id,workflow_run_id,event_type) VALUES($1,$2,$3,$4,$5)',[s.organizationId,s.projectId,s.actorId,run,event]);}
 private async runRow(db:PoolClient,s:PersistenceScope,id:string,lock=false){
  const result=await db.query(`SELECT id,status,result_digest,actor_id FROM kleo.workflow_runs WHERE organization_id=$1 AND project_id=$2 AND id=$3${lock?' FOR UPDATE':''}`,[s.organizationId,s.projectId,id]);
  if(!result.rows.length)throw new PersistenceError('NOT_FOUND');return result.rows[0];
 }
 private async summary(db:PoolClient,s:PersistenceScope,row:any):Promise<StoredRun>{
  const v=await db.query('SELECT id,website_id,version_number FROM kleo.website_versions WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3',[s.organizationId,s.projectId,row.id]);
  return {id:row.id,status:row.status,...(v.rows[0]?{versionId:v.rows[0].id,websiteId:v.rows[0].website_id,versionNumber:v.rows[0].version_number}:{})};
 }
 async finishRun(scope:PersistenceScope,runId:string,value:WebsiteWorkflowResult,options:{websiteId?:string;cancelled?:boolean}={}):Promise<StoredRun>{
  const s=scopeCopy(scope);uuid(runId);const opts=snapshot(options);if(Object.keys(opts).some(k=>!['websiteId','cancelled'].includes(k)))invalid();
  if(opts.websiteId!==undefined)uuid(opts.websiteId);if(opts.cancelled!==undefined&&typeof opts.cancelled!=='boolean')invalid();
  let r:WebsiteWorkflowResult;try{r=validateResult(value,s.projectId);}catch{throw new PersistenceError('INVALID_INPUT');}
  if(opts.websiteId&&!r.state.developer||opts.cancelled&&r.success)invalid();
  const outputs=stages.filter(stage=>r.state[stage]!==undefined),next=stages[outputs.length];
  if(r.executions&&Object.keys(r.executions).some(stage=>!outputs.includes(stage as any)&&stage!==next))invalid();
  const executions=stages.filter(stage=>outputs.includes(stage)||r.executions?.[stage]!==undefined||!r.success&&!r.state.qa&&stage===next).map(stage=>({stage,status:outputs.includes(stage)?'completed':opts.cancelled?'cancelled':'failed',attempts:telemetry(r.executions?.[stage],s,runId,stage)}));
  const status=opts.cancelled?'cancelled':r.success?'completed':r.state.qa?'qa_failed':'failed';
  // Ignore arbitrary error strings, prompts/goals, raw metadata and provider timestamps.
  const hash=digest({state:r.state,status,executions,websiteId:opts.websiteId??null});
  return this.transaction(async db=>{
   await this.authorize(db,s,true);const row=await this.runRow(db,s,runId,true);
   if(row.actor_id!==s.actorId)throw new PersistenceError('ACCESS_DENIED');
   if(row.status!=='running'){if(row.result_digest!==hash)throw new PersistenceError('CONFLICT');return this.summary(db,s,row);}
   for(const kind of ['business','design','content'] as const)if(r.state[kind])await db.query('INSERT INTO kleo.domain_snapshots(organization_id,project_id,workflow_run_id,kind,document) VALUES($1,$2,$3,$4,$5)',[s.organizationId,s.projectId,runId,kind,JSON.stringify(r.state[kind])]);
   if(r.state.developer){
    let websiteId=opts.websiteId;
    if(websiteId){const site=await db.query("SELECT id FROM kleo.websites WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND status='draft' FOR UPDATE",[s.organizationId,s.projectId,websiteId]);if(!site.rows.length)throw new PersistenceError('NOT_FOUND');}
    else{websiteId=randomUUID();await db.query('INSERT INTO kleo.websites(id,organization_id,project_id) VALUES($1,$2,$3)',[websiteId,s.organizationId,s.projectId]);}
    const number=(await db.query('SELECT COALESCE(MAX(version_number),0)+1 AS next FROM kleo.website_versions WHERE website_id=$1',[websiteId])).rows[0].next;
    const versionId=randomUUID(),now=(await db.query('SELECT now() AS now')).rows[0].now.toISOString();
    const document={...r.state.developer.website,id:websiteId,projectId:s.projectId,createdAt:now,updatedAt:now};
    await db.query('INSERT INTO kleo.website_versions(id,organization_id,project_id,website_id,workflow_run_id,version_number,document) VALUES($1,$2,$3,$4,$5,$6,$7)',[versionId,s.organizationId,s.projectId,websiteId,runId,number,JSON.stringify(document)]);
    if(r.state.qa){const report={...r.state.qa,checkedAt:now};await db.query('INSERT INTO kleo.qa_reports(organization_id,project_id,workflow_run_id,website_version_id,passed,score,document) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.organizationId,s.projectId,runId,versionId,report.passed,report.score,JSON.stringify(report)]);}
   }
   for(const e of executions){const executionId=randomUUID();
    await db.query('INSERT INTO kleo.agent_executions(id,organization_id,project_id,workflow_run_id,agent_type,status,error_code) VALUES($1,$2,$3,$4,$5,$6,$7)',[executionId,s.organizationId,s.projectId,runId,e.stage,e.status,e.status==='completed'?null:e.status==='cancelled'?'CANCELLED':'STAGE_FAILED']);
    for(const [index,a] of e.attempts.entries())await db.query(`INSERT INTO kleo.ai_usage(organization_id,project_id,workflow_run_id,execution_id,attempt,provider,model,outcome,request_id,input_tokens,output_tokens,total_tokens,cached_input_tokens,duration_ms)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[s.organizationId,s.projectId,runId,executionId,index+1,a.provider,a.model,a.outcome,a.requestId??null,a.inputTokens??null,a.outputTokens??null,a.totalTokens??null,a.cachedInputTokens??null,a.durationMs??null]);
   }
   await db.query('UPDATE kleo.workflow_runs SET status=$4,result_digest=$5,completed_at=now(),failure_code=$6 WHERE organization_id=$1 AND project_id=$2 AND id=$3',[s.organizationId,s.projectId,runId,status,hash,status==='failed'?'WORKFLOW_FAILED':status==='cancelled'?'CANCELLED':null]);
   await this.audit(db,s,runId,`workflow_${status}`);return this.summary(db,s,{id:runId,status});
  });
 }
 async getRun(scope:PersistenceScope,id:string):Promise<StoredRun>{const s=scopeCopy(scope);uuid(id);return this.transaction(async db=>{await this.authorize(db,s,false);return this.summary(db,s,await this.runRow(db,s,id));});}
 async listRuns(scope:PersistenceScope,limit=50):Promise<StoredRun[]>{const s=scopeCopy(scope);if(!Number.isInteger(limit)||limit<1||limit>100)invalid();return this.transaction(async db=>{await this.authorize(db,s,false);const rows=await db.query('SELECT id,status FROM kleo.workflow_runs WHERE organization_id=$1 AND project_id=$2 ORDER BY started_at DESC,id DESC LIMIT $3',[s.organizationId,s.projectId,limit]);return Promise.all(rows.rows.map(r=>this.summary(db,s,r)));});}
 async getVersion(scope:PersistenceScope,id:string):Promise<{id:string;websiteId:string;workflowRunId:string;versionNumber:number;document:unknown;qa:unknown|null}>{
  const s=scopeCopy(scope);uuid(id);return this.transaction(async db=>{await this.authorize(db,s,false);
   const result=await db.query(`SELECT v.id,v.website_id,v.workflow_run_id,v.version_number,v.document,q.document AS qa FROM kleo.website_versions v
    LEFT JOIN kleo.qa_reports q ON q.organization_id=v.organization_id AND q.project_id=v.project_id AND q.website_version_id=v.id
    WHERE v.organization_id=$1 AND v.project_id=$2 AND v.id=$3`,[s.organizationId,s.projectId,id]);
   const row=result.rows[0];if(!row)throw new PersistenceError('NOT_FOUND');return {id:row.id,websiteId:row.website_id,workflowRunId:row.workflow_run_id,versionNumber:row.version_number,document:row.document,qa:row.qa};
  });
 }
 async getRunDetails(scope:PersistenceScope,id:string){const s=scopeCopy(scope);uuid(id);return this.transaction(async db=>{
  await this.authorize(db,s,false);const row=await this.runRow(db,s,id);const params=[s.organizationId,s.projectId,id];
  const snapshots=await db.query('SELECT kind,document,created_at FROM kleo.domain_snapshots WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3',params);
  const executions=await db.query('SELECT id,agent_type,status,error_code,created_at FROM kleo.agent_executions WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3',params);
  const usage=await db.query('SELECT execution_id,attempt,provider,model,outcome,request_id,input_tokens,output_tokens,total_tokens,cached_input_tokens,duration_ms,recorded_at FROM kleo.ai_usage WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3 ORDER BY execution_id,attempt',params);
  const audit=await db.query('SELECT event_type,actor_id,created_at FROM kleo.audit_events WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3 ORDER BY created_at,event_type',params);
  return {run:await this.summary(db,s,row),snapshots:snapshots.rows,executions:executions.rows,usage:usage.rows,audit:audit.rows};
 });}
}
