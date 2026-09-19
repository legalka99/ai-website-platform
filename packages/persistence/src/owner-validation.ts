import { BRIEF_ADVANTAGES_MAX_ITEMS, BRIEF_ADVANTAGE_MAX_LENGTH, BRIEF_ADVANTAGES_MAX_TOTAL_LENGTH, briefFields, type BriefAdvantage, type BusinessBrief } from '../../core/src/business-brief.js';
import { containsSecret } from '../../security/src/redaction.js';
import { AuthError, authUuid } from './auth.js';
export function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)) || keys.some(k=>!Object.hasOwn(value,k))) throw new AuthError('INVALID_INPUT');
}
function text(value: unknown, max: number, required: boolean): string | null {
 if(value === null && !required)return null;
 if(typeof value!=='string'||value.length>max)throw new AuthError('INVALID_INPUT');
 const s=value.trim();if(!s){if(required)throw new AuthError('INVALID_INPUT');return null;}
 if(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)||/(?:javascript|data|file)\s*:/i.test(s)||containsSecret(s)||/https?:\/\/[^\s/]+:[^\s/]+@/i.test(s)||/(?:пароль|секрет|iban|card\s*number|номер\s*карты|расч[её]тный\s*сч[её]т)\s*[:=]\s*\S+/iu.test(s))throw new AuthError('INVALID_INPUT');return s;
}
function structuredAdvantages(value:unknown):BriefAdvantage[] {
 if(!Array.isArray(value)||value.length>BRIEF_ADVANTAGES_MAX_ITEMS||Object.getOwnPropertySymbols(value).length)throw new AuthError('INVALID_INPUT');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.keys(descriptors).length!==value.length+1)throw new AuthError('INVALID_INPUT');
 const out:BriefAdvantage[]=[];let total=0;const seen=new Set<string>();
 for(let index=0;index<value.length;index++){
  const itemDescriptor=descriptors[String(index)];if(!itemDescriptor?.enumerable||!('value' in itemDescriptor))throw new AuthError('INVALID_INPUT');
  const item=itemDescriptor.value;
  if(!item||typeof item!=='object'||Array.isArray(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item))||Reflect.ownKeys(item).length!==1)throw new AuthError('INVALID_INPUT');
  const textDescriptor=Object.getOwnPropertyDescriptor(item,'text');if(!textDescriptor?.enumerable||!('value' in textDescriptor))throw new AuthError('INVALID_INPUT');
  const parsed=text(textDescriptor.value,BRIEF_ADVANTAGE_MAX_LENGTH,true)!;total+=parsed.length;
  const identity=parsed.toLocaleLowerCase('ru-RU');if(seen.has(identity))throw new AuthError('INVALID_INPUT');seen.add(identity);
  out.push(Object.freeze({text:parsed}));
 }
 if(total>BRIEF_ADVANTAGES_MAX_TOTAL_LENGTH)throw new AuthError('INVALID_INPUT');
 return out;
}
function parseBriefValue(value:unknown,allowLegacy:boolean):BusinessBrief {
 exact(value,Object.keys(briefFields));const out={} as BusinessBrief;
 for(const key of Object.keys(briefFields) as (keyof typeof briefFields)[]){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value' in descriptor))throw new AuthError('INVALID_INPUT');
  if(key==='advantages'){
   const raw=descriptor.value;
   out.advantages=Array.isArray(raw)?structuredAdvantages(raw):allowLegacy?text(raw,briefFields.advantages.max,false):(()=>{throw new AuthError('INVALID_INPUT');})();
  }else (out as Record<string,unknown>)[key]=text(descriptor.value,briefFields[key].max,briefFields[key].required);
 }
 if(new TextEncoder().encode(JSON.stringify(out)).length>24576)throw new AuthError('INVALID_INPUT');return out;
}
export function parseNameRequest(value: unknown) {
 exact(value,['operationId','name']);authUuid(value.operationId);
 return {operationId:value.operationId,name:text(value.name,200,true)!};
}
export function parseBrief(value: unknown): BusinessBrief {
 return parseBriefValue(value,true);
}
/** New owner writes are always structured; legacy strings are read-only compatibility. */
export function parseBriefForWrite(value:unknown):BusinessBrief{return parseBriefValue(value,false);}
export function parseBriefRequest(value: unknown){
 exact(value,['operationId','organizationId','expectedVersion','brief']);authUuid(value.operationId);authUuid(value.organizationId);
 if(!Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<0||Number(value.expectedVersion)>1000000)throw new AuthError('INVALID_INPUT');
 return {operationId:value.operationId,organizationId:value.organizationId,expectedVersion:Number(value.expectedVersion),brief:parseBriefForWrite(value.brief)};
}
