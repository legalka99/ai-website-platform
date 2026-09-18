import { briefFields, type BusinessBrief } from '../../core/src/business-brief.js';
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
export function parseNameRequest(value: unknown) {
 exact(value,['operationId','name']);authUuid(value.operationId);
 return {operationId:value.operationId,name:text(value.name,200,true)!};
}
export function parseBrief(value: unknown): BusinessBrief {
 exact(value,Object.keys(briefFields));const out={} as BusinessBrief;
 for(const key of Object.keys(briefFields) as (keyof BusinessBrief)[])out[key]=text(value[key],briefFields[key].max,briefFields[key].required);
 if(new TextEncoder().encode(JSON.stringify(out)).length>24576)throw new AuthError('INVALID_INPUT');return out;
}
export function parseBriefRequest(value: unknown){
 exact(value,['operationId','organizationId','expectedVersion','brief']);authUuid(value.operationId);authUuid(value.organizationId);
 if(!Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<0||Number(value.expectedVersion)>1000000)throw new AuthError('INVALID_INPUT');
 return {operationId:value.operationId,organizationId:value.organizationId,expectedVersion:Number(value.expectedVersion),brief:parseBrief(value.brief)};
}
