export interface QAValidationError {
  stage:'qa-input'|'qa-json'|'qa-schema'|'qa-consistency';
  path:string;
  rule:string;
}
export const QA_VALIDATION_RULES=['INVALID_INPUT','INVALID_JSON','RESOURCE_LIMIT_OR_NON_JSON','SCHEMA_INVALID','UNSAFE_REPORT_TEXT','PASS_WITH_BLOCKING_ISSUE','INVALID_SEVERITY','DUPLICATE_ISSUE','INVALID_REFERENCE','PROVIDER_OUTPUT_INVALID'] as const;
export function safeQAValidationError(value:unknown):QAValidationError|undefined {
  if(!value||typeof value!=='object')return undefined;
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value' in d?d.value:undefined;};
  const stage=read('stage'),path=read('path'),rule=read('rule');
  if(!['qa-input','qa-json','qa-schema','qa-consistency'].includes(stage)||!QA_VALIDATION_RULES.includes(rule)||typeof path!=='string'||path.trim()!==path||
    !/^(?:\$|passed|score|checkedAt|notes|issues(?:\[(?:[0-9]|[12][0-9]|3[01])\](?:\.(?:code|severity|message|pageId|blockId|pageIndex|blockIndex|recommendation))?)?)$/.test(path))return undefined;
  return {stage,path,rule};
}
