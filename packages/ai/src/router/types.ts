import type { AgentType } from '../agent.js';
export type RoutingTaskType=AgentType|'understanding';
import type { AIUsageRecord } from '../provider.js';
export type ProviderId = 'openai' | 'yandex'; // Extend here when an adapter is implemented.
export type Capability = 'structuredOutput' | 'toolCalling' | 'reasoning' | 'code' | 'russianLanguage' | 'vision';
export type ProviderCapabilities = Record<Capability, boolean> & {maxOutputTokens:number};
export interface ProviderMetadata { id:ProviderId; model:string; capabilities:ProviderCapabilities }
export interface TaskPolicy { preferred:ProviderId; fallback?:ProviderId; required:readonly Capability[] }
export interface RouterPolicy { id:string; version:string; maxAttempts:1|2; tasks:Partial<Record<RoutingTaskType,TaskPolicy>> }
export interface RouteContext { taskType:RoutingTaskType; maxOutputTokens?:number }
export interface ProviderDecision { provider:ProviderId; model:string; reason:'preferred'|'eligible-alternative'; fallbackProviders:ProviderId[]; policyId:string; policyVersion:string }
export interface ProviderAttempt { provider:ProviderId; model:string; outcome:'success'|'failure'; errorCode?:string; usage?:AIUsageRecord }
export interface RoutingRecord { decision:ProviderDecision; attempts:ProviderAttempt[] }
export interface ProviderEvaluation { provider:ProviderId; model:string; taskType:RoutingTaskType; validOutput:boolean; durationMs:number; tokens?:number; score?:number }
