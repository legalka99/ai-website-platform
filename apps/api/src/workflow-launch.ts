import { safeContentValidationError, type ContentValidationError } from '../../../packages/ai/src/contracts/content-validation-error.js';
import { safeDesignDiagnostic, type DesignDiagnostic } from '../../../packages/ai/src/contracts/design-diagnostic.js';
import type {Pool} from 'pg';
import {PostgresPersistence} from '../../../packages/persistence/src/postgres.js';
import {runPersistedWorkflow} from '../../../packages/persistence/src/workflow.js';
import type {PersistenceScope,WorkflowRunner} from '../../../packages/persistence/src/contracts.js';
import {WORKFLOW_GOAL} from '../../../packages/persistence/src/owner-workflow.js';
import {WORKFLOW_LIMITS} from '../../../packages/core/src/workflow-launch.js';
import {AICostGuard} from '../../../packages/security/src/rate-limit.js';
import {OwnerGenerationPolicy} from '../../../packages/security/src/authorization.js';
import {LocalSecretProvider} from '../../../packages/security/src/secrets.js';
import {SecurityError} from '../../../packages/security/src/errors.js';
import {createWebsiteWorkflowService} from '../../../packages/ai/src/services/website-workflow-service.js';
import {createRoutedBusinessService} from '../../../packages/ai/src/services/routed-business-service.js';
import {readRouterPolicy} from '../../../packages/ai/src/router/policy.js';
import {readOpenAIConfig} from '../../../packages/ai/src/providers/config.js';
import {readYandexConfig} from '../../../packages/ai/src/providers/yandex-config.js';
import type {RoutedServiceOptions,RoutedProviderConfig} from '../../../packages/ai/src/services/guarded-router.js';
import type {prepareOwnerWorkflow} from '../../../packages/persistence/src/owner-workflow.js';
export interface DesignDiagnosticEvent {event:'design_validation_failed';runId:string;diagnostic:DesignDiagnostic}
export function reportDesignDiagnostic(result:import('../../../packages/ai/src/orchestrator/website-workflow-types.js').WebsiteWorkflowResult,runId:string,report?:(event:DesignDiagnosticEvent)=>void){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)||result.success!==false)return;
 if(result.stageError?.stage!=='design'||result.stageError.errorCode!=='INVALID_RESPONSE')return;
 const diagnostic=safeDesignDiagnostic(result.executions?.design?.designDiagnostic);
 if(diagnostic)try{report?.({event:'design_validation_failed',runId,diagnostic});}catch{/* Diagnostics must not change the workflow outcome. */}
}
export interface ContentDiagnosticEvent {event:'content_validation_failed';runId:string;diagnostic:ContentValidationError}
export function reportContentDiagnostic(result:import('../../../packages/ai/src/orchestrator/website-workflow-types.js').WebsiteWorkflowResult,runId:string,report?:(event:ContentDiagnosticEvent)=>void){
 try {
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId)||result.success!==false)return;
  const diagnostic=safeContentValidationError(result.validationError);
  if(diagnostic)report?.({event:'content_validation_failed',runId,diagnostic});
 }catch{/* Diagnostic projection/reporting cannot change the persisted workflow outcome. */}
}
export type PreparedLaunch=Awaited<ReturnType<typeof prepareOwnerWorkflow>>;
export type RunnerFactory=(scope:PersistenceScope,runId:string,costs:AICostGuard)=>Promise<WorkflowRunner>;
class LaunchCostGuard extends AICostGuard {
 readonly denied=new Set<string>();
 override reserve(projectId:string,workflowId:string,tokens:number){try{return super.reserve(projectId,workflowId,tokens);}catch(e){if(e instanceof SecurityError)this.denied.add(workflowId);throw e;}}
}
/** One service/cost guard per API process. execute is awaited by HTTP; no background promise/queue. */
export class WorkflowLaunchService {
 private readonly costs:LaunchCostGuard;
 private readonly timeoutMs:number;
 constructor(private readonly pool:Pool,private readonly factory:RunnerFactory,limits=WORKFLOW_LIMITS,private readonly report?:(event:DesignDiagnosticEvent|ContentDiagnosticEvent)=>void){
  this.timeoutMs=limits.timeoutMs;
  this.costs=new LaunchCostGuard({requestsPerMinute:20,maxConcurrent:2,maxRetries:0,maxOutputTokens:limits.maxOutputTokens,maxWorkflowOutputTokens:limits.maxWorkflowOutputTokens,maxRequestsPerWorkflow:limits.maxRequestsPerWorkflow});
 }
 async execute(launch:PreparedLaunch){
  if(!launch.created)return;
  const store=new PostgresPersistence(this.pool,{id:launch.runId,scope:launch.scope});
  const signal=AbortSignal.timeout(this.timeoutMs);
  try{const finished=await runPersistedWorkflow({
   startRun:s=>store.startRun(s),getRun:(s,id)=>store.getRun(s,id),
   finishRun:(s,id,result,opts)=>store.finishRun(s,id,result,{...opts,...(this.costs.denied.has(id)?{failureCode:'BUDGET_EXCEEDED' as const}:signal.aborted?{cancelled:false,failureCode:'TIMEOUT' as const}:{})}),
  },launch.scope,{goal:WORKFLOW_GOAL,input:launch.input,confirmedBusinessFacts:launch.confirmedBusinessFacts,signal,onStage:(stage,phase,execution)=>store.stage(launch.scope,launch.runId,stage,phase,execution)},id=>this.factory(launch.scope,id,this.costs));
   reportDesignDiagnostic(finished.result,launch.runId,this.report);
   reportContentDiagnostic(finished.result,launch.runId,this.report);return finished;
  }
  finally{this.costs.denied.delete(launch.runId);}
 }
}
/** Server-only composition. Disabled unless explicitly configured; never loads or edits .env. */
export function configuredWorkflowFactory(env:Record<string,string|undefined>):RunnerFactory|undefined {
 if(env.KLEO_WORKFLOW_ENABLED!=='1')return undefined;
 if(!['development','test'].includes(env.NODE_ENV??'development'))throw new Error('Workflow launch requires supported local secret storage');
 const policy=readRouterPolicy(env),route=policy.tasks.business!;
 const ids=[route.preferred,...(route.fallback?[route.fallback]:[])];
 const configs=ids.map(id=>({id,config:id==='openai'?readOpenAIConfig(env):readYandexConfig(env)}));
 return async(scope,runId,costs)=>{
  const context={projectId:scope.projectId,organizationId:scope.organizationId,workflowId:runId,actor:{id:scope.actorId,authenticated:true}};
  const entries=configs.map(({id,config})=>({...scope,provider:id,secretRef:`workflow/${runId}/${id}`,value:config.apiKey}));
  const providers=configs.map(({id,config},index)=>{const {apiKey,...safe}=config;return {id,config:{...safe,maxOutputTokens:Math.min(safe.maxOutputTokens,WORKFLOW_LIMITS.maxOutputTokens),timeoutMs:Math.min(safe.timeoutMs,60000)},credentials:{id:`workflow-${id}`,provider:id,projectId:scope.projectId,organizationId:scope.organizationId,secretRef:entries[index]!.secretRef}} as RoutedProviderConfig;});
  const options:RoutedServiceOptions={context,costs,policy,authorization:new OwnerGenerationPolicy(scope.actorId,scope),secrets:new LocalSecretProvider(entries,'development'),providers};
  return createWebsiteWorkflowService(options,{business:await createRoutedBusinessService(options)});
 };
}
