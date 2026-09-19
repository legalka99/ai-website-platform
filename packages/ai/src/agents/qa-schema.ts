import { Ajv } from 'ajv';
import { validateExternal } from '../../../security/src/validation.js';
import { SecurityError } from '../../../security/src/errors.js';
import { plainJSON } from './design-schema.js';
import { validateContentInput } from './content-schema.js';
import { validateContentPlan } from '../validation/content-plan-validator.js';
import { validateContentGrounding } from '../validation/content-grounding-validator.js';
import { validateDeveloperOutput,validateDeveloperReuse } from '../validation/developer-output-validator.js';
import { developerDesignSystem } from '../services/developer-website-builder.js';
import { qaIssueProperties,QA_CODE_MINIMUM,qaRank,QA_REPORT_LIMITS,validateQAReport } from '../validation/qa-report-validator.js';
import type { QAAgentInput } from '../contracts/qa-agent-input.js';
import type { QAIssue,QAReport } from '../contracts/qa-report.js';
import type { QAValidationError } from '../contracts/qa-validation-error.js';

const nullable=(value:unknown)=>({anyOf:[value,{type:'null'}]});
// Provider-only vocabulary. Final QAReport retains deterministic and legacy codes.
export const QA_AI_CODES=Object.freeze([
  'BUSINESS_ALIGNMENT','DESIGN_MISMATCH','SEO_INVALID','ACCESSIBILITY_OBSERVATION',
  'UX_OBSERVATION','CONTENT_QUALITY','RECOMMENDATION',
] as const satisfies readonly (keyof typeof QA_CODE_MINIMUM)[]);
export const qaWireSchema=JSON.parse(JSON.stringify({type:'object',additionalProperties:false,required:['passed','score','issues','notes'],properties:{
  passed:{type:'boolean'},score:{type:'number',minimum:0,maximum:100},notes:nullable({type:'string',minLength:1,maxLength:1000,pattern:'\\S'}),
  issues:{type:'array',maxItems:20,items:{type:'object',additionalProperties:false,required:['code','severity','message','pageIndex','blockIndex','recommendation'],properties:{
    code:{type:'string',enum:QA_AI_CODES},severity:qaIssueProperties.severity,message:qaIssueProperties.message,
    pageIndex:nullable({type:'integer',minimum:0,maximum:9}),blockIndex:nullable({type:'integer',minimum:0,maximum:9}),recommendation:nullable(qaIssueProperties.recommendation),
  }}}
}}));
/** Server configuration only, never a field accepted from provider/HTTP input. */
export type QAReviewScope='website'|'block';
export const QA_BLOCK_AI_CODES=Object.freeze(QA_AI_CODES.filter(code=>code!=='SEO_INVALID'));
const blockWireSchema=structuredClone(qaWireSchema);
blockWireSchema.properties.issues.items.properties.code.enum=[...QA_BLOCK_AI_CODES];
export function qaSchemaForScope(scope:QAReviewScope){return structuredClone(scope==='block'?blockWireSchema:qaWireSchema);}
const wireValidator=new Ajv({strict:true}).compile(qaWireSchema);
const blockWireValidator=new Ajv({strict:true}).compile(blockWireSchema);
export function snapshotQAInput(value:unknown):QAAgentInput & Required<Pick<QAAgentInput,'reviewContext'>> {
  validateExternal(value,plainJSON,{maxBytes:110000,maxString:8000,maxArray:50,maxDepth:9,maxNodes:2000});
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['website','generatedAt','notes','reviewContext'].includes(k)))throw new SecurityError('INVALID_INPUT');
  const input=value as QAAgentInput;
  if(!input.reviewContext||Object.keys(input.reviewContext).some(k=>!['business','design','content','businessFacts','confirmedBusinessFacts'].includes(k)))throw new SecurityError('INVALID_INPUT');
  const {business,design,businessFacts,confirmedBusinessFacts}=input.reviewContext;
  validateContentInput({business,design,...(confirmedBusinessFacts?{confirmedBusinessFacts}:{}),...(businessFacts===undefined?{}:{businessFacts})});
  return structuredClone(input) as QAAgentInput & Required<Pick<QAAgentInput,'reviewContext'>>;
}
const equal=(a:unknown,b:unknown):boolean=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const x=Object.keys(a),y=Object.keys(b);return x.length===y.length&&x.every(k=>Object.hasOwn(b,k)&&equal((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
};
/** Never attach rejected input values or potentially forged IDs to deterministic findings. */
export function deterministicQA(input:ReturnType<typeof snapshotQAInput>,projectId:string,scope:QAReviewScope='website'):QAIssue[] {
  const issues:QAIssue[]=[];
  const add=(code:keyof typeof QA_CODE_MINIMUM,message:string)=>issues.push({code,severity:QA_CODE_MINIMUM[code],message});
  const {reviewContext:r,...developer}=input;
  if(input.website?.projectId!==projectId)throw new SecurityError('ACCESS_DENIED');
  const content=validateContentPlan(r.content);
  if(!content.valid){add('UNSAFE_CONTENT','Content failed deterministic validation.');return issues;}
  if(validateContentGrounding(r.content,r)){add('UNGROUNDED_CLAIM','Content includes an unsupported business claim.');return issues;}
  const website=validateDeveloperOutput(developer,projectId);
  if(!website.valid){
    const code=website.issues.some(i=>i.field?.endsWith('.status'))?'STATUS_POLICY_VIOLATION'
      :website.issues.some(i=>i.field?.endsWith('.type'))?'UNSUPPORTED_BLOCK'
      :website.issues.some(i=>i.code==='UNSAFE_DEVELOPER_TEXT')?'UNSAFE_CONTENT'
      :website.issues.some(i=>i.code==='DUPLICATE_VALUE'&&i.field?.endsWith('.id'))?'DUPLICATE_ID'
      :website.issues.some(i=>i.code==='DUPLICATE_VALUE'&&i.field?.endsWith('.slug'))?'DUPLICATE_SLUG':'WEBSITE_INVALID';
    add(code,'Website failed deterministic validation.');return issues;
  }
  if(!validateDeveloperReuse(developer,r))add('CONTENT_MISMATCH','Website copy differs from the approved content.');
  const page=input.website.pages[0]!;
  if(page.blocks.some((b,i)=>!equal(b.content.callToAction,r.content.sections[i]?.callToAction)))add('CTA_MISMATCH','Website CTA differs from the approved content.');
  if(page.blocks.length!==r.content.sections.length||page.blocks.some((b,i)=>b.order!==i||!b.visible||['heading','text','points','callToAction'].some(key=>!equal(b.content[key],r.content.sections[i]?.[key as keyof typeof r.content.sections[number]]))))add('MISSING_REQUIRED_SECTION','Required content is missing or reordered.');
  if(page.order!==0)add('CONTENT_MISMATCH','Page order differs from the approved structure.');
  if(!equal(input.website.designSystem,developerDesignSystem(r)))add('DESIGN_MISMATCH','Design tokens differ from the approved direction and defaults.');
  if(scope==='website'&&!page.seo?.title)add('SEO_INVALID','A page SEO title is required.');
  return issues.filter((issue,index,all)=>all.findIndex(i=>i.code===issue.code)===index);
}
export function parseQAWire(value:unknown,input:ReturnType<typeof snapshotQAInput>,scope:QAReviewScope='website'):{report?:QAReport;validationError?:QAValidationError} {
  const error=(path:string,rule:string,stage:QAValidationError['stage']='qa-schema')=>({validationError:{stage,path,rule}});
  try{validateExternal(value,plainJSON,QA_REPORT_LIMITS);}catch{return error('$','RESOURCE_LIMIT_OR_NON_JSON');}
  if(!(scope==='block'?blockWireValidator:wireValidator)(value))return error('$','SCHEMA_INVALID');
  const wire=value as {passed:boolean;score:number;notes:string|null;issues:{code:string;severity:QAIssue['severity'];message:string;pageIndex:number|null;blockIndex:number|null;recommendation:string|null}[]};
  const issues:QAIssue[]=[];
  for(const [i,issue] of wire.issues.entries()) {
    const page=issue.pageIndex===null?undefined:input.website.pages[issue.pageIndex];
    const block=issue.blockIndex===null?undefined:page?.blocks[issue.blockIndex];
    if(issue.pageIndex!==null&&!page||issue.blockIndex!==null&&!block)return error(`issues[${i}]`,'INVALID_REFERENCE','qa-consistency');
    const minimum=QA_CODE_MINIMUM[issue.code as keyof typeof QA_CODE_MINIMUM];
    const severity=qaRank[issue.severity]<qaRank[minimum]?minimum:issue.severity;
    issues.push({code:issue.code,severity,message:issue.message,...(page?{pageId:page.id}:{}),...(block?{blockId:block.id}:{}),...(issue.recommendation===null?{}:{recommendation:issue.recommendation})});
  }
  const report:QAReport={passed:wire.passed,score:wire.score,issues,checkedAt:new Date().toISOString(),...(wire.notes===null?{}:{notes:wire.notes})};
  const validation=validateQAReport(report);return validation.valid?{report}:{validationError:validation.validationError};
}
export function mergeQAFindings(report:QAReport,findings:QAIssue[]):QAReport {
  const issues:QAIssue[]=[];
  for(const issue of [...findings,...report.issues]){
    const existing=issues.find(i=>i.code===issue.code&&i.pageId===issue.pageId&&i.blockId===issue.blockId);
    if(existing){if(qaRank[issue.severity]>qaRank[existing.severity])existing.severity=issue.severity;}else issues.push({...issue});
  }
  return {...report,issues,passed:report.passed&&!issues.some(i=>qaRank[i.severity]>=2)};
}
