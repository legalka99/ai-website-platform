import { briefFields, type BusinessBrief } from './business-brief.js';
/** A reusable fact set can be empty and does not require a full Brief.
 * Owner Brief is the first source adapter, not the knowledge lifecycle.
 * Server-owned provenance. New trusted sources require an explicit contract extension. */
export const FACT_CATEGORIES = ['companyName','description','productsOrServices','targetAudience','geography','advantages'] as const;
export type FactCategory = typeof FACT_CATEGORIES[number];
export interface ConfirmedBusinessFact {
 readonly category: FactCategory;
 readonly value: string;
 readonly source: {readonly kind:'owner_brief';readonly briefVersionId:string;readonly field:FactCategory};
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
 for(let i=0;i<value.facts.length;i++){
  const f=Object.getOwnPropertyDescriptor(value.facts,String(i))?.value;
  if(!exact(f,['category','value','source','qualifiers'])||typeof f.category!=='string'||!(FACT_CATEGORIES as readonly string[]).includes(f.category)||typeof f.value!=='string'||!f.value.trim()||f.value.length>briefFields[f.category as FactCategory].max)return fail();
  const category=f.category as FactCategory;
  if(!exact(f.source,['kind','briefVersionId','field'])||f.source.kind!=='owner_brief'||typeof f.source.briefVersionId!=='string'||!uuid.test(f.source.briefVersionId)||f.source.field!==category||!plainArray(f.qualifiers,50))return fail();
  const expected=qualifiers(f.value);
  if(f.qualifiers.length!==expected.length||expected.some((q,j)=>Object.getOwnPropertyDescriptor(f.qualifiers,String(j))?.value!==q))return fail();
  const identity=JSON.stringify([f.source.kind,f.source.briefVersionId,category]);
  if(seen.has(identity))return fail();seen.add(identity);facts.push(Object.freeze({category,value:f.value,source:Object.freeze({kind:'owner_brief' as const,briefVersionId:f.source.briefVersionId,field:category}),qualifiers:Object.freeze(expected)}));
 }
 return Object.freeze({facts:Object.freeze(facts)});
}
/** Call only with a validated saved Owner Brief, never BusinessProfile/model output. */
export function confirmedFactsFromBrief(brief:BusinessBrief,briefVersionId:string):ConfirmedBusinessFacts {
 return validateConfirmedBusinessFacts({facts:FACT_CATEGORIES.flatMap(category=>{
  const value=brief[category];return value?[{category,value,source:{kind:'owner_brief',briefVersionId,field:category},qualifiers:qualifiers(value)}]:[];
 })});
}
