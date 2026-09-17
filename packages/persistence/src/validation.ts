import { createHash } from 'node:crypto';
import { PersistenceError, type PersistenceScope } from './contracts.js';
import { containsSecret } from '../../security/src/redaction.js';
import { validateDesignInput } from '../../ai/src/agents/design-schema.js';
import { businessFields } from '../../ai/src/agents/business-schema.js';
import { validateWebsiteAgentOutput } from '../../ai/src/orchestrator/website-result-validator.js';
import { validateContentGrounding } from '../../ai/src/validation/content-grounding-validator.js';
import { validateDeveloperReuse } from '../../ai/src/validation/developer-output-validator.js';
import type { WebsiteWorkflowResult } from '../../ai/src/orchestrator/website-workflow-types.js';
export const stages=['business','design','content','developer','qa'] as const;
export const invalid=():never=>{throw new PersistenceError('INVALID_INPUT');};
export function uuid(v:unknown):asserts v is string {if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))invalid();}
export function scopeCopy(scope:PersistenceScope):PersistenceScope {const c=snapshot(scope) as PersistenceScope;uuid(c.actorId);uuid(c.organizationId);uuid(c.projectId);return {actorId:c.actorId,organizationId:c.organizationId,projectId:c.projectId};}
/** Shared references are copied; cycles/accessors/hidden fields are rejected without execution. */
export function snapshot(value:unknown):any {
 let nodes=0;const ancestors=new Set<object>();
 const walk=(v:any,depth:number):any=>{
  if(++nodes>12000||depth>16)invalid();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))invalid();return v;}
  if(typeof v==='string'){if(v.length>16000)invalid();return v;}
  if(!v||typeof v!=='object'||ancestors.has(v)||Object.getOwnPropertySymbols(v).length)invalid();
  if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))invalid();
  if(Array.isArray(v)&&v.length>100)invalid();ancestors.add(v);const out:any=Array.isArray(v)?[]:{};
  for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(v))){
   if(Array.isArray(v)&&k==='length')continue;
   if(!d.enumerable||!('value' in d)||['__proto__','constructor','prototype'].includes(k))invalid();
   // Optional undefined telemetry fields are absent in the persisted representation.
   if(d.value!==undefined)out[k]=walk(d.value,depth+1);
  }
  ancestors.delete(v);return out;
 };
 const copy=walk(value,0);if(Buffer.byteLength(JSON.stringify(copy))>250000)invalid();return copy;
}
export function safeLabel(v:unknown,max=200):string {if(typeof v!=='string'||!v.trim()||v.length>max||containsSecret(v)||/[\u0000-\u001f\u007f]/.test(v))invalid();return v as string;}
export function validateResult(value:WebsiteWorkflowResult,projectId:string):WebsiteWorkflowResult {
 const r=snapshot(value) as WebsiteWorkflowResult;
 if(typeof r.success!=='boolean'||!r.state||typeof r.state!=='object'||Array.isArray(r.state)||Object.keys(r.state).some(k=>!stages.includes(k as any)))invalid();
 let absent=false;
 for(const stage of stages){const output=r.state[stage];if(output===undefined){absent=true;continue;}if(absent||!validateWebsiteAgentOutput(stage,output,projectId).valid)invalid();
  if(containsSecret(JSON.stringify(output)))invalid();
 }
 const s=r.state;
 if(s.business){validateDesignInput(s.business);if(Object.keys(s.business).some(k=>!(businessFields as readonly string[]).includes(k)))invalid();}
 if(s.content&&validateContentGrounding(s.content,{business:s.business!,design:s.design!}))invalid();
 if(s.developer&&!validateDeveloperReuse(s.developer,{business:s.business!,design:s.design!,content:s.content!}))invalid();
 if(s.qa){for(const i of s.qa.issues){const p=s.developer!.website.pages.find(p=>p.id===i.pageId);if(i.pageId&&!p||i.blockId&&!p?.blocks.some(b=>b.id===i.blockId))invalid();}}
 if(r.success!==Boolean(s.qa?.passed))invalid();
 return r;
}
export function digest(value:unknown):string {
 const sort=(v:any):any=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}
export interface SafeAttempt {provider:'openai'|'yandex';model:string;outcome:'success'|'failure'|'unknown';requestId?:string;inputTokens?:number;outputTokens?:number;totalTokens?:number;cachedInputTokens?:number;durationMs?:number}
export function telemetry(execution:any,scope:PersistenceScope,runId:string,stage:string):SafeAttempt[] {
 if(!execution)return [];
 if(execution.projectId!==scope.projectId)invalid();
 const attempts=execution.routing?.attempts;
 if(attempts!==undefined&&(!Array.isArray(attempts)||attempts.length>2))invalid();
 const source=attempts?.length?attempts:execution.usage?[{provider:execution.usage.provider,model:execution.usage.model,outcome:'unknown',usage:execution.usage}]:[];
 return source.map((a:any)=>{
  if(!['openai','yandex'].includes(a.provider)||!['success','failure','unknown'].includes(a.outcome))invalid();
  const out:SafeAttempt={provider:a.provider,model:safeLabel(a.model),outcome:a.outcome};
  const u=a.usage;if(!u)return out;
  for(const [key,expected] of Object.entries({projectId:scope.projectId,organizationId:scope.organizationId,actorId:scope.actorId,workflowId:runId,agentType:stage}))if(u[key]!==undefined&&u[key]!==expected)invalid();
  if(u.provider!==a.provider||u.model!==a.model)invalid();
  for(const key of ['inputTokens','outputTokens','totalTokens','cachedInputTokens'] as const)if(u[key]!==undefined){if(!Number.isSafeInteger(u[key])||u[key]<0)invalid();out[key]=u[key];}
  if(u.durationMs!==undefined){if(typeof u.durationMs!=='number'||!Number.isFinite(u.durationMs)||u.durationMs<0)invalid();out.durationMs=u.durationMs;}
  if(u.requestId!==undefined){const id=safeLabel(u.requestId);if(!/^[A-Za-z0-9_-]+$/.test(id))invalid();out.requestId=id;}
  return out;
 });
}
