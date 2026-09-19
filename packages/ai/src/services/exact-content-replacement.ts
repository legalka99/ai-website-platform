import {Ajv} from 'ajv';
import type {ExactReplacement} from '../../../core/src/generation-intent.js';
import type {ContentPlan} from '../contracts/content-plan.js';
import type {ContentAgentInput} from '../contracts/content-agent-input.js';
import {validateExternal} from '../../../security/src/validation.js';
import {SecurityError} from '../../../security/src/errors.js';
import {plainJSON} from '../agents/design-schema.js';
import {validateContentInput} from '../agents/content-schema.js';
import {validateContentPlan} from '../validation/content-plan-validator.js';
import {validateContentGrounding} from '../validation/content-grounding-validator.js';
const id={type:'string',minLength:1,maxLength:200,pattern:'^[A-Za-z0-9_-]+$'};
const schema=new Ajv({strict:true}).compile({type:'object',additionalProperties:false,required:['operation','target','expectedText','replacementText'],properties:{operation:{const:'REPLACE_EXACT'},expectedText:{type:'string',maxLength:2000},replacementText:{type:'string',minLength:1,maxLength:2000},target:{type:'object',additionalProperties:false,required:['projectId','pageId','blockId','field'],properties:{projectId:id,pageId:id,blockId:id,field:{enum:['heading','text','points','callToAction']},pointIndex:{type:'integer',minimum:0,maximum:7}}}}});
/** Pure preflight foundation, not an API authorization endpoint or a persisted edit.
 * Caller resolves the owned target and authoritative facts server-side. No AI, no rewriting.
 */
export function replaceExactContent(plan:ContentPlan,authority:ContentAgentInput,owned:{projectId:string;pageId:string;blockId:string;sectionIndex:number},value:unknown):ContentPlan {
 const deny=():never=>{throw new SecurityError('INVALID_INPUT');};
 validateExternal(value,plainJSON,{maxBytes:6000,maxString:2000,maxArray:8,maxDepth:3,maxNodes:30});
 if(!schema(value)||!validateContentPlan(plan).valid)return deny();
 const command=value as ExactReplacement,t=command.target;
 if(t.projectId!==owned.projectId||t.pageId!==owned.pageId||t.blockId!==owned.blockId||!Number.isInteger(owned.sectionIndex)||owned.sectionIndex<0||owned.sectionIndex>=plan.sections.length)throw new SecurityError('ACCESS_DENIED');
 const copy=structuredClone(plan),section=copy.sections[owned.sectionIndex]!;
 if(t.field==='points'){
  if(t.pointIndex===undefined||section.points?.[t.pointIndex]!==command.expectedText)return deny();
  section.points[t.pointIndex]=command.replacementText;
 }else{
  if(t.pointIndex!==undefined||section[t.field]!==command.expectedText)return deny();section[t.field]=command.replacementText;
 }
 if(!validateContentPlan(copy).valid||validateContentGrounding(copy,validateContentInput(authority)))return deny();
 return copy;
}
