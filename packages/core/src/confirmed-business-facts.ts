import {atomicBriefValues} from './fact-atomization.js';
import { briefFields, type BusinessBrief } from './business-brief.js';
/** A reusable fact set can be empty and does not require a full Brief.
 * Owner Brief is the first source adapter, not the knowledge lifecycle.
 * Server-owned provenance. New trusted sources require an explicit contract extension. */
export const FACT_CATEGORIES = ['companyName','description','productsOrServices','targetAudience','geography','advantages'] as const;
export type FactCategory = typeof FACT_CATEGORIES[number];
export interface OwnerBriefFactSource {
 readonly kind:'owner_brief';readonly briefVersionId:string;readonly field:FactCategory;
 /** Legacy closed-grammar atomization of one historical free-form field. */
 readonly fragment?:{readonly index:number;readonly originalValue:string};
 /** One independently confirmed entry in a structured Brief version. */
 readonly item?:{readonly index:number;readonly count:number};
}
export interface ConfirmedBusinessFact {
 readonly category: FactCategory;
 readonly value: string;
 readonly source: OwnerBriefFactSource;
 /** Complete conditional/negative clauses, never a shortened positive assertion. */
 readonly qualifiers: readonly string[];
}
export interface ConfirmedBusinessFacts {
 readonly facts:readonly ConfirmedBusinessFact[];
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const conditional=/(?:^|[^\p{L}])(?:не|нет|без|если|при|кроме|только|not|no|without|if|unless|only|subject to)(?:$|[^\p{L}])/iu;
// Split only explicit sentence boundaries; comma-separated offerings/conditions stay together.
export const factualClauses=(text:string):string[]=>text.split(/(?<!\d)[.!?;\n]+|[.!?;\n]+(?!\d)/u).map(v=>v.trim()).filter(Boolean);
const qualifiers=(value:string)=>factualClauses(value).filter(v=>conditional.test(v));
function exact(v:unknown,keys:string[]):v is Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||Object.getOwnPropertySymbols(v).length)return false;
 const ds=Object.getOwnPropertyDescriptors(v);
 return Object.keys(ds).length===keys.length&&keys.every(k=>ds[k]?.enumerable&&'value' in ds[k]!);
}
function plainArray(value:unknown,max:number):value is unknown[] {
 if(!Array.isArray(value)||value.length>max||Object.getOwnPropertySymbols(value).length)return false;
 const ds=Object.getOwnPropertyDescriptors(value);
 return Object.keys(ds).length===value.length+1&&Array.from({length:value.length},(_,i)=>ds[String(i)]).every(d=>d?.enumerable&&'value' in d);
}
/** Bounded descriptor validation; no getters, coercion, unknown sources or inferred authority. */
export function validateConfirmedBusinessFacts(value:unknown):ConfirmedBusinessFacts {
 const fail=():never=>{throw new Error('INVALID_CONFIRMED_FACTS');};
 if(!exact(value,['facts'])||!plainArray(value.facts,32))return fail();
 const seen=new Set<string>(),facts:ConfirmedBusinessFact[]=[];
 const groups=new Map<string,{original:string;indices:number[];expected:string[]}>(),itemGroups=new Map<string,{indices:number[];values:Set<string>;count:number}>();
 const legacy=new Set<string>();
 for(let i=0;i<value.facts.length;i++){
  const f=Object.getOwnPropertyDescriptor(value.facts,String(i))?.value;
  if(!exact(f,['category','value','source','qualifiers'])||typeof f.category!=='string'||!(FACT_CATEGORIES as readonly string[]).includes(f.category)||typeof f.value!=='string'||!f.value.trim()||f.value.length>briefFields[f.category as FactCategory].max)return fail();
  const category=f.category as FactCategory;
  const rawSource=f.source;
  const sourceShape=exact(rawSource,['kind','briefVersionId','field','fragment'])?'fragment':exact(rawSource,['kind','briefVersionId','field','item'])?'item':exact(rawSource,['kind','briefVersionId','field'])?'legacy':undefined;
  if(!sourceShape)return fail();const source=rawSource as Record<string,unknown>;
  if(source.kind!=='owner_brief'||typeof source.briefVersionId!=='string'||!uuid.test(source.briefVersionId)||source.field!==category||!plainArray(f.qualifiers,50))return fail();
  const expected=qualifiers(f.value);
  if(f.qualifiers.length!==expected.length||expected.some((q,j)=>Object.getOwnPropertyDescriptor(f.qualifiers,String(j))?.value!==q))return fail();
  const base=JSON.stringify([source.kind,source.briefVersionId,category]);
  let fragment:{index:number;originalValue:string}|undefined,item:{index:number;count:number}|undefined;
  if(sourceShape==='fragment'){
   const part=source.fragment;
   if(!exact(part,['index','originalValue'])||!Number.isInteger(part.index)||typeof part.index!=='number'||typeof part.originalValue!=='string'||part.originalValue.length>briefFields[category].max)return fail();
   const values=atomicBriefValues(category,part.originalValue);
   if(values.length<2||part.index<0||part.index>=values.length||values[part.index]!==f.value||legacy.has(base)||itemGroups.has(base))return fail();
   const group=groups.get(base);
   if(group&&group.original!==part.originalValue)return fail();
   const current=group??{original:part.originalValue,indices:[],expected:values};current.indices.push(part.index);groups.set(base,current);
   fragment={index:part.index,originalValue:part.originalValue};
  }else if(sourceShape==='item'){
   const part=source.item;
   if(category!=='advantages'||!exact(part,['index','count'])||!Number.isInteger(part.index)||typeof part.index!=='number'||!Number.isInteger(part.count)||typeof part.count!=='number'||part.count<1||part.count>8||part.index<0||part.index>=part.count||legacy.has(base)||groups.has(base))return fail();
   const current=itemGroups.get(base)??{indices:[],values:new Set<string>(),count:part.count};if(current.count!==part.count)return fail();
   const normalized=f.value.toLocaleLowerCase('ru-RU');if(current.values.has(normalized))return fail();
   current.indices.push(part.index);current.values.add(normalized);itemGroups.set(base,current);item={index:part.index,count:part.count};
  }else{if(groups.has(base)||itemGroups.has(base))return fail();legacy.add(base);}
  const identity=JSON.stringify([base,fragment?'fragment':item?'item':'legacy',fragment?.index??item?.index??null]);
  if(seen.has(identity))return fail();seen.add(identity);
  facts.push(Object.freeze({category,value:f.value,source:Object.freeze({kind:'owner_brief' as const,briefVersionId:source.briefVersionId,field:category,...(fragment?{fragment:Object.freeze(fragment)}:{}),...(item?{item:Object.freeze(item)}:{})}),qualifiers:Object.freeze(expected)}));
 }
 for(const group of groups.values())if(group.indices.length!==group.expected.length||group.indices.some((index,i)=>index!==i))return fail();
 for(const group of itemGroups.values())if(group.indices.length!==group.count||group.indices.some((index,i)=>index!==i))return fail();
 return Object.freeze({facts:Object.freeze(facts)});
}
/** Call only with a validated saved Owner Brief, never BusinessProfile/model output. */
export function confirmedFactsFromBrief(brief:BusinessBrief,briefVersionId:string):ConfirmedBusinessFacts {
 const facts:unknown[]=[];
 for(const category of FACT_CATEGORIES){
  const originalValue=brief[category];if(!originalValue)continue;
  if(category==='advantages'&&Array.isArray(originalValue)){for(const [index,entry] of originalValue.entries())facts.push({category,value:entry.text,source:{kind:'owner_brief',briefVersionId,field:category,item:{index,count:originalValue.length}},qualifiers:qualifiers(entry.text)});continue;}
  if(typeof originalValue!=='string')continue;
  const values=atomicBriefValues(category,originalValue);
  for(const [index,value] of values.entries())facts.push({category,value,source:{kind:'owner_brief',briefVersionId,field:category,...(values.length>1?{fragment:{index,originalValue}}:{})},qualifiers:qualifiers(value)});
 }
 return validateConfirmedBusinessFacts({facts});
}
