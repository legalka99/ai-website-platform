import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { hashPassword,verifyPassword,validPassword } from '../../security/src/password.js';
import { AuthorizationPolicy } from '../../security/src/authorization.js';
export class AuthError extends Error {
 constructor(readonly code:'INVALID_INPUT'|'INVALID_CREDENTIALS'|'UNAUTHENTICATED'|'FORBIDDEN'|'NOT_FOUND'|'CONFLICT'|'UNAVAILABLE'|'RATE_LIMITED'){super(code);}
}
export interface AuthActor {userId:string;platformRole:'user'|'platform_owner'|'platform_admin';email:string;sessionId:string}
export function normalizeEmail(value:unknown):string {
 if(typeof value!=='string'||value.length>254)throw new AuthError('INVALID_INPUT');const email=value.trim().toLowerCase();
 if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)||email.length>254||email.split('@')[0].length>64)throw new AuthError('INVALID_INPUT');return email;
}
export const sessionHash=(token:string)=>createHash('sha256').update('session:'+token).digest('hex');
export const csrfToken=(token:string)=>createHmac('sha256',token).update('kleo-csrf-v1').digest('base64url');
export function validCsrf(token:string,value:unknown):boolean {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))return false;return timingSafeEqual(Buffer.from(csrfToken(token)),Buffer.from(value));}
export function authUuid(value:unknown):asserts value is string {if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw new AuthError('INVALID_INPUT');}
export interface Page {limit:number;offset:number}
const dto=(row:Record<string,any>,fields:readonly string[])=>Object.fromEntries(fields.map(field=>[field,row[field]]));
/** Trusted server service; pool and auth rows never go to agents or response serialization. */
export class AuthRepository {
 private constructor(private pool:Pool,private dummyHash:string,readonly sessionSeconds:number){}
 static async create(pool:Pool,sessionSeconds=28800){if(!Number.isInteger(sessionSeconds)||sessionSeconds<300||sessionSeconds>604800)throw new AuthError('INVALID_INPUT');return new AuthRepository(pool,await hashPassword(randomBytes(32).toString('hex')),sessionSeconds);}
 async transaction<T>(work:(db:PoolClient)=>Promise<T>):Promise<T>{let db;
  try{db=await this.pool.connect();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='5s'");await db.query("SET LOCAL lock_timeout='3s'");const r=await work(db);await db.query('COMMIT');return r;}
  catch(e){if(db)await db.query('ROLLBACK').catch(()=>{});if(e instanceof AuthError)throw e;throw new AuthError('UNAVAILABLE');}finally{db?.release();}
 }
 async audit(db:PoolClient,requestId:string,event:string,actorId:string|null=null,resourceType:string|null=null,resourceId:string|null=null){authUuid(requestId);await db.query('INSERT INTO kleo.security_audit_events(request_id,event_type,actor_id,resource_type,resource_id) VALUES($1,$2,$3,$4,$5)',[requestId,event,actorId,resourceType,resourceId]);}
 /** Explicit offline operator action; no public registration or role-setting API. */
 async bootstrapOwner(emailValue:string,password:string):Promise<void>{const email=normalizeEmail(emailValue);if(!validPassword(password))throw new AuthError('INVALID_INPUT');const hash=await hashPassword(password);
  return this.transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(71442002)');if((await db.query("SELECT 1 FROM kleo.platform_roles WHERE role='platform_owner'")).rows.length)throw new AuthError('CONFLICT');
   if((await db.query('SELECT 1 FROM kleo.auth_accounts WHERE email=$1',[email])).rows.length)throw new AuthError('CONFLICT');
   const id=randomUUID();await db.query('INSERT INTO kleo.users(id) VALUES($1)',[id]);await db.query('INSERT INTO kleo.auth_accounts(user_id,email,password_hash) VALUES($1,$2,$3)',[id,email,hash]);await db.query("INSERT INTO kleo.platform_roles(user_id,role) VALUES($1,'platform_owner')",[id]);await this.audit(db,randomUUID(),'bootstrap_owner',id);
  });
 }
 async login(emailValue:string,password:string,requestId:string):Promise<{token:string;csrf:string}>{
  const email=normalizeEmail(emailValue);if(!validPassword(password))throw new AuthError('INVALID_INPUT');
  const account=await this.transaction(async db=>(await db.query('SELECT a.user_id,a.password_hash,u.status FROM kleo.auth_accounts a JOIN kleo.users u ON u.id=a.user_id WHERE a.email=$1',[email])).rows[0]);
  let correct=false;try{correct=await verifyPassword(account?.password_hash??this.dummyHash,password);}catch{throw new AuthError('UNAVAILABLE');}
  const token=randomBytes(32).toString('base64url');
  const success=await this.transaction(async db=>{
   if(!account||!correct||account.status!=='active'){await this.audit(db,requestId,'login_failure');return false;}
   const current=(await db.query('SELECT a.password_hash,u.status FROM kleo.auth_accounts a JOIN kleo.users u ON u.id=a.user_id WHERE u.id=$1 FOR UPDATE OF u FOR SHARE OF a',[account.user_id])).rows[0];
   if(!current||current.status!=='active'||current.password_hash!==account.password_hash){await this.audit(db,requestId,'login_failure');return false;}
   // Bounded active sessions; revoked history is retained for a future retention policy.
   await db.query('UPDATE kleo.auth_sessions SET revoked_at=now() WHERE id IN (SELECT id FROM kleo.auth_sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC,id DESC OFFSET 9)',[account.user_id]);
   await db.query("INSERT INTO kleo.auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+$3*interval '1 second')",[account.user_id,sessionHash(token),this.sessionSeconds]);await this.audit(db,requestId,'login_success',account.user_id);return true;
  });
  if(!success)throw new AuthError('INVALID_CREDENTIALS');return {token,csrf:csrfToken(token)};
 }
 async withSession<T>(token:unknown,requestId:string,work:(db:PoolClient,actor:AuthActor)=>Promise<T>):Promise<T>{
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AuthError('UNAUTHENTICATED');let actorId:string|null=null;
  try{return await this.transaction(async db=>{
   const row=(await db.query(`SELECT s.id AS session_id,u.id AS user_id,a.email,p.role FROM kleo.auth_sessions s JOIN kleo.users u ON u.id=s.user_id JOIN kleo.auth_accounts a ON a.user_id=u.id LEFT JOIN kleo.platform_roles p ON p.user_id=u.id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' FOR SHARE OF s,u`,[sessionHash(token)])).rows[0];
   if(!row)throw new AuthError('UNAUTHENTICATED');actorId=row.user_id;
   return work(db,{userId:row.user_id,email:row.email,platformRole:row.role??'user',sessionId:row.session_id});
  });}catch(e){if(e instanceof AuthError&&['FORBIDDEN','NOT_FOUND'].includes(e.code))await this.transaction(db=>this.audit(db,requestId,'access_denied',actorId));throw e;}
 }
 async logout(db:PoolClient,actor:AuthActor,requestId:string){await db.query('UPDATE kleo.auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2',[actor.sessionId,actor.userId]);await this.audit(db,requestId,'logout',actor.userId);}
 async organizations(db:PoolClient,actor:AuthActor,page:Page){const r=await db.query("SELECT o.id,o.name,o.status,m.role FROM kleo.organizations o JOIN kleo.memberships m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active' ORDER BY o.id LIMIT $2 OFFSET $3",[actor.userId,page.limit,page.offset]);return r.rows.map(row=>dto(row,['id','name','status','role']));}
 async project(db:PoolClient,actor:AuthActor,projectId:string){authUuid(projectId);
  const row=(await db.query(`SELECT p.id,p.organization_id,p.name,p.status,m.role FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id JOIN kleo.memberships m ON m.organization_id=o.id
   WHERE p.id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active' AND p.status='active' FOR SHARE OF p,o,m`,[projectId,actor.userId])).rows[0];
  if(!row)throw new AuthError('NOT_FOUND');
  const role=row.role==='member'?'editor':row.role;
  if(!new AuthorizationPolicy([{actorId:actor.userId,organizationId:row.organization_id,projectId,role}]).authorize({id:actor.userId,authenticated:true},'read',{organizationId:row.organization_id,projectId}))throw new AuthError('NOT_FOUND');
  return dto(row,['id','organization_id','name','status']);
 }
 async projects(db:PoolClient,actor:AuthActor,page:Page,organizationId?:string){if(organizationId)authUuid(organizationId);
  const r=await db.query(`SELECT p.id,p.organization_id,p.name,p.status FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id JOIN kleo.memberships m ON m.organization_id=o.id
   WHERE m.user_id=$1 AND m.status='active' AND o.status='active' AND p.status='active' AND ($2::uuid IS NULL OR p.organization_id=$2) ORDER BY p.id LIMIT $3 OFFSET $4`,[actor.userId,organizationId??null,page.limit,page.offset]);return r.rows.map(row=>dto(row,['id','organization_id','name','status']));
 }
 async createProject(db:PoolClient,actor:AuthActor,organizationId:string,name:string,requestId:string){authUuid(organizationId);
  const access=(await db.query("SELECT m.role FROM kleo.memberships m JOIN kleo.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND o.id=$2 AND m.status='active' AND o.status='active' FOR SHARE OF m,o",[actor.userId,organizationId])).rows[0];
  if(!access||!['owner','admin'].includes(access.role))throw new AuthError('FORBIDDEN');
  const id=randomUUID();await db.query('INSERT INTO kleo.projects(id,organization_id,name) VALUES($1,$2,$3)',[id,organizationId,name]);await this.audit(db,requestId,'project_created',actor.userId,'projects',id);return {id,organization_id:organizationId,name,status:'active'};
 }
 async resources(db:PoolClient,actor:AuthActor,projectId:string,kind:'workflows'|'websites'|'versions'|'qa'|'usage',page:Page,websiteId?:string,versionId?:string){const project=await this.project(db,actor,projectId),params:any[]=[project.organization_id,projectId,page.limit,page.offset];
  const specs={workflows:{sql:'SELECT id,status,started_at,completed_at,failure_code FROM kleo.workflow_runs WHERE organization_id=$1 AND project_id=$2 ORDER BY id LIMIT $3 OFFSET $4',fields:['id','status','started_at','completed_at','failure_code']},
   websites:{sql:'SELECT id,status,created_at FROM kleo.websites WHERE organization_id=$1 AND project_id=$2 ORDER BY id LIMIT $3 OFFSET $4',fields:['id','status','created_at']},
   versions:{sql:'SELECT id,website_id,workflow_run_id,version_number,status,created_at FROM kleo.website_versions WHERE organization_id=$1 AND project_id=$2 AND website_id=$5 ORDER BY version_number DESC LIMIT $3 OFFSET $4',fields:['id','website_id','workflow_run_id','version_number','status','created_at']},
   qa:{sql:'SELECT id,website_version_id,workflow_run_id,passed,score,created_at FROM kleo.qa_reports WHERE organization_id=$1 AND project_id=$2 AND website_version_id=$5 ORDER BY id LIMIT $3 OFFSET $4',fields:['id','website_version_id','workflow_run_id','passed','score','created_at']},
   usage:{sql:'SELECT id,workflow_run_id,execution_id,attempt,provider,model,outcome,input_tokens,output_tokens,total_tokens,cached_input_tokens,duration_ms,recorded_at FROM kleo.ai_usage WHERE organization_id=$1 AND project_id=$2 ORDER BY id LIMIT $3 OFFSET $4',fields:['id','workflow_run_id','execution_id','attempt','provider','model','outcome','input_tokens','output_tokens','total_tokens','cached_input_tokens','duration_ms','recorded_at']}};
  if(kind==='versions'){authUuid(websiteId);if(!(await db.query('SELECT 1 FROM kleo.websites WHERE organization_id=$1 AND project_id=$2 AND id=$3',[params[0],projectId,websiteId])).rows.length)throw new AuthError('NOT_FOUND');params.push(websiteId);}
  if(kind==='qa'){authUuid(versionId);if(!(await db.query('SELECT 1 FROM kleo.website_versions WHERE organization_id=$1 AND project_id=$2 AND id=$3',[params[0],projectId,versionId])).rows.length)throw new AuthError('NOT_FOUND');params.push(versionId);}
  const spec=specs[kind],r=await db.query(spec.sql,params);return r.rows.map(row=>dto(row,spec.fields));
 }
 async admin(db:PoolClient,actor:AuthActor,kind:'users'|'organizations'|'projects'|'workflows',page:Page,requestId:string){
  if(!['platform_owner','platform_admin'].includes(actor.platformRole))throw new AuthError('FORBIDDEN');
  const specs={users:{sql:'SELECT id,status,created_at FROM kleo.users ORDER BY id LIMIT $1 OFFSET $2',fields:['id','status','created_at']},organizations:{sql:'SELECT id,name,status,created_at FROM kleo.organizations ORDER BY id LIMIT $1 OFFSET $2',fields:['id','name','status','created_at']},projects:{sql:'SELECT id,organization_id,name,status FROM kleo.projects ORDER BY id LIMIT $1 OFFSET $2',fields:['id','organization_id','name','status']},workflows:{sql:'SELECT id,organization_id,project_id,status,started_at,completed_at,failure_code FROM kleo.workflow_runs ORDER BY id LIMIT $1 OFFSET $2',fields:['id','organization_id','project_id','status','started_at','completed_at','failure_code']}};
  const spec=specs[kind],r=await db.query(spec.sql,[page.limit,page.offset]);await this.audit(db,requestId,'platform_read',actor.userId,kind);return r.rows.map(row=>dto(row,spec.fields));
 }
}
