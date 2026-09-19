import {BLOCK_TYPES,type BlockType} from '../../../core/src/block-generation.js';
import {CLARIFICATION_CODES,type ClarificationCode} from '../../../core/src/understanding.js';
import type {GenerationOperation} from '../../../core/src/generation-intent.js';
import type {ProviderId} from '../router/types.js';
export interface UnderstandingDiagnostic {
 source:'block_instruction';outcome:'understood'|'needs_clarification'|'rejected';operation:GenerationOperation;targetType:BlockType|null;
 correctionCount:number;assertionCount:number;confidenceBucket:'high'|'medium'|'low';ambiguityCodes:ClarificationCode[];
 provider:'deterministic'|ProviderId;fallbackActivated:boolean;interpreterVersion:1;
}
const operations=['GENERATE','REWRITE','REPLACE_EXACT','EDIT','DELETE','ADD','MOVE'];
const read=(value:object,key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value' in d?d.value:undefined;};
export function safeUnderstandingDiagnostic(value:unknown):UnderstandingDiagnostic|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>typeof key!=='string'||!['source','outcome','operation','targetType','correctionCount','assertionCount','confidenceBucket','ambiguityCodes','provider','fallbackActivated','interpreterVersion'].includes(key)))return;
 const source=read(value,'source'),outcome=read(value,'outcome'),operation=read(value,'operation'),targetType=read(value,'targetType'),correctionCount=read(value,'correctionCount'),assertionCount=read(value,'assertionCount'),confidenceBucket=read(value,'confidenceBucket'),ambiguityCodes=read(value,'ambiguityCodes'),provider=read(value,'provider'),fallbackActivated=read(value,'fallbackActivated'),interpreterVersion=read(value,'interpreterVersion');
 if(source!=='block_instruction'||!['understood','needs_clarification','rejected'].includes(outcome)||!operations.includes(operation)||!(targetType===null||(BLOCK_TYPES as readonly unknown[]).includes(targetType))||
  !Number.isInteger(correctionCount)||correctionCount<0||correctionCount>32||!Number.isInteger(assertionCount)||assertionCount<0||assertionCount>16||!['high','medium','low'].includes(confidenceBucket)||
  !Array.isArray(ambiguityCodes)||ambiguityCodes.length>5||ambiguityCodes.some((code,index)=>!CLARIFICATION_CODES.includes(code)||ambiguityCodes.indexOf(code)!==index)||!['deterministic','openai','yandex'].includes(provider)||typeof fallbackActivated!=='boolean'||interpreterVersion!==1)return;
 return {source,outcome,operation,targetType,correctionCount,assertionCount,confidenceBucket,ambiguityCodes:[...ambiguityCodes],provider,fallbackActivated,interpreterVersion};
}
