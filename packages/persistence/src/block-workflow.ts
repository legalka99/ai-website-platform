import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {AuthError,authUuid,type AuthActor,type AuthRepository} from './auth.js';
import {once} from './owner-writes.js';
import {parseBrief} from './owner-validation.js';
import {confirmedFactsFromBrief} from '../../core/src/confirmed-business-facts.js';
import {BLOCK_LIMITS,BLOCK_TYPES,type BlockRunView} from '../../core/src/block-generation.js';
import {containsSecret} from '../../security/src/redaction.js';
import {validateDeveloperOutput} from '../../ai/src/validation/developer-output-validator.js';
import {buildDeveloperWebsite} from '../../ai/src/services/developer-website-builder.js';
import {blockAuthority,blockAppendOrder,validateBlockPlan,type BlockTask,type BlockResult} from '../../ai/src/services/block-workflow.js';
import {validateQAReport} from '../../ai/src/validation/qa-report-validator.js';
import {STAGE_ERROR_CODES} from '../../ai/src/contracts/stage-error.js';
import type {WebsitePage,DesignSystem} from '../../website-model/src/index.js';
const baseDesign:DesignSystem={colors:{primary:'#334455',background:'#ffffff',text:'#111111'},typography:{headingFont:'Arial',bodyFont:'Arial',baseFontSize:16},spacing:{section:64,block:24},borderRadius:8};
export async function blockProject(db:PoolClient,actor:AuthActor,projectId:string,write=false){
 if(!['platform_owner','platform_admin'].includes(actor.platformRole??'')||write&&actor.platformRole!=='platform_owner')throw new AuthError('FORBIDDEN');
 authUuid(projectId);const p=(await db.query(`SELECT p.organization_id FROM kleo.projects p JOIN kleo.organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.status='active' AND o.status='active' ${write?'FOR UPDATE OF p':''}`,[projectId])).rows[0];
 if(!p)throw new AuthError('NOT_FOUND');return p;
}
export async function prepareBlockPages(db:PoolClient,actor:AuthActor,projectId:string,key:string){
 const p=await blockProject(db,actor,projectId,true);authUuid(key);
 return once(db,actor,key,['block-pages',projectId],async()=>{
  const existing=(await db.query('SELECT id FROM kleo.block_pages WHERE project_id=$1',[projectId])).rows;if(existing.length)return {created:false};
  const version=(await db.query('SELECT id,document FROM kleo.website_versions WHERE project_id=$1 AND organization_id=$2 ORDER BY version_number DESC,created_at DESC LIMIT 1',[projectId,p.organization_id])).rows[0];
  let pages:WebsitePage[],design:DesignSystem;
  if(version){if(!validateDeveloperOutput({website:version.document,generatedAt:version.document.updatedAt},projectId).valid)throw new AuthError('INVALID_INPUT');pages=version.document.pages;design=version.document.designSystem;}
  else{pages=[{id:randomUUID(),slug:'/',title:'Главная',status:'draft',order:0,blocks:[]}];design=baseDesign;}
  for(const page of pages)await db.query('INSERT INTO kleo.block_pages(id,organization_id,project_id,document,design_system,source_version_id) VALUES($1,$2,$3,$4,$5,$6)',[page.id,p.organization_id,projectId,JSON.stringify(page),JSON.stringify(design),version?.id??null]);
  return {created:true};
 });
}
export async function prepareBlockRun(db:PoolClient,actor:AuthActor,projectId:string,value:any,requestId:string,available:boolean){
 const p=await blockProject(db,actor,projectId,true);
 if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['pageId','blockId','instruction','blockType','idempotencyKey'].includes(k))||typeof value.pageId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(value.pageId)||typeof value.instruction!=='string'||!value.instruction.trim()||value.instruction.length>2000||containsSecret(value.instruction)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.instruction)||value.blockType!==undefined&&!BLOCK_TYPES.includes(value.blockType))throw new AuthError('INVALID_INPUT');
 authUuid(value.idempotencyKey);
 const page=(await db.query('SELECT id FROM kleo.block_pages WHERE organization_id=$1 AND project_id=$2 AND id=$3',[p.organization_id,projectId,value.pageId])).rows[0];if(!page)throw new AuthError('NOT_FOUND');
 if(value.blockId!==undefined){authUuid(value.blockId);if(!(await db.query('SELECT id FROM kleo.blocks WHERE organization_id=$1 AND project_id=$2 AND page_id=$3 AND id=$4',[p.organization_id,projectId,value.pageId,value.blockId])).rows.length)throw new AuthError('NOT_FOUND');throw new AuthError('UNAVAILABLE');}
 let created=false;
 const receipt=await once(db,actor,value.idempotencyKey,['block',projectId,value.pageId,value.instruction,value.blockType??null],async()=>{
  if(!available)throw new AuthError('UNAVAILABLE');
  if((await db.query("SELECT id FROM kleo.block_runs WHERE project_id=$1 AND status='running' UNION ALL SELECT id FROM kleo.workflow_runs WHERE project_id=$1 AND status='running'",[projectId])).rows.length)throw new AuthError('CONFLICT');
  const brief=(await db.query('SELECT id FROM kleo.project_briefs WHERE project_id=$1 AND organization_id=$2 ORDER BY version DESC LIMIT 1',[projectId,p.organization_id])).rows[0];
  const runId=randomUUID(),blockId=randomUUID();
  await db.query('INSERT INTO kleo.block_runs(id,organization_id,project_id,page_id,block_id,actor_id,request_id,instruction,block_type,source_brief_id,deadline_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+$11*interval \'1 millisecond\')',[runId,p.organization_id,projectId,page.id,blockId,actor.userId,requestId,value.instruction,value.blockType??null,brief?.id??null,BLOCK_LIMITS.timeoutMs]);
  await db.query("INSERT INTO kleo.block_audit(run_id,event) VALUES($1,'started')",[runId]);created=true;return {runId};
 });
 return {runId:receipt.runId as string,created,scope:{projectId,organizationId:p.organization_id as string,actorId:actor.userId}};
}
export type PreparedBlockRun=Awaited<ReturnType<typeof prepareBlockRun>>;
export async function readBlockTask(db:PoolClient,launch:PreparedBlockRun):Promise<BlockTask>{
 const s=launch.scope;const r=(await db.query('SELECT * FROM kleo.block_runs WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND actor_id=$4',[launch.runId,s.organizationId,s.projectId,s.actorId])).rows[0];if(!r||r.status!=='running'||Date.now()>r.deadline_at.getTime())throw new AuthError('CONFLICT');
 const p=(await db.query('SELECT document,design_system FROM kleo.block_pages WHERE organization_id=$1 AND project_id=$2 AND id=$3',[s.organizationId,s.projectId,r.page_id])).rows[0];if(!p)throw new AuthError('NOT_FOUND');
 const versions=(await db.query('SELECT DISTINCT ON (block_id) document FROM kleo.block_versions WHERE organization_id=$1 AND project_id=$2 AND page_id=$3 ORDER BY block_id,version DESC',[s.organizationId,s.projectId,r.page_id])).rows;
 const page:WebsitePage=structuredClone(p.document);page.blocks.push(...versions.map(v=>v.document));page.blocks.sort((a,b)=>a.order-b.order);
 const b=r.source_brief_id?(await db.query('SELECT document FROM kleo.project_briefs WHERE organization_id=$1 AND project_id=$2 AND id=$3',[s.organizationId,s.projectId,r.source_brief_id])).rows[0]:undefined;
 if(r.source_brief_id&&!b)throw new AuthError('NOT_FOUND');const brief=b?parseBrief(b.document):undefined;
 return {projectId:s.projectId,scope:{type:'block',pageId:r.page_id,blockId:r.block_id},page,designSystem:p.design_system,instruction:r.instruction,...(r.block_type?{blockType:r.block_type}:{}),facts:brief?confirmedFactsFromBrief(brief,r.source_brief_id):{facts:[]},desiredActions:brief?.desiredActions?[brief.desiredActions]:['Подробнее']};
}
const codes=new Set<string>([...STAGE_ERROR_CODES,'STAGE_FAILED','QA_FAILED']);
export async function finishBlockRun(db:PoolClient,launch:PreparedBlockRun,result:BlockResult){
 const s=launch.scope;
 const row=(await db.query('SELECT status,deadline_at FROM kleo.block_runs WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND actor_id=$4 FOR UPDATE',[launch.runId,s.organizationId,s.projectId,s.actorId])).rows[0];if(!row)throw new AuthError('NOT_FOUND');if(row.status!=='running')return;
 if(Date.now()>row.deadline_at.getTime())result={success:false,errorCode:'TIMEOUT'};
 if(result.success){
  const task=await readBlockTask(db,launch);
  if(!result.content||!result.block||!result.qa?.passed||!validateQAReport(result.qa).valid||!validateBlockPlan(result.content,task))throw new AuthError('INVALID_INPUT');
  const built=buildDeveloperWebsite({...blockAuthority(task),content:result.content},{sections:[{sectionIndex:0,alignment:'left'}]},s.projectId).website.pages[0]!.blocks[0]!;
  const expected={...built,id:task.scope.blockId!,order:blockAppendOrder(task.page)};
  if(JSON.stringify(expected)!==JSON.stringify(result.block)||result.qa.issues.some(i=>i.pageId&&i.pageId!==task.page.id||i.blockId&&i.blockId!==expected.id))throw new AuthError('INVALID_INPUT');
  await db.query('INSERT INTO kleo.blocks(id,organization_id,project_id,page_id) VALUES($1,$2,$3,$4)',[expected.id,s.organizationId,s.projectId,task.page.id]);
  await db.query('INSERT INTO kleo.block_versions(id,organization_id,project_id,page_id,block_id,run_id,version,document,qa) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8)',[randomUUID(),s.organizationId,s.projectId,task.page.id,expected.id,launch.runId,JSON.stringify(expected),JSON.stringify(result.qa)]);
 }
 const status=result.success?'completed':'failed',code=result.success?null:codes.has(result.errorCode??'')?result.errorCode:'STAGE_FAILED';
 await db.query('UPDATE kleo.block_runs SET status=$2,error_code=$3,completed_at=now() WHERE id=$1',[launch.runId,status,code]);await db.query('INSERT INTO kleo.block_audit(run_id,event) VALUES($1,$2)',[launch.runId,status]);
}
export async function blockView(db:PoolClient,auth:AuthRepository,actor:AuthActor,projectId:string,requestId:string,runId?:string){
 await blockProject(db,actor,projectId);if(runId)authUuid(runId);
 await auth.audit(db,requestId,'platform_read',actor.userId,'projects',projectId);
 const pages=(await db.query("SELECT id,document->>'title' AS title FROM kleo.block_pages WHERE project_id=$1 ORDER BY created_at,id",[projectId])).rows;
 const r=(await db.query('SELECT r.*,v.id AS version_id FROM kleo.block_runs r LEFT JOIN kleo.block_versions v ON v.run_id=r.id WHERE r.project_id=$1 AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.started_at DESC LIMIT 1',[projectId,runId??null])).rows[0];if(runId&&!r)throw new AuthError('NOT_FOUND');
 const run:BlockRunView|null=r?{id:r.id,pageId:r.page_id,blockId:r.block_id,status:r.status,stage:r.stage,errorCode:r.error_code,deadlineAt:r.deadline_at.toISOString(),versionId:r.version_id??null}:null;
 return {pages,run};
}
export async function blockVersions(db:PoolClient,actor:AuthActor,projectId:string,blockId?:string){
 await blockProject(db,actor,projectId);if(blockId){authUuid(blockId);if(!(await db.query('SELECT id FROM kleo.blocks WHERE project_id=$1 AND id=$2',[projectId,blockId])).rows.length)throw new AuthError('NOT_FOUND');}
 return (await db.query('SELECT id,page_id,block_id,run_id,version,document,qa,created_at FROM kleo.block_versions WHERE project_id=$1 AND ($2::uuid IS NULL OR block_id=$2) ORDER BY created_at,version',[projectId,blockId??null])).rows;
}
