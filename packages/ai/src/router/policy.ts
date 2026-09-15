import type { ProviderId, RouterPolicy, ProviderCapabilities } from './types.js';
import { AIProviderError } from '../providers/errors.js';
export function providerId(value:string):ProviderId {
  if(value!=='openai' && value!=='yandex') throw new AIProviderError('INVALID_CONFIG'); return value;
}
export function readRouterPolicy(env:Record<string,string|undefined>):RouterPolicy {
  const preferred=providerId(env.KLEO_AI_PRIMARY_PROVIDER?.trim() || 'openai');
  const fallback=env.KLEO_AI_FALLBACK_PROVIDER?.trim() ? providerId(env.KLEO_AI_FALLBACK_PROVIDER.trim()) : undefined;
  if(fallback===preferred) throw new AIProviderError('INVALID_CONFIG');
  return {id:'kleo-default',version:'1',maxAttempts:2,tasks:Object.fromEntries(['business','design','content','developer','qa'].map(task=>[task,{preferred,fallback,required:['structuredOutput']}]))};
}
/** Conservative enabled adapter features, not a ranking or a claim about every vendor model. */
export function textCapabilities(maxOutputTokens:number):ProviderCapabilities {
  return {structuredOutput:true,toolCalling:false,reasoning:false,code:false,russianLanguage:true,vision:false,maxOutputTokens};
}
