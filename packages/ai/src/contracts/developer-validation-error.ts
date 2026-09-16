export interface DeveloperValidationError {
  stage: 'developer-input' | 'developer-json' | 'developer-schema' | 'developer-semantic' | 'developer-website' | 'developer-grounding';
  path: string;
  rule: string;
}
export const DEVELOPER_RULES = ['INVALID_INPUT','INVALID_JSON','RESOURCE_LIMIT_OR_NON_JSON','SCHEMA_INVALID','SECTION_ORDER','COPY_MISMATCH','WEBSITE_INVALID','PROVIDER_OUTPUT_INVALID'] as const;
/** Fixed codes and schema-owned paths only. Never expose values, matches or extra property names. */
export function safeDeveloperValidationError(value:unknown):DeveloperValidationError|undefined {
  if(!value||typeof value!=='object') return undefined;
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value' in d?d.value:undefined;};
  const stage=read('stage'),path=read('path'),rule=read('rule');
  if(!['developer-input','developer-json','developer-schema','developer-semantic','developer-website','developer-grounding'].includes(stage)||
    !DEVELOPER_RULES.includes(rule)||typeof path!=='string'||path.length>200||path.trim()!==path||
    !/^(?:\$|sections(?:\[[0-9]\](?:\.(?:sectionIndex|alignment))?)?|website(?:\.(?:id|projectId|name|status|createdAt|updatedAt|designSystem(?:\.(?:colors|typography|spacing|borderRadius)(?:\.(?:primary|secondary|background|text|accent|headingFont|bodyFont|baseFontSize|section|block))?)?|pages(?:\[[0-9]\](?:\.(?:id|slug|title|status|order|seo(?:\.(?:title|description|keywords(?:\[[0-9]\])?))?|blocks(?:\[[0-9]\](?:\.(?:id|type|order|visible|settings(?:\.alignment)?|content(?:\.(?:heading|text|points(?:\[[0-9]\])?|callToAction))?))?)?))?)?))?|generatedAt|notes)$/.test(path)) return undefined;
  return {stage,path,rule};
}
