import type { AIProvider, AIRequest, AIResponse, AIUsageRecord } from '../provider.js';
import type { AgentType } from '../agent.js';
import { AIProviderError } from '../providers/errors.js';
import { GuardedAIProvider } from '../services/guarded-provider.js';
import { SecurityError } from '../../../security/src/errors.js';
import { ProviderHealthTracker } from './health.js';
import { providerId } from './policy.js';
import type { ProviderMetadata, RouterPolicy, RouteContext, ProviderDecision, ProviderAttempt, RoutingRecord, Capability, RoutingTaskType } from './types.js';
export interface RouterBinding { metadata:ProviderMetadata; provider:GuardedAIProvider }

/** Detached diagnostic snapshot: never copy extra provider fields or nested references.
 * Redaction still applies at the output boundary; accounting keeps the original record.
 */
function snapshotUsage(usage:AIUsageRecord|undefined):AIUsageRecord|undefined {
  if (!usage) return undefined;
  const snapshot:Partial<AIUsageRecord> = {};
  for (const field of ['provider','model','timestamp','projectId','workflowId','requestId','actorId','organizationId'] as const) {
    const descriptor=Object.getOwnPropertyDescriptor(usage,field);
    if (descriptor && 'value' in descriptor && typeof descriptor.value==='string') snapshot[field]=descriptor.value;
  }
  for (const field of ['durationMs','inputTokens','outputTokens','totalTokens','cachedInputTokens'] as const) {
    const descriptor=Object.getOwnPropertyDescriptor(usage,field);
    if (descriptor && 'value' in descriptor && typeof descriptor.value==='number' && Number.isFinite(descriptor.value)) snapshot[field]=descriptor.value;
  }
  const agent=Object.getOwnPropertyDescriptor(usage,'agentType');
  if (agent && 'value' in agent && ['business','design','content','developer','qa'].includes(agent.value)) snapshot.agentType=agent.value;
  return snapshot as AIUsageRecord;
}

export function permitsFallback(error:unknown):boolean {
  return error instanceof AIProviderError && (['TIMEOUT','NETWORK','RATE_LIMIT'].includes(error.code) || error.code==='API_ERROR' && error.diagnostic?.transient===true);
}
export class AIRoutingSecurityError extends SecurityError {
  constructor(error:SecurityError, readonly routing:RoutingRecord) {super(error.code);}
}
export class AIRoutingError extends AIProviderError {
  constructor(error:AIProviderError, readonly routing:RoutingRecord) {super(error.code,error.usage,error.diagnostic);}
}
/** Contains guarded endpoints only, no credentials, environment, URLs or tools. */
export class AIRouter implements AIProvider {
  #bindings:RouterBinding[]; #policy:RouterPolicy; #health:ProviderHealthTracker;
  constructor(bindings:readonly RouterBinding[], policy:RouterPolicy, private readonly taskType:RoutingTaskType='business', health=new ProviderHealthTracker()) {
    this.#health=health;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(policy.id) || !/^[a-zA-Z0-9_.-]{1,32}$/.test(policy.version) || ![1,2].includes(policy.maxAttempts) || !Object.hasOwn(policy.tasks,taskType)) throw new AIProviderError('INVALID_CONFIG');
    this.#bindings=bindings.map(b=>{
      providerId(b.metadata.id);
      if(!(b.provider instanceof GuardedAIProvider) || !b.metadata.model || b.metadata.model.length>256 || !Number.isInteger(b.metadata.capabilities.maxOutputTokens) || b.metadata.capabilities.maxOutputTokens<128 || b.metadata.capabilities.maxOutputTokens>8000) throw new AIProviderError('INVALID_CONFIG');
      return {provider:b.provider,metadata:{id:b.metadata.id,model:b.metadata.model,capabilities:{...b.metadata.capabilities}}};
    });
    if(new Set(this.#bindings.map(b=>b.metadata.id)).size!==bindings.length) throw new AIProviderError('INVALID_CONFIG');
    this.#policy=structuredClone(policy);
    for(const task of Object.values(this.#policy.tasks)) {
      providerId(task.preferred); if(task.fallback) providerId(task.fallback);
      if(task.preferred===task.fallback || !Array.isArray(task.required) || task.required.some(c=>!['structuredOutput','toolCalling','reasoning','code','russianLanguage','vision'].includes(c)) ||
        [task.preferred,task.fallback].filter(Boolean).some(id=>!this.#bindings.some(b=>b.metadata.id===id))) throw new AIProviderError('INVALID_CONFIG');
    }
  }
  #eligible(context:RouteContext):RouterBinding[] {
    const task=this.#policy.tasks[context.taskType]; if(!task) throw new AIProviderError('INVALID_CONFIG');
    if(context.maxOutputTokens!==undefined && (!Number.isInteger(context.maxOutputTokens)||context.maxOutputTokens<128)) throw new AIProviderError('INVALID_REQUEST');
    const ids=[task.preferred,task.fallback];
    return ids.flatMap(id=>this.#bindings.filter(b=>b.metadata.id===id && this.#health.status(b.metadata.id)!=='unavailable' &&
      task.required.every(c=>b.metadata.capabilities[c]===true) && (context.maxOutputTokens??128)<=b.metadata.capabilities.maxOutputTokens));
  }
  route(context:RouteContext):ProviderDecision {
    const eligible=this.#eligible(context);const first=eligible[0]; if(!first) throw new AIProviderError('ROUTE_UNAVAILABLE');
    return {provider:first.metadata.id,model:first.metadata.model,reason:first.metadata.id===this.#policy.tasks[context.taskType]!.preferred?'preferred':'eligible-alternative',
      fallbackProviders:eligible.slice(1,this.#policy.maxAttempts).map(b=>b.metadata.id),policyId:this.#policy.id,policyVersion:this.#policy.version};
  }
  async generate(request:AIRequest):Promise<AIResponse> {
    if(request.signal?.aborted) throw new AIProviderError('CANCELLED');
    const context={taskType:this.taskType,maxOutputTokens:request.maxTokens};
    const decision=this.route(context), attempts:ProviderAttempt[]=[];
    const eligible=[decision.provider,...decision.fallbackProviders].map(id=>this.#bindings.find(b=>b.metadata.id===id)!);
    for(const binding of eligible) {
      if(request.signal?.aborted) throw new AIRoutingError(new AIProviderError('CANCELLED'),{decision,attempts});
      try {
        const response=await binding.provider.generate({...request,model:binding.metadata.model});
        this.#health.success(binding.metadata.id);
        attempts.push({provider:binding.metadata.id,model:binding.metadata.model,outcome:'success',usage:snapshotUsage(response.usageRecord)});
        return {...response,routing:{decision,attempts}};
      } catch(error) {
        // Security/authorization/budget failures never become a fallback trigger.
        if(error instanceof SecurityError) throw new AIRoutingSecurityError(error,{decision,attempts});
        const safe=error instanceof AIProviderError ? error : new AIProviderError('API_ERROR');
        attempts.push({provider:binding.metadata.id,model:binding.metadata.model,outcome:'failure',errorCode:safe.code,usage:snapshotUsage(safe.usage)});
        if(permitsFallback(safe)) this.#health.transientFailure(binding.metadata.id);
        if(!permitsFallback(safe) || attempts.length===eligible.length) throw new AIRoutingError(safe,{decision,attempts});
      }
    }
    throw new AIProviderError('ROUTE_UNAVAILABLE');
  }
}
