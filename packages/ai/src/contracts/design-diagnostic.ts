import type { TextViolation } from '../validation/design-direction-validator.js';
import { DESIGN_LIMITS } from './design-direction-schema.js';
export type DesignWireCode = 'WIRE_PARSE_FAILED' | 'WIRE_RESOURCE_LIMIT' | 'WIRE_SHAPE_INVALID';
const reasons: readonly TextViolation[] = ['UNSAFE_URL', 'UNSAFE_HTML', 'UNSAFE_CREDENTIAL', 'UNSAFE_CODE', 'UNSAFE_SHELL', 'UNSAFE_CHARACTERS', 'UNSAFE_EMPTY_TEXT'];
export interface DesignDiagnostic {
 stage:'design-wire'|'design-domain';
 issues:{code:DesignWireCode|'INVALID_OUTPUT'|'UNSAFE_DESIGN_TEXT';field:string;reason?:TextViolation}[];
}
const fields=new Set(['design',...['styleName','description','mood','colors','typography','layoutPrinciples','visualReferences','notes'].map(k=>`design.${k}`),
 ...['primary','secondary','background','text','accent'].map(k=>`design.colors.${k}`),
 ...['headingStyle','bodyStyle'].map(k=>`design.typography.${k}`),
 ...['mood','layoutPrinciples','visualReferences'].flatMap(k=>Array.from({length:12},(_,i)=>`design.${k}[${i}]`))]);
const own=(v:unknown,k:string):unknown=>v&&typeof v==='object'?Object.getOwnPropertyDescriptor(v,k)?.value:undefined;
/** Re-project at every observability boundary. No getters, messages, rejected values or arbitrary paths. */
export function safeDesignDiagnostic(value:unknown):DesignDiagnostic|undefined {
 try {
  const stage=own(value,'stage'),source=own(value,'issues');
  if((stage!=='design-wire'&&stage!=='design-domain')||!Array.isArray(source)||source.length>150)return;
  const issues:DesignDiagnostic['issues']=[];
  for(let i=0;i<source.length&&issues.length<8;i++){
   const issue=own(source,String(i)),code=own(issue,'code'),field=own(issue,'field');
   const codes=stage==='design-wire'?['WIRE_PARSE_FAILED','WIRE_RESOURCE_LIMIT','WIRE_SHAPE_INVALID']:['INVALID_OUTPUT','UNSAFE_DESIGN_TEXT'];
   if(typeof code!=='string'||!codes.includes(code)||typeof field!=='string'||!fields.has(field)||(stage==='design-wire'&&field!=='design'))continue;
   const reason=own(issue,'reason');
   const safeReason=code==='UNSAFE_DESIGN_TEXT'&&typeof reason==='string'&&reasons.includes(reason as TextViolation)?reason as TextViolation:undefined;
   if(!issues.some(i=>i.code===code&&i.field===field))issues.push({code:code as DesignDiagnostic['issues'][number]['code'],field,...(safeReason?{reason:safeReason}:{})});
  }
  return issues.length?{stage:stage as DesignDiagnostic['stage'],issues}:undefined;
 }catch{return;}
}
export const wireDiagnostic=(code:DesignWireCode):DesignDiagnostic=>({stage:'design-wire',issues:[{code,field:'design'}]});
/** Diagnostic only, called AFTER the unchanged normalizer rejects. Never decides acceptance.
 * Builds a bounded plain copy from data descriptors, so byte measurement invokes no input callbacks. */
export function designWireFailure(value:unknown):'WIRE_RESOURCE_LIMIT'|'WIRE_SHAPE_INVALID' {
 const seen=new WeakSet<object>();let nodes=0;
 function copy(v:unknown,depth:number):unknown {
  if(++nodes>DESIGN_LIMITS.maxNodes||depth>DESIGN_LIMITS.maxDepth)throw 'WIRE_RESOURCE_LIMIT';
  if(typeof v==='string'){if(v.length>DESIGN_LIMITS.maxString)throw 'WIRE_RESOURCE_LIMIT';return v;}
  if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
  if(!v||typeof v!=='object'||seen.has(v))throw 'WIRE_SHAPE_INVALID';seen.add(v);
  if(Object.getOwnPropertySymbols(v).length)throw 'WIRE_SHAPE_INVALID';
  const array=Array.isArray(v);if(array&&v.length>DESIGN_LIMITS.maxArray)throw 'WIRE_RESOURCE_LIMIT';
  if(!array&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw 'WIRE_SHAPE_INVALID';
  const ds=Object.getOwnPropertyDescriptors(v),entries=Object.entries(ds);
  if(entries.length>DESIGN_LIMITS.maxNodes)throw 'WIRE_RESOURCE_LIMIT';
  const out:Record<string,unknown>|unknown[]=array?[]:Object.create(null);
  for(const [key,d] of entries){
   if(array&&key==='length')continue;
   if(key.length>DESIGN_LIMITS.maxString)throw 'WIRE_RESOURCE_LIMIT';
   if(['__proto__','constructor','prototype'].includes(key)||!d.enumerable||!('value' in d))throw 'WIRE_SHAPE_INVALID';
   Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true,configurable:true,writable:true});
  }
  return out;
 }
 try {return new TextEncoder().encode(JSON.stringify(copy(value,0))).length>DESIGN_LIMITS.maxBytes?'WIRE_RESOURCE_LIMIT':'WIRE_SHAPE_INVALID';}
 catch(code){return code==='WIRE_RESOURCE_LIMIT'?'WIRE_RESOURCE_LIMIT':'WIRE_SHAPE_INVALID';}
}
