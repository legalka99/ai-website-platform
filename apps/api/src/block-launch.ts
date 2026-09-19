import {safeQAValidationError,type QAValidationError} from '../../../packages/ai/src/contracts/qa-validation-error.js';
import {safeContentValidationError,type ContentValidationError} from '../../../packages/ai/src/contracts/content-validation-error.js';
import type {Pool,PoolClient} from 'pg';
import {AICostGuard} from '../../../packages/security/src/rate-limit.js';
import {BLOCK_LIMITS} from '../../../packages/core/src/block-generation.js';
import {readBlockTask,finishBlockRun,type PreparedBlockRun} from '../../../packages/persistence/src/block-workflow.js';
import {telemetry} from '../../../packages/persistence/src/validation.js';
import {createBlockWorkflow,type BlockTask,type BlockResult} from '../../../packages/ai/src/services/block-workflow.js';
import {safeBlockRuntimeDiagnostic,type BlockRuntimeDiagnostic} from '../../../packages/ai/src/contracts/block-runtime-diagnostic.js';
import {configuredWorkflowOptionsFactory} from './workflow-launch.js';
import {safeUnderstandingDiagnostic,type UnderstandingDiagnostic} from '../../../packages/ai/src/contracts/understanding-diagnostic.js';
import {safeStageErrorCode} from '../../../packages/ai/src/contracts/stage-error.js';
export type BlockRunnerFactory=(launch:PreparedBlockRun,costs:AICostGuard)=>Promise<{run(task:BlockTask):Promise<BlockResult>}>;
export interface BlockQADiagnosticEvent {event:'block_qa_validation_failed';runId:string;diagnostic:QAValidationError}
export interface BlockContentDiagnosticEvent {event:'block_content_validation_failed';runId:string;diagnostic:ContentValidationError}
export interface ApiRuntimeIdentity {buildIdentifier:string;buildTimestamp:string;sourceArtifact:'.test-build/apps/api/src/index.js';processPid:number;configuredApiPort:number}
export type BlockRuntimeDiagnosticEvent={event:'block_runtime_diagnostic';runId:string}&ApiRuntimeIdentity&BlockRuntimeDiagnostic;
export type UnderstandingDiagnosticEvent={event:'input_interpretation_completed';runId:string}&UnderstandingDiagnostic;
const runIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function safeApiRuntimeIdentity(value:unknown):ApiRuntimeIdentity|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!['buildIdentifier','buildTimestamp','sourceArtifact','processPid','configuredApiPort'].includes(key)))return;
 const read=(key:string)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;};
 const buildIdentifier=read('buildIdentifier'),buildTimestamp=read('buildTimestamp'),sourceArtifact=read('sourceArtifact'),processPid=read('processPid'),configuredApiPort=read('configuredApiPort');
 const timestamp=typeof buildTimestamp==='string'?Date.parse(buildTimestamp):NaN;
 if(typeof buildIdentifier!=='string'||!/^[a-f0-9]{16}$/.test(buildIdentifier)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==buildTimestamp||sourceArtifact!=='.test-build/apps/api/src/index.js'||!Number.isInteger(processPid)||processPid<1||!Number.isInteger(configuredApiPort)||configuredApiPort<1||configuredApiPort>65535)return;
 return {buildIdentifier,buildTimestamp,sourceArtifact,processPid,configuredApiPort};
}
export function reportBlockRuntimeDiagnostic(value:unknown,runId:string,runtime:unknown,report?:(event:BlockRuntimeDiagnosticEvent)=>void){
 try{const diagnostic=safeBlockRuntimeDiagnostic(value),identity=safeApiRuntimeIdentity(runtime);if(!diagnostic||!identity||!runIdPattern.test(runId))return;report?.({event:'block_runtime_diagnostic',runId,...identity,...diagnostic});}catch{/* Runtime diagnostics must remain value-free and outcome-neutral. */}
}
export function reportUnderstandingDiagnostic(value:unknown,runId:string,report?:(event:UnderstandingDiagnosticEvent)=>void){
 try{const diagnostic=safeUnderstandingDiagnostic(value);if(!diagnostic||!runIdPattern.test(runId))return;report?.({event:'input_interpretation_completed',runId,...diagnostic});}catch{/* Understanding diagnostics are value-free and must not affect execution. */}
}
/** Internal, value-free logging boundary. Reporting must never affect execution. */
export function reportBlockQADiagnostic(result:BlockResult,runId:string,report?:(event:BlockQADiagnosticEvent)=>void){
 try{
  if(typeof runId!=='string'||!runIdPattern.test(runId))return;
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(result,key);return d&&'value' in d?d.value:undefined;};
  if(read('success')!==false||read('errorCode')!=='INVALID_RESPONSE')return;
  const diagnostic=safeQAValidationError(read('qaValidationError'));
  if(diagnostic)report?.({event:'block_qa_validation_failed',runId,diagnostic});
 }catch{/* No exception text or rejected values may reach the logger. */}
}
export function reportBlockContentDiagnostic(result:BlockResult,runId:string,report?:(event:BlockContentDiagnosticEvent)=>void){
 try{
  if(typeof runId!=='string'||!runIdPattern.test(runId))return;
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(result,key);return d&&'value' in d?d.value:undefined;};
  if(read('success')!==false||read('errorCode')!=='INVALID_RESPONSE')return;
  const diagnostic=safeContentValidationError(read('contentValidationError'));
  if(diagnostic)report?.({event:'block_content_validation_failed',runId,diagnostic});
 }catch{/* No exception text or rejected values may reach the logger. */}
}
export class BlockLaunchService {
 private readonly costs=new AICostGuard({...BLOCK_LIMITS,requestsPerMinute:20,maxConcurrent:1,maxRetries:0});
 constructor(private readonly pool:Pool,private readonly factory:BlockRunnerFactory,private readonly report?:(event:BlockQADiagnosticEvent|BlockContentDiagnosticEvent|BlockRuntimeDiagnosticEvent|UnderstandingDiagnosticEvent)=>void,private readonly runtime?:ApiRuntimeIdentity){}
 private async transaction<T>(work:(db:PoolClient)=>Promise<T>){const db=await this.pool.connect();try{await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='10s'");const r=await work(db);await db.query('COMMIT');return r;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 async execute(launch:PreparedBlockRun):Promise<BlockResult|undefined>{
  if(!launch.created)return;const signal=AbortSignal.timeout(BLOCK_LIMITS.timeoutMs);let result:BlockResult,runtimeDiagnostic:BlockRuntimeDiagnostic|undefined,understandingDiagnostic:UnderstandingDiagnostic|undefined;
  try{
   const task=await this.transaction(db=>readBlockTask(db,launch));
   const runner=await this.factory(launch,this.costs);
   result=await runner.run({...task,signal,onDiagnostic:value=>{runtimeDiagnostic=safeBlockRuntimeDiagnostic(value);},onUnderstandingDiagnostic:value=>{understandingDiagnostic=safeUnderstandingDiagnostic(value);},onStage:async(stage,phase,execution)=>{
    const usage=telemetry(execution,launch.scope,launch.runId,stage);
    await this.transaction(async db=>{
     const r=await db.query("UPDATE kleo.block_runs SET stage=$2 WHERE id=$1 AND organization_id=$3 AND project_id=$4 AND actor_id=$5 AND status='running' RETURNING id",[launch.runId,stage,launch.scope.organizationId,launch.scope.projectId,launch.scope.actorId]);if(!r.rows.length)throw Error('BLOCK_RUN_UNAVAILABLE');
     await db.query('INSERT INTO kleo.block_execution(run_id,stage,status,usage) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,stage) DO UPDATE SET status=EXCLUDED.status,usage=EXCLUDED.usage',[launch.runId,stage,phase,JSON.stringify(usage)]);
    });
   }});
  }catch(error){
   const descriptor=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined;
   const code=descriptor&&'value' in descriptor?safeStageErrorCode(descriptor.value):undefined;
   result={success:false,errorCode:code??'STAGE_FAILED'};
  }
  if(signal.aborted)result={success:false,errorCode:'TIMEOUT'};
  try{await this.transaction(db=>finishBlockRun(db,launch,result));}
  catch{await this.transaction(db=>finishBlockRun(db,launch,{success:false,errorCode:'STAGE_FAILED'}));}
  reportBlockContentDiagnostic(result,launch.runId,this.report);
  reportBlockQADiagnostic(result,launch.runId,this.report);
  if(this.runtime)reportBlockRuntimeDiagnostic(runtimeDiagnostic,launch.runId,this.runtime,this.report);
  reportUnderstandingDiagnostic(understandingDiagnostic,launch.runId,this.report);
  return result;
 }
}
export function configuredBlockFactory(env:Record<string,string|undefined>):BlockRunnerFactory|undefined{
 const factory=configuredWorkflowOptionsFactory(env);if(!factory)return;
 return async(launch,costs)=>createBlockWorkflow({
  context:{projectId:launch.scope.projectId,organizationId:launch.scope.organizationId,workflowId:launch.runId,actor:{id:launch.scope.actorId,authenticated:true}},
  resolve:async()=>{
   const options=await factory(launch.scope,launch.runId,costs);
   return {...options,providers:options.providers.map(p=>({...p,config:{...p.config,maxOutputTokens:Math.min(p.config.maxOutputTokens,BLOCK_LIMITS.maxOutputTokens),timeoutMs:Math.min(p.config.timeoutMs,45000)}} as typeof p))};
  },
 });
}
