import { Ajv } from 'ajv';
import { validateExternal } from '../../../security/src/validation.js';
import { SecurityError } from '../../../security/src/errors.js';
import { plainJSON } from './design-schema.js';
import { validateContentInput } from './content-schema.js';
import { validateContentPlan } from '../validation/content-plan-validator.js';
import { validateContentGrounding } from '../validation/content-grounding-validator.js';
import type { DeveloperAgentInput } from '../contracts/developer-agent-input.js';
import type { DeveloperValidationError } from '../contracts/developer-validation-error.js';

export interface DeveloperLayoutProposal { sections: {sectionIndex:number;alignment:'left'|'center'}[] }
export const DEVELOPER_PROPOSAL_LIMITS=Object.freeze({maxBytes:4000,maxString:100,maxArray:10,maxDepth:3,maxNodes:50});
export function developerLayoutSchema(sectionCount:number):Record<string,unknown> {
  if(!Number.isInteger(sectionCount)||sectionCount<1||sectionCount>10)throw new SecurityError('INVALID_INPUT');
  return {type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:sectionCount,maxItems:sectionCount,items:{
    type:'object',additionalProperties:false,required:['sectionIndex','alignment'],properties:{sectionIndex:{type:'integer',enum:Array.from({length:sectionCount},(_,i)=>i)},alignment:{type:'string',enum:['left','center']}}
  }}}};
}
export function validateDeveloperInput(value:unknown):DeveloperAgentInput {
  validateExternal(value,plainJSON,{maxBytes:52000,maxString:8000,maxArray:50,maxDepth:6,maxNodes:1000});
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['business','design','content','businessFacts'].includes(k))) throw new SecurityError('INVALID_INPUT');
  const input=value as DeveloperAgentInput;
  const authority=validateContentInput({business:input.business,design:input.design,...(input.businessFacts===undefined?{}:{businessFacts:input.businessFacts})});
  if(!validateContentPlan(input.content).valid||validateContentGrounding(input.content,authority)) throw new SecurityError('INVALID_INPUT');
  return structuredClone(input);
}
export function validateDeveloperProposal(value:unknown,count:number):DeveloperValidationError|undefined {
  try {validateExternal(value,plainJSON,DEVELOPER_PROPOSAL_LIMITS);} catch {return {stage:'developer-schema',path:'$',rule:'RESOURCE_LIMIT_OR_NON_JSON'};}
  if(!new Ajv({strict:true}).compile(developerLayoutSchema(count))(value)) return {stage:'developer-schema',path:'$',rule:'SCHEMA_INVALID'};
  const proposal=value as DeveloperLayoutProposal;
  for(const [i,s] of proposal.sections.entries()) if(s.sectionIndex!==i) return {stage:'developer-semantic',path:`sections[${i}].sectionIndex`,rule:'SECTION_ORDER'};
  return undefined;
}
