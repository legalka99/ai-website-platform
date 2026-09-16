import { Ajv } from 'ajv';
import { validateExternal } from '../../../security/src/validation.js';
import { plainJSON } from '../agents/design-schema.js';
import { isSafeContentText } from './content-text-policy.js';
import type { QAReport,QAIssueSeverity } from '../contracts/qa-report.js';
import type { QAValidationError } from '../contracts/qa-validation-error.js';
import type { ValidationResult } from '../orchestrator/validation.js';

export const QA_CODE_MINIMUM = {
  WEBSITE_INVALID:'error',PROJECT_SCOPE_MISMATCH:'critical',TENANT_SCOPE_MISMATCH:'critical',UNSUPPORTED_BLOCK:'critical',UNSAFE_CONTENT:'critical',
  UNGROUNDED_CLAIM:'error',CONTENT_MISMATCH:'error',CTA_MISMATCH:'error',MISSING_REQUIRED_SECTION:'error',DUPLICATE_ID:'error',DUPLICATE_SLUG:'error',STATUS_POLICY_VIOLATION:'critical',
  DESIGN_MISMATCH:'warning',SEO_INVALID:'warning',ACCESSIBILITY_OBSERVATION:'warning',UX_OBSERVATION:'warning',BUSINESS_ALIGNMENT:'error',CONTENT_QUALITY:'warning',
  // Existing public fixture codes retained as stable aliases.
  MISSING_CONTACT:'error',BROKEN:'error',OPTIONAL:'info',MISSING_BUSINESS_DATA:'error',RECOMMENDATION:'info',
} as const;
export const qaRank:Record<QAIssueSeverity,number>={info:0,warning:1,error:2,critical:3};
export const qaBlocking=(issues:readonly {severity:QAIssueSeverity}[])=>issues.some(i=>qaRank[i.severity]>=2);
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
const id={...text(200),pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*(?![\\s\\S])'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
export const qaIssueProperties={code:{type:'string',enum:Object.keys(QA_CODE_MINIMUM)},severity:{type:'string',enum:Object.keys(qaRank)},message:text(600),pageId:id,blockId:id,recommendation:text(600)};
export const qaReportSchema=object({passed:{type:'boolean'},score:{type:'number',minimum:0,maximum:100},issues:{type:'array',maxItems:32,items:object(qaIssueProperties,['code','severity','message'])},
  checkedAt:{type:'string',maxLength:24,pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},notes:text(1000)},['passed','score','issues','checkedAt']);
export const QA_REPORT_LIMITS=Object.freeze({maxBytes:32000,maxString:1000,maxArray:32,maxDepth:4,maxNodes:350});
const schema=new Ajv({strict:true}).compile(qaReportSchema);
export type QAReportValidation=ValidationResult&{validationError?:QAValidationError};
export function validateQAReport(value:unknown):QAReportValidation {
  const fail=(path:string,rule:string,stage:QAValidationError['stage']='qa-schema'):QAReportValidation=>({valid:false,issues:[{code:rule==='PASS_WITH_BLOCKING_ISSUE'?'QA_CONTRADICTION':'INVALID_OUTPUT',field:`qa.${path==='$'?'issues':path}`,message:'QA report violates the bounded report policy.'}],validationError:{stage,path,rule}});
  try{validateExternal(value,plainJSON,QA_REPORT_LIMITS);}catch{const d=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'score'):undefined;return fail(d&&'value' in d&&typeof d.value==='number'&&!Number.isFinite(d.value)?'score':'$','RESOURCE_LIMIT_OR_NON_JSON');}
  if(!schema(value)) {const e=schema.errors![0],parts=e.instancePath.split('/').slice(1);if(e.keyword==='required')parts.push(e.params.missingProperty);
    return fail(parts.map((p,i)=>/^\d+$/.test(p)?`[${p}]`:`${i?'.':''}${p}`).join('')||'$','SCHEMA_INVALID');}
  const report=value as unknown as QAReport;
  if(!Number.isFinite(Date.parse(report.checkedAt))||new Date(report.checkedAt).toISOString()!==report.checkedAt)return fail('checkedAt','SCHEMA_INVALID');
  const seen=new Set<string>();
  for(const [i,issue] of report.issues.entries()) {
    if(qaRank[issue.severity]<qaRank[QA_CODE_MINIMUM[issue.code as keyof typeof QA_CODE_MINIMUM]])return fail(`issues[${i}].severity`,'INVALID_SEVERITY','qa-consistency');
    for(const field of ['message','recommendation'] as const)if(issue[field]!==undefined&&!isSafeContentText(issue[field]!))return fail(`issues[${i}].${field}`,'UNSAFE_REPORT_TEXT');
    if(issue.blockId&&!issue.pageId)return fail(`issues[${i}].blockId`,'INVALID_REFERENCE','qa-consistency');
    const key=JSON.stringify([issue.code,issue.pageId,issue.blockId]);if(seen.has(key))return fail(`issues[${i}]`,'DUPLICATE_ISSUE','qa-consistency');seen.add(key);
  }
  if(report.notes!==undefined&&!isSafeContentText(report.notes))return fail('notes','UNSAFE_REPORT_TEXT');
  if(report.passed&&qaBlocking(report.issues))return fail('passed','PASS_WITH_BLOCKING_ISSUE','qa-consistency');
  return {valid:true,issues:[]};
}
