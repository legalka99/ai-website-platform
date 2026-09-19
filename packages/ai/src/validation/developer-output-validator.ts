import {PUBLIC_SECTION_FIELDS} from '../contracts/content-publication.js';
import { Ajv } from 'ajv';
import { validateExternal } from '../../../security/src/validation.js';
import { plainJSON } from '../agents/design-schema.js';
import { designColorsSchema } from '../contracts/design-direction-schema.js';
import { isSafeContentText } from './content-text-policy.js';
import type { ValidationResult } from '../orchestrator/validation.js';
import type { DeveloperOutput } from '../contracts/developer-output.js';
import type { DeveloperAgentInput } from '../contracts/developer-agent-input.js';
import { developerBlockType } from '../services/developer-website-builder.js';

const text=(maxLength:number)=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id={type:'string',minLength:1,maxLength:200,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*(?![\\s\\S])'};
const integer=(maximum:number)=>({type:'integer',minimum:0,maximum});
const timestamp={type:'string',maxLength:24,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const block=object({id,type:{type:'string',enum:['hero','text','services','advantages','faq','cta']},order:integer(Number.MAX_SAFE_INTEGER),visible:{type:'boolean'},
  content:object({heading:text(200),text:text(2000),points:{type:'array',minItems:1,maxItems:8,items:text(400)},callToAction:text(160)},[]),
  settings:object({alignment:{type:'string',enum:['left','center']}},['alignment'])},['id','type','order','visible','content']);
const page=object({id,slug:{type:'string',minLength:1,maxLength:100,pattern:'^/(?:[a-z0-9]+(?:-[a-z0-9]+)*)?(?![\\s\\S])'},title:text(200),status:{const:'draft'},order:integer(9),
  blocks:{type:'array',minItems:1,maxItems:10,items:block},seo:object({title:text(200),description:text(2000),keywords:{type:'array',minItems:1,maxItems:8,items:text(100)}},[])},['id','slug','title','status','order','blocks']);
export const developerOutputSchema=object({website:object({id,projectId:id,name:text(200),status:{const:'draft'},
  designSystem:object({colors:designColorsSchema,typography:object({headingFont:{enum:['Arial','Georgia']},bodyFont:{enum:['Arial','Georgia']},baseFontSize:{type:'number',minimum:12,maximum:32}}),
    spacing:object({section:integer(200),block:integer(100)}),borderRadius:integer(48)}),
  pages:{type:'array',minItems:1,maxItems:10,items:page},createdAt:timestamp,updatedAt:timestamp}),generatedAt:timestamp,notes:text(1000)},['website','generatedAt']);
const schema=new Ajv({strict:true,allErrors:true}).compile(developerOutputSchema);
export const DEVELOPER_WEBSITE_LIMITS=Object.freeze({maxBytes:64000,maxString:2000,maxArray:10,maxDepth:8,maxNodes:1000});
/** Strict current Developer subset of canonical Website. Generic public TS types stay compatible. */
export function validateDeveloperOutput(value:unknown,projectId:string):ValidationResult {
  const issues:ValidationResult['issues']=[];
  const fail=(field:string,code='INVALID_OUTPUT')=>issues.push({field:`developer.${field}`,code,message:'Developer output violates the safe Website contract.'});
  try {validateExternal(value,plainJSON,DEVELOPER_WEBSITE_LIMITS);} catch {
    // Retain useful diagnostics for invalid numeric design tokens, without
    // reading accessors or traversing arbitrary provider-owned property names.
    for(const path of ['website.designSystem.typography.baseFontSize','website.designSystem.spacing.section','website.designSystem.spacing.block','website.designSystem.borderRadius']) {
      let item:unknown=value;
      for(const key of path.split('.')) {const d=item&&typeof item==='object'?Object.getOwnPropertyDescriptor(item,key):undefined;item=d&&'value' in d?d.value:undefined;}
      if(typeof item==='number'&&!Number.isFinite(item))fail(path);
    }
    if(!issues.length)fail('website');return {valid:false,issues};
  }
  if(!schema(value)) {
    for(const e of schema.errors??[]) {
      const parts=e.instancePath.split('/').slice(1);if(e.keyword==='required')parts.push(e.params.missingProperty);
      fail(parts.map((p,i)=>/^\d+$/.test(p)?`[${p}]`:`${i?'.':''}${p}`).join('')||'website');
    }
    return {valid:false,issues};
  }
  const output=value as unknown as DeveloperOutput,w=output.website;
  if(w.projectId!==projectId)fail('website.projectId','PROJECT_MISMATCH');
  for(const [path,s] of [['generatedAt',output.generatedAt],['website.createdAt',w.createdAt],['website.updatedAt',w.updatedAt]]) {
    if(!Number.isFinite(Date.parse(s!))||new Date(s!).toISOString()!==s)fail(path!);
  }
  const safe=(s:string,path:string)=>{if(!isSafeContentText(s))fail(path,'UNSAFE_DEVELOPER_TEXT');};
  safe(w.name,'website.name');if(output.notes)safe(output.notes,'notes');
  const ids=new Set([w.id]),slugs=new Set<string>(),pageOrders=new Set<number>();
  const unique=<T>(set:Set<T>,key:T,path:string)=>{if(set.has(key))fail(path,'DUPLICATE_VALUE');set.add(key);};
  w.pages.forEach((p,i)=>{
    const path=`website.pages[${i}]`;unique(ids,p.id,`${path}.id`);unique(slugs,p.slug,`${path}.slug`);unique(pageOrders,p.order,`${path}.order`);safe(p.title,`${path}.title`);
    if(p.seo)for(const [key,v] of Object.entries(p.seo)){if(Array.isArray(v))v.forEach((s,j)=>safe(s,`${path}.seo.${key}[${j}]`));else if(typeof v==='string')safe(v,`${path}.seo.${key}`);}
    const orders=new Set<number>();
    p.blocks.forEach((b,j)=>{
      const bp=`${path}.blocks[${j}]`;unique(ids,b.id,`${bp}.id`);unique(orders,b.order,`${bp}.order`);
      if(!b.content.heading&&!b.content.text&&!b.content.points)fail(`${bp}.content`);
      if(b.type==='cta'&&!b.content.callToAction)fail(`${bp}.content.callToAction`);
      for(const [key,v] of Object.entries(b.content)){if(Array.isArray(v))v.forEach((s,k)=>safe(s,`${bp}.content.${key}[${k}]`));else safe(v as string,`${bp}.content.${key}`);}
    });
  });
  return {valid:issues.length===0,issues};
}
/** After runtime validation: every website copy field must reuse approved input.
 * Subset reuse supports existing trusted draft builders; new builder emits all sections. */
export function validateDeveloperReuse(output:DeveloperOutput,input:DeveloperAgentInput):boolean {
  const w=output.website,c=input.content;
  if(![c.pageTitle,input.business.companyName].includes(w.name)||output.notes!==undefined||w.pages.length!==1)return false;
  const p=w.pages[0]!;
  if(p.title!==c.pageTitle||p.slug!=='/'||p.blocks.length>c.sections.length)return false;
  if(p.seo&&(p.seo.title!==undefined&&p.seo.title!==c.pageTitle||p.seo.description!==undefined&&!c.sections.some(s=>s.text===p.seo!.description)||p.seo.keywords!==undefined))return false;
  return p.blocks.every((b,i)=>{
    const source=c.sections[i]!;
    if(b.type!==developerBlockType(source.type))return false;
    return Object.entries(b.content).every(([key,value])=>(PUBLIC_SECTION_FIELDS as readonly string[]).includes(key)&&JSON.stringify(value)===JSON.stringify(source[key as keyof typeof source]));
  });
}
