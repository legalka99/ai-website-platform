import { Ajv } from 'ajv';
import { designDirectionSchema, designColorsSchema } from '../contracts/design-direction-schema.js';
import { validateExternal } from '../../../security/src/validation.js';
import type { DesignAgentInput } from '../contracts/design-agent-input.js';

const nullable = (schema:object) => ({anyOf:[schema,{type:'null'}]});
/** Strict provider representation: optional domain values are required and nullable on the wire.
 * JSON snapshot detaches reused schema objects for the provider resource validator. */
export const designWireSchema: Record<string,unknown> = JSON.parse(JSON.stringify({
  ...designDirectionSchema,
  required:Object.keys(designDirectionSchema.properties),
  properties:{...designDirectionSchema.properties,
    notes:nullable(designDirectionSchema.properties.notes),
    visualReferences:nullable(designDirectionSchema.properties.visualReferences),
    colors:{...designColorsSchema,required:Object.keys(designColorsSchema.properties),properties:{...designColorsSchema.properties,
      secondary:nullable(designColorsSchema.properties.secondary),accent:nullable(designColorsSchema.properties.accent)}},
  },
}));
const text = (maxLength=2000) => ({type:'string',minLength:1,maxLength,pattern:'\\S'});
const list = {type:'array',maxItems:50,items:text()};
const object = (properties:Record<string,unknown>,required=Object.keys(properties)) => ({type:'object',additionalProperties:false,properties,required});
const dimension = {type:'number',minimum:0,maximum:1000};
const inputSchema=object({
  companyName:text(200),industry:text(300),description:text(8000),
  productsOrServices:list,targetAudience:list,websiteGoals:list,desiredActions:list,
  geography:list,advantages:list,competitors:list,notes:text(),
  designPreferences:object({style:text(300),mood:{...list,maxItems:8},colors:{...designColorsSchema,required:[]},notes:text()},[]),
  existingDesignSystem:object({colors:designColorsSchema,
    typography:object({headingFont:text(300),bodyFont:text(300),baseFontSize:{type:'number',exclusiveMinimum:0,maximum:200}}),
    spacing:object({section:dimension,block:dimension}),borderRadius:dimension}),
},['companyName','industry','description','productsOrServices','targetAudience','websiteGoals','desiredActions']);
const inputValidator=new Ajv({strict:true}).compile(inputSchema);
/** Reject hidden properties too; nothing is silently stripped before validation. */
export function plainJSON(value:unknown):boolean {
  if(!value || typeof value!=='object') return true;
  if(Object.getOwnPropertySymbols(value).length) return false;
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key,d]) =>
    Array.isArray(value)&&key==='length' || d.enumerable===true && 'value' in d && plainJSON(d.value));
}
export function validateDesignInput(value:unknown):DesignAgentInput {
  return validateExternal<DesignAgentInput>(value,v=>plainJSON(v)&&inputValidator(v),
    {maxBytes:16000,maxString:8000,maxArray:50,maxDepth:4,maxNodes:500});
}
/** Only known nullable optional fields are removed; extra fields remain for domain rejection. */
export function normalizeDesignWire(value:unknown):unknown {
  validateExternal(value,plainJSON,{maxBytes:24000,maxString:2000,maxArray:12,maxDepth:4,maxNodes:150});
  const copy=structuredClone(value);
  if(copy && typeof copy==='object' && !Array.isArray(copy)) {
    const record=copy as Record<string,unknown>;
    for(const key of ['notes','visualReferences']) if(record[key]===null) delete record[key];
    if(record.colors && typeof record.colors==='object' && !Array.isArray(record.colors)) {
      const colors=record.colors as Record<string,unknown>;
      for(const key of ['secondary','accent']) if(colors[key]===null) delete colors[key];
    }
  }
  return copy;
}
