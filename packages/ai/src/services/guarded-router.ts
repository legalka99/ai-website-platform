import type { AgentType } from '../agent.js';
import { OpenAIProvider } from '../providers/openai-provider.js';
import { YandexProvider } from '../providers/yandex-provider.js';
import { readOpenAIConfig, type OpenAIProviderConfig } from '../providers/config.js';
import { readYandexConfig, type YandexProviderConfig } from '../providers/yandex-config.js';
import { AIProviderError } from '../providers/errors.js';
import { GuardedAIProvider, type AIServiceContext } from './guarded-provider.js';
import { AIRouter, type RouterBinding } from '../router/ai-router.js';
import type { ProviderCapabilities, RouterPolicy } from '../router/types.js';
import { textCapabilities } from '../router/policy.js';
import { ProviderHealthTracker } from '../router/health.js';
import type { AIProvider } from '../provider.js';
import type { SecretProvider, IntegrationCredentialRef } from '../../../security/src/secrets.js';
import type { AuthorizationPolicy } from '../../../security/src/authorization.js';
import type { AICostGuard } from '../../../security/src/rate-limit.js';
import { SecurityError } from '../../../security/src/errors.js';
export type RoutedProviderConfig = ({id:'openai';config:Omit<OpenAIProviderConfig,'apiKey'>}|{id:'yandex';config:Omit<YandexProviderConfig,'apiKey'>}) & {
  credentials:IntegrationCredentialRef; capabilities?:ProviderCapabilities; transport?:typeof fetch;
  /** Trusted server test injection, never request data. Still subject to secret scope, authorization and cost guard. */
  testAdapter?:AIProvider;
};
export interface RoutedServiceOptions {context:AIServiceContext;authorization:AuthorizationPolicy;costs:AICostGuard;secrets:SecretProvider;
  providers:readonly RoutedProviderConfig[];policy:RouterPolicy;health?:ProviderHealthTracker}
export async function createGuardedRouter(options:RoutedServiceOptions, taskType:AgentType):Promise<AIRouter> {
  // Snapshot server configuration across asynchronous secret lookups.
  const context=structuredClone(options.context), policy=structuredClone(options.policy);
  const configs=options.providers.map(p=>({...p,config:{...p.config},credentials:{...p.credentials},capabilities:p.capabilities?{...p.capabilities}:undefined})) as RoutedProviderConfig[];
  if(!options.authorization.authorize(context.actor,'generate',context)) throw new SecurityError('ACCESS_DENIED');
  for(const p of configs) if(!['openai','yandex'].includes(p.id) || p.credentials.provider!==p.id || p.credentials.projectId!==context.projectId || p.credentials.organizationId!==context.organizationId) throw new SecurityError('ACCESS_DENIED');
  const bindings:RouterBinding[]=[];
  for(const p of configs) {
    let key:string;
    try {key=await options.secrets.resolve(p.credentials);} catch {throw new AIProviderError('AUTH');}
    let model:string,adapter:AIProvider;
    if(p.id==='openai') {
      const config=readOpenAIConfig({OPENAI_API_KEY:key,KLEO_AI_MODEL:p.config.model,KLEO_AI_TIMEOUT_MS:String(p.config.timeoutMs),KLEO_AI_MAX_OUTPUT_TOKENS:String(p.config.maxOutputTokens)});
      model=config.model; adapter=p.testAdapter ?? new OpenAIProvider(config,p.transport);
    } else {
      const config=readYandexConfig({YANDEX_API_KEY:key,KLEO_YANDEX_FOLDER_ID:p.config.folderId,KLEO_YANDEX_MODEL:p.config.model,KLEO_YANDEX_TIMEOUT_MS:String(p.config.timeoutMs),KLEO_YANDEX_MAX_OUTPUT_TOKENS:String(p.config.maxOutputTokens)});
      model=config.model; adapter=p.testAdapter ?? new YandexProvider(config,p.transport);
    }
    const capabilities=p.capabilities ?? textCapabilities(p.config.maxOutputTokens);
    if(capabilities.maxOutputTokens>p.config.maxOutputTokens) throw new AIProviderError('INVALID_CONFIG');
    bindings.push({metadata:{id:p.id,model,capabilities},provider:new GuardedAIProvider(adapter,context,options.authorization,options.costs,capabilities.maxOutputTokens,taskType)});
  }
  return new AIRouter(bindings,policy,taskType,options.health);
}
