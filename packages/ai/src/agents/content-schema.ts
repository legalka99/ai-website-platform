import {validateCreativeContext} from '../services/generation-intent.js';
import { containsSecret } from '../../../security/src/redaction.js';
import { validateConfirmedBusinessFacts } from '../../../core/src/confirmed-business-facts.js';
import { isSafeContentText } from '../validation/content-text-policy.js';
import { contentPlanSchema, contentSectionSchema, CONTENT_LIMITS } from '../contracts/content-plan-schema.js';
import type { ContentAgentInput } from '../contracts/content-agent-input.js';
import { validateExternal } from '../../../security/src/validation.js';
import { SecurityError } from '../../../security/src/errors.js';
import { plainJSON, validateDesignInput } from './design-schema.js';
import { businessFields } from './business-schema.js';
import { validateDesignDirection } from '../validation/design-direction-validator.js';
import { validateWebsiteAgentOutput } from '../orchestrator/website-result-validator.js';
const nullable=(schema:object)=>({anyOf:[schema,{type:'null'}]});
const optionalSection=['heading','text','points','callToAction'] as const;
/** Detach reused sub-schemas; providers reject repeated references at their resource boundary. */
export const contentWireSchema:Record<string,unknown>=JSON.parse(JSON.stringify({
  ...contentPlanSchema,required:Object.keys(contentPlanSchema.properties),properties:{...contentPlanSchema.properties,
    notes:nullable(contentPlanSchema.properties.notes),sections:{...contentPlanSchema.properties.sections,items:{
      ...contentSectionSchema,required:Object.keys(contentSectionSchema.properties),properties:{...contentSectionSchema.properties,
        ...Object.fromEntries(optionalSection.map(key=>[key,nullable(contentSectionSchema.properties[key])]))},
    }},
  },
}));
export function validateContentInput(value:unknown):ContentAgentInput {
  validateExternal(value,plainJSON,{maxBytes:40000,maxString:8000,maxArray:50,maxDepth:6,maxNodes:1000});
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['business','design','businessFacts','confirmedBusinessFacts','creativeContext'].includes(k))) throw new SecurityError('INVALID_INPUT');
  const input=value as ContentAgentInput;
  if(input.businessFacts!==undefined && (!Array.isArray(input.businessFacts)||input.businessFacts.length===0||input.businessFacts.length>20||input.businessFacts.some(f=>typeof f!=='string'||!f.trim()||f.length>500||!isSafeContentText(f)))) throw new SecurityError('INVALID_INPUT');
  if(input.confirmedBusinessFacts!==undefined) {try{validateConfirmedBusinessFacts(input.confirmedBusinessFacts);if(containsSecret(JSON.stringify(input.confirmedBusinessFacts)))throw new SecurityError('INVALID_INPUT');}catch{throw new SecurityError('INVALID_INPUT');}}
  if(input.creativeContext!==undefined)validateCreativeContext(input.creativeContext);
  const business=validateDesignInput(input.business);
  if(Object.keys(business).some(k=>!(businessFields as readonly string[]).includes(k)) ||
    !validateWebsiteAgentOutput('business',business,'').valid || !validateDesignDirection(input.design).valid) throw new SecurityError('INVALID_INPUT');
  return structuredClone(input);
}
export function normalizeContentWire(value:unknown):unknown {
  validateExternal(value,plainJSON,CONTENT_LIMITS);
  const copy=structuredClone(value);
  if(copy&&typeof copy==='object'&&!Array.isArray(copy)) {
    const plan=copy as Record<string,unknown>;
    if(plan.notes===null) delete plan.notes;
    if(Array.isArray(plan.sections)) for(const section of plan.sections) {
      if(section&&typeof section==='object'&&!Array.isArray(section)) for(const key of optionalSection) if(section[key]===null) delete section[key];
    }
  }
  return copy;
}

/** Request-specific constraints mirror local per-section semantics. Aggregate quotas and
 * security heuristics still require local validation; they are not a promise from the provider. */
export function buildContentWireSchema(desiredActions:readonly string[]):Record<string,unknown> {
  const actions=[...new Set(desiredActions)].filter(s=>s.length<=160&&isSafeContentText(s));
  const action=actions.length?{...contentSectionSchema.properties.callToAction,enum:actions}:{type:'null'};
  const base={...contentSectionSchema,required:Object.keys(contentSectionSchema.properties),properties:{...contentSectionSchema.properties,
    ...Object.fromEntries(optionalSection.map(key=>[key,nullable(contentSectionSchema.properties[key])])),
    callToAction:actions.length?nullable(action):{type:'null'},
  }};
  const variants=[];
  for(const kind of ['regular','faq','cta','advantages']) {
    if(kind==='cta'&&!actions.length) continue;
    const properties={...base.properties,
      type:{type:'string',enum:kind==='regular'?contentSectionSchema.properties.type.enum.filter(t=>t!=='faq'&&t!=='cta'&&t!=='advantages'):[kind]},
      ...(kind==='cta'?{callToAction:action}:{}),
      ...(kind==='faq'?{points:nullable({...contentSectionSchema.properties.points,maxItems:6})}:{}),
    };
    if(kind==='advantages'){
      variants.push({...base,properties:{...properties,points:{...contentSectionSchema.properties.points,minItems:3,
        description:'3–8 separate advantages; prefer 3–6 concise points. Each item must express exactly one independent benefit or strength suitable for one UI card. Do not combine multiple benefits in one item or substitute a product list, assortment categories, geography, a city/region or a general company description. Factual claims require ConfirmedBusinessFacts; otherwise use neutral copy without new commercial promises.',
        items:{...contentSectionSchema.properties.points.items,description:'One standalone advantage only. Do not bundle benefits with commas, lists or "and". Preserve the confirmed subject, scope, conditions, negation and quantities when paraphrasing. Use neutral copy when support is uncertain; no substring evidence.'}}}});
      continue;
    }
    for(const copy of ['heading','text','points'] as const) variants.push({...base,properties:{...properties,
      [copy]:copy==='points'&&kind==='faq'?{...contentSectionSchema.properties.points,maxItems:6}:contentSectionSchema.properties[copy]}});
  }
  return JSON.parse(JSON.stringify({...contentPlanSchema,required:Object.keys(contentPlanSchema.properties),properties:{...contentPlanSchema.properties,
    notes:nullable(contentPlanSchema.properties.notes),sections:{...contentPlanSchema.properties.sections,items:{anyOf:variants}},
  }}));
}
