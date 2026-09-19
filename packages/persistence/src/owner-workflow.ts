import { confirmedFactsFromBrief } from '../../core/src/confirmed-business-facts.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {AuthError,authUuid,type AuthActor,type AuthRepository} from './auth.js';
import {exact,parseBrief} from './owner-validation.js';
import {once} from './owner-writes.js';
import {WORKFLOW_LIMITS,type LaunchRunView} from '../../core/src/workflow-launch.js';
import type {PersistenceScope} from './contracts.js';
import {stages} from './validation.js';
/** Maps user data only; no generated outputs, industry inference or client-controlled goal. */
export function briefWorkflowInput(value:unknown):Record<string,unknown>{
 const b=parseBrief(value);const out:Record<string,unknown>={companyName:b.companyName,description:b.description};
 for(const k of ['productsOrServices','targetAudience','geography','websiteGoals','desiredActions'] as const)if(b[k])out[k]=[b[k]];
 if(Array.isArray(b.advantages)){if(b.advantages.length)out.advantages=b.advantages.map(item=>item.text);}
 else if(b.advantages)out.advantages=[b.advantages];
 const notes=[b.notes,b.contacts?`Public business contacts: ${b.contacts}`:null].filter(Boolean).join('\n');if(notes)out.notes=notes;
 if(JSON.stringify({goal:WORKFLOW_GOAL,business:out}).length>12000)throw new AuthError('INVALID_INPUT');return out;
}
export const WORKFLOW_GOAL='Create a draft website using only the supplied business facts. Review its quality. Do not publish.';
export async function prepareOwnerWorkflow(db:PoolClient,actor:AuthActor,projectId:string,value:unknown,requestId:string,available:boolean){
 if(actor.platformRole!=='platform_owner')throw new AuthError('FORBIDDEN');
 authUuid(projectId);exact(value,['briefVersionId','idempotencyKey']);authUuid(value.briefVersionId);authUuid(value.idempotencyKey);
 const target=(await db.query(`SELECT p.organization_id FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.status='active' AND o.status='active' FOR UPDATE OF p FOR SHARE OF o`,[projectId])).rows[0];
 if(!target)throw new AuthError('NOT_FOUND');
 const brief=(await db.query('SELECT document FROM kleo.project_briefs WHERE id=$1 AND project_id=$2 AND organization_id=$3',[value.briefVersionId,projectId,target.organization_id])).rows[0];
 if(!brief)throw new AuthError('NOT_FOUND');const input=briefWorkflowInput(brief.document);
 let created=false;
 const receipt=await once(db,actor,value.idempotencyKey,['workflow',projectId,value.briefVersionId],async()=>{
  if((await db.query("SELECT id FROM kleo.block_runs WHERE project_id=$1 AND status='running'",[projectId])).rows.length)throw new AuthError('CONFLICT');
  if(!available)throw new AuthError('UNAVAILABLE');
  if((await db.query("SELECT id FROM kleo.workflow_runs WHERE project_id=$1 AND status='running'",[projectId])).rows.length)throw new AuthError('CONFLICT');
  const id=randomUUID();
  await db.query(`INSERT INTO kleo.workflow_runs(id,organization_id,project_id,actor_id,invocation_id,source_brief_version_id,request_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+$8*interval '1 millisecond')`,[id,target.organization_id,projectId,actor.userId,value.idempotencyKey,value.briefVersionId,requestId,WORKFLOW_LIMITS.timeoutMs]);
  await db.query("INSERT INTO kleo.audit_events(organization_id,project_id,actor_id,workflow_run_id,event_type) VALUES($1,$2,$3,$4,'workflow_started')",[target.organization_id,projectId,actor.userId,id]);
  created=true;return {id};
 });
 const scope:PersistenceScope={actorId:actor.userId,organizationId:target.organization_id,projectId};
 return {runId:receipt.id as string,created,scope,input,confirmedBusinessFacts:confirmedFactsFromBrief(parseBrief(brief.document),value.briefVersionId as string)};
}
export async function ownerWorkflowView(auth:AuthRepository,db:PoolClient,actor:AuthActor,projectId:string,requestId:string,runId?:string):Promise<LaunchRunView|null>{
 if(!['platform_owner','platform_admin'].includes(actor.platformRole))throw new AuthError('FORBIDDEN');authUuid(projectId);if(runId)authUuid(runId);
 if(!(await db.query('SELECT id FROM kleo.projects WHERE id=$1',[projectId])).rows.length)throw new AuthError('NOT_FOUND');
 const row=(await db.query(`SELECT r.id,r.status,r.started_at,r.completed_at,r.deadline_at,r.failure_code,r.current_stage,r.source_brief_version_id,b.version,v.id AS version_id,v.website_id,q.id AS qa_id
 FROM kleo.workflow_runs r JOIN kleo.project_briefs b ON b.id=r.source_brief_version_id AND b.project_id=r.project_id AND b.organization_id=r.organization_id
 LEFT JOIN kleo.website_versions v ON v.workflow_run_id=r.id LEFT JOIN kleo.qa_reports q ON q.workflow_run_id=r.id
 WHERE r.project_id=$1 AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.started_at DESC,r.id DESC LIMIT 1`,[projectId,runId??null])).rows[0];
 if(runId&&!row)throw new AuthError('NOT_FOUND');
 await auth.audit(db,requestId,'platform_read',actor.userId,'projects',projectId);
 if(!row)return null;
 const executions=(await db.query('SELECT agent_type,status FROM kleo.agent_executions WHERE workflow_run_id=$1',[row.id])).rows;
 return {id:row.id,projectId,briefVersionId:row.source_brief_version_id,briefVersion:row.version,status:row.status,startedAt:row.started_at.toISOString(),completedAt:row.completed_at?.toISOString()??null,deadlineAt:row.deadline_at.toISOString(),failureCode:row.failure_code,
 stages:stages.map(stage=>({stage,status:executions.find(e=>e.agent_type===stage)?.status??(row.status==='running'&&row.current_stage===stage?'running':'waiting')})),versionId:row.version_id??null,websiteId:row.website_id??null,qaId:row.qa_id??null};
}
