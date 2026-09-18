import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { BriefSnapshot, BriefView } from '../../core/src/business-brief.js';
import { AuthError, authUuid, type AuthActor, type AuthRepository } from './auth.js';
import { parseNameRequest, parseBriefRequest, parseBrief } from './owner-validation.js';
function owner(actor: AuthActor){if(actor.platformRole!=='platform_owner')throw new AuthError('FORBIDDEN');}
async function organization(db: PoolClient,id:string){authUuid(id);if(!(await db.query("SELECT id FROM kleo.organizations WHERE id=$1 AND status='active' FOR SHARE",[id])).rows.length)throw new AuthError('NOT_FOUND');}
async function project(db:PoolClient,id:string,organizationId?:string,lock=false){authUuid(id);if(organizationId)authUuid(organizationId);
 const row=(await db.query(`SELECT p.id,p.organization_id FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id WHERE p.id=$1 AND ($2::uuid IS NULL OR p.organization_id=$2) AND p.status='active' AND o.status='active' ${lock?'FOR UPDATE OF p':'FOR SHARE OF p'} FOR SHARE OF o`,[id,organizationId??null])).rows[0];
 if(!row)throw new AuthError('NOT_FOUND');return row;
}
async function audit(db:PoolClient,actor:AuthActor,requestId:string,event:string,organizationId:string,projectId:string|null,resourceId:string){
 await db.query('INSERT INTO kleo.security_audit_events(actor_id,request_id,event_type,resource_type,resource_id,organization_id,project_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.userId,requestId,event,projectId?'projects':'organizations',resourceId,organizationId,projectId]);
}
async function once(db:PoolClient,actor:AuthActor,key:string,payload:unknown,work:()=>Promise<Record<string,unknown>>){
 const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.userId+':'+key]);
 const previous=(await db.query('SELECT request_hash,result FROM kleo.owner_commands WHERE actor_id=$1 AND operation_id=$2',[actor.userId,key])).rows[0];
 if(previous){if(previous.request_hash!==hash)throw new AuthError('CONFLICT');return previous.result;}
 const result=await work();await db.query('INSERT INTO kleo.owner_commands(actor_id,operation_id,request_hash,result) VALUES($1,$2,$3,$4)',[actor.userId,key,hash,JSON.stringify(result)]);return result;
}
export async function createOrganization(db:PoolClient,actor:AuthActor,input:unknown,requestId:string){owner(actor);const data=parseNameRequest(input);
 return once(db,actor,data.operationId,['organization',data.name],async()=>{
  const id=randomUUID();const row=(await db.query('INSERT INTO kleo.organizations(id,name) VALUES($1,$2) RETURNING id,name,status,created_at',[id,data.name])).rows[0];
  await audit(db,actor,requestId,'organization_created',id,null,id);return {...row,created_at:row.created_at.toISOString()};
 });
}
export async function createOwnerProject(db:PoolClient,actor:AuthActor,organizationId:string,input:unknown,requestId:string){owner(actor);const data=parseNameRequest(input);await organization(db,organizationId);
 return once(db,actor,data.operationId,['project',organizationId,data.name],async()=>{
  const id=randomUUID(),row=(await db.query('INSERT INTO kleo.projects(id,organization_id,name) VALUES($1,$2,$3) RETURNING id,organization_id,name,status,created_at',[id,organizationId,data.name])).rows[0];
  await audit(db,actor,requestId,'project_created',organizationId,id,id);return {...row,created_at:row.created_at.toISOString()};
 });
}
export async function saveBusinessBrief(db:PoolClient,actor:AuthActor,projectId:string,input:unknown,requestId:string){owner(actor);const data=parseBriefRequest(input);await project(db,projectId,data.organizationId,true);
 return once(db,actor,data.operationId,['brief',projectId,data.organizationId,data.expectedVersion,data.brief],async()=>{
  const current=Number((await db.query('SELECT coalesce(max(version),0) AS version FROM kleo.project_briefs WHERE project_id=$1',[projectId])).rows[0].version);
  if(current!==data.expectedVersion)throw new AuthError('CONFLICT');
  const id=randomUUID(),version=current+1;await db.query('INSERT INTO kleo.project_briefs(id,organization_id,project_id,version,actor_id,document) VALUES($1,$2,$3,$4,$5,$6)',[id,data.organizationId,projectId,version,actor.userId,JSON.stringify(data.brief)]);
  await audit(db,actor,requestId,'brief_saved',data.organizationId,projectId,projectId);return {id,projectId,organizationId:data.organizationId,version};
 });
}
export async function getBusinessBrief(auth:AuthRepository,db:PoolClient,actor:AuthActor,projectId:string,requestId:string):Promise<BriefView>{
 if(!['platform_owner','platform_admin'].includes(actor.platformRole))throw new AuthError('FORBIDDEN');const target=await project(db,projectId);
 const row=(await db.query('SELECT id,organization_id,project_id,version,document,created_at FROM kleo.project_briefs WHERE organization_id=$1 AND project_id=$2 ORDER BY version DESC LIMIT 1',[target.organization_id,projectId])).rows[0];
 await auth.audit(db,requestId,'platform_read',actor.userId,'projects',projectId);
 const snapshot:BriefSnapshot|null=row?{id:row.id,organizationId:row.organization_id,projectId:row.project_id,version:row.version,createdAt:row.created_at.toISOString(),brief:parseBrief(row.document)}:null;
 return {snapshot};
}
