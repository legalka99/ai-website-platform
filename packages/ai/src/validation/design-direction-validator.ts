import { Ajv } from 'ajv';
import type { ErrorObject } from 'ajv';
import { designDirectionSchema, DESIGN_LIMITS } from '../contracts/design-direction-schema.js';
import { validateExternal } from '../../../security/src/validation.js';
import { containsSecret } from '../../../security/src/redaction.js';
import type { ValidationResult } from '../orchestrator/validation.js';

const validateSchema = new Ajv({strict:true,allErrors:true}).compile(designDirectionSchema);
// Deliberately narrow descriptive prose. No markup delimiters, encodings, paths, code operators or control characters.
// Typography-only additions: numero for variants, bullet for traits, ellipsis for pauses.
// Slash, ampersand, percent and semicolon remain excluded (paths, encodings, operators).
const prose = /^[\p{L}\p{M}\p{N}\p{Zs}.,!?:()'"«»“”‘’+–—№•…-]+$/u;
const address = /(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:https?|ftp|file|javascript|data):|\blocalhost\b|\b[A-Za-z][A-Za-z0-9+.-]*:[^\s]|(?:[0-9A-Fa-f]{0,4}:){2,}/iu;
const code = /\b(?:import|export|require|eval|exec|spawn|fetch|alert|console|document|window|function|const|let|var|print|curl|wget|sudo|bash|powershell|echo|rm|chmod|return|def|class|SELECT)\b|\b(?:select|delete)\s+.+?\bfrom\b|\b(?:drop|alter|create)\s+table\b|\b[A-Za-z_$][\w$]*\(|\b(?:color|background(?:-color)?|font(?:-family|-size|-weight)?|margin|padding|display|position|width|height|border|opacity)\s*:/i;
const credentials = /\b(?:password|passwd|secret|token|credential|authorization|api[ _-]?key|private[ _-]?key)\b|(?:пароль|токен|секрет|ключ\s+API)|\b(?=[a-zA-Z0-9_-]{24,}\b)(?=[a-zA-Z0-9_-]*[0-9])(?=[a-zA-Z0-9_-]*[a-zA-Z])[a-zA-Z0-9_-]+\b/iu;

/** Detection is conservative, not a proof that arbitrary prose cannot contain an undisclosed secret.
 * Always treat accepted strings as text, never executable content or a URL to fetch.
 */
export type TextViolation = 'UNSAFE_URL' | 'UNSAFE_HTML' | 'UNSAFE_CREDENTIAL' | 'UNSAFE_CODE' | 'UNSAFE_SHELL' | 'UNSAFE_CHARACTERS' | 'UNSAFE_EMPTY_TEXT';
/** Fixed detector identifiers only; never return a match or rejected value. */
export function designTextViolation(value:string):TextViolation|undefined {
  if(credentials.test(value)||containsSecret(value)) return 'UNSAFE_CREDENTIAL';
  if(/<\/?[a-z!][^>]*>/i.test(value)) return 'UNSAFE_HTML';
  if(address.test(value)) return 'UNSAFE_URL';
  if(code.test(value)) return /\b(?:curl|wget|sudo|bash|powershell|echo|rm|chmod)\b/i.test(value)?'UNSAFE_SHELL':'UNSAFE_CODE';
  if(!/[\p{L}\p{N}]/u.test(value)) return 'UNSAFE_EMPTY_TEXT';
  if(!prose.test(value)) return 'UNSAFE_CHARACTERS';
  return undefined;
}
export function isSafeDesignText(value:string):boolean {
  return designTextViolation(value)===undefined;
}
function schemaField(error:ErrorObject):string {
  // Only known schema paths are included; attacker-controlled additional property names are never echoed.
  const parts=error.instancePath.split('/').slice(1);
  if(error.keyword==='required') parts.push(error.params.missingProperty);
  return 'design'+parts.map(p=>/^\d+$/.test(p)?`[${p}]`:`.${p}`).join('');
}
function hasOnlyJSONProperties(value:unknown):boolean {
  if(!value || typeof value!=='object') return true;
  if(Object.getOwnPropertySymbols(value).length) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key,descriptor]) =>
    Array.isArray(value) && key==='length' || descriptor.enumerable===true && 'value' in descriptor && hasOnlyJSONProperties(descriptor.value));
}
type DesignValidationResult = Omit<ValidationResult,'issues'> & {issues:(ValidationResult['issues'][number] & {reason?:TextViolation})[]};
export function validateDesignDirection(output:unknown):DesignValidationResult {
  try { validateExternal(output,hasOnlyJSONProperties,DESIGN_LIMITS); }
  catch { return {valid:false,issues:[{code:'INVALID_OUTPUT',field:'design',message:'Design output exceeds resource limits or is not plain JSON data.'}]}; }
  if(!validateSchema(output)) return {valid:false,issues:(validateSchema.errors??[]).map(error=>({code:'INVALID_OUTPUT',field:schemaField(error),message:'Design field violates the required type, shape, length or color format.'}))};
  const issues:DesignValidationResult['issues']=[];
  function inspect(value:unknown,path:string):void {
    if(typeof value==='string') {
      const reason=designTextViolation(value);
      if(reason) issues.push({code:'UNSAFE_DESIGN_TEXT',field:path,reason,message:'Use descriptive text only, without code, addresses or credential-like data.'});
    } else if(Array.isArray(value)) value.forEach((item,i)=>inspect(item,`${path}[${i}]`));
    else if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) {
      if(path==='design' && key==='colors') continue; // Validated by the HEX-only schema.
      inspect(item,`${path}.${key}`);
    }
  }
  inspect(output,'design');
  return {valid:issues.length===0,issues};
}
