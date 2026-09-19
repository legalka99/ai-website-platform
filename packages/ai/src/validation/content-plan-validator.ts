import { Ajv } from 'ajv';
import { validateExternal } from '../../../security/src/validation.js';
import { plainJSON } from '../agents/design-schema.js';
import { contentTextViolation } from './content-text-policy.js';
import { contentPlanSchema, CONTENT_LIMITS } from '../contracts/content-plan-schema.js';
import type { ContentPlan } from '../contracts/content-plan.js';
import type { ValidationResult } from '../orchestrator/validation.js';
const schema=new Ajv({strict:true}).compile(contentPlanSchema);
import type { ContentValidationError } from '../contracts/content-validation-error.js';
export type ContentValidationResult=ValidationResult & {validationError?:ContentValidationError};
const invalid=(message:string,stage:ContentValidationError['stage'],path:string,rule:string):ContentValidationResult=>({valid:false,issues:[{code:'INVALID_OUTPUT',field:path==='$'?'content':`content.${path}`,message}],validationError:{stage,path,rule}});
/** Same conservative prose security policy as Design; paragraph newlines are text, never markup. */
export function validateContentPlan(value:unknown):ContentValidationResult {
  try {validateExternal(value,plainJSON,CONTENT_LIMITS);}
  catch {return invalid('Content must match the bounded plain JSON section schema.','content-resource','$','RESOURCE_LIMIT_OR_NON_JSON');}
  if(!schema(value)) {
    const error=schema.errors![0];
    const parts=error.instancePath.split('/').slice(1);
    if(error.keyword==='required') parts.push(error.params.missingProperty);
    const path=parts.map((p,i)=>/^\d+$/.test(p)?`[${p}]`:`${i?'.':''}${p}`).join('')||'$';
    const rules:Record<string,string>={required:'SCHEMA_REQUIRED',additionalProperties:'SCHEMA_ADDITIONAL_PROPERTIES',type:'SCHEMA_TYPE',minLength:'SCHEMA_MIN_LENGTH',maxLength:'SCHEMA_MAX_LENGTH',pattern:'SCHEMA_PATTERN',minItems:'SCHEMA_MIN_ITEMS',maxItems:'SCHEMA_MAX_ITEMS',enum:'SCHEMA_ENUM'};
    return invalid('Content field violates its type, shape or length limit.','content-schema',path,rules[error.keyword]??'SCHEMA_INVALID');
  }
  function unsafePath(item:unknown,path:string):{path:string;rule:string}|undefined {
    if(typeof item==='string') {const rule=contentTextViolation(item,path==='toneOfVoice');return rule?{path,rule}:undefined;}
    if(Array.isArray(item)) {for(let i=0;i<item.length;i++){const found=unsafePath(item[i],`${path}[${i}]`);if(found)return found;}}
    else if(item&&typeof item==='object') for(const [key,child] of Object.entries(item)){const found=unsafePath(child,path?`${path}.${key}`:key);if(found)return found;}
    return undefined;
  }
  const unsafe=unsafePath(value,'');
  if(unsafe) return invalid('Content must be descriptive text without code, markup, addresses or credentials.','content-semantic',unsafe.path,unsafe.rule);
  const plan=value as unknown as ContentPlan;
  let actions=0,faqs=0;
  for(const [i,s] of plan.sections.entries()) {
    const path=`sections[${i}]`;
    if(s.type==='advantages'&&(s.points?.length??0)<3) return invalid('An advantages section requires at least three separate points.','content-semantic',`${path}.points`,'ADVANTAGES_POINTS_MIN');
    if(!s.heading&&!s.text&&!s.points?.length) return invalid('Each section needs copy.','content-semantic',path,'SECTION_COPY_REQUIRED');
    if(s.type==='cta'&&!s.callToAction) return invalid('A CTA section requires an action.','content-semantic',`${path}.callToAction`,'CTA_REQUIRED');
    if(s.callToAction&&++actions>4) return invalid('At most four section actions are allowed.','content-semantic',`${path}.callToAction`,'CTA_LIMIT');
    if(s.type==='faq'&&++faqs>1) return invalid('At most one FAQ section is allowed.','content-semantic',path,'FAQ_LIMIT');
    if(s.type==='faq'&&(s.points?.length??0)>6) return invalid('At most six FAQ points are allowed.','content-semantic',`${path}.points`,'FAQ_POINTS_LIMIT');
  }
  return {valid:true,issues:[]};
}
