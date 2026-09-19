/** Value-free diagnostic. Paths/rules are restricted again at the public smoke boundary. */
export interface ContentValidationError {
  stage: 'content-json' | 'content-resource' | 'content-schema' | 'content-semantic' | 'content-grounding' | 'provider-output';
  path: string;
  rule: string;
}
export const CONTENT_VALIDATION_RULES = ['JSON_PARSE_FAILED','RESOURCE_LIMIT_OR_NON_JSON','SCHEMA_REQUIRED','SCHEMA_ADDITIONAL_PROPERTIES','SCHEMA_TYPE','SCHEMA_MIN_LENGTH','SCHEMA_MAX_LENGTH','SCHEMA_PATTERN','SCHEMA_MIN_ITEMS','SCHEMA_MAX_ITEMS','SCHEMA_ENUM','SCHEMA_INVALID','UNSAFE_TEXT','UNGROUNDED_QUALITY_CLAIM','UNGROUNDED_SPEED_CLAIM','UNGROUNDED_EXPERIENCE_CLAIM','UNGROUNDED_CAPABILITY_CLAIM','UNGROUNDED_PRICE_CLAIM','UNGROUNDED_GUARANTEE_CLAIM','UNGROUNDED_SERVICE_CLAIM','UNGROUNDED_SOCIAL_PROOF_CLAIM','UNGROUNDED_TECHNICAL_CLAIM','UNSAFE_URL','UNSAFE_HTML','UNSAFE_CREDENTIAL','UNSAFE_PROMPT_INJECTION','UNSAFE_CODE','UNSAFE_SHELL','UNSAFE_CHARACTERS','UNSAFE_EMPTY_TEXT','SECTION_COPY_REQUIRED','ADVANTAGES_POINTS_MIN','CTA_REQUIRED','CTA_LIMIT','FAQ_LIMIT','FAQ_POINTS_LIMIT','CTA_NOT_ALLOWED','PROVIDER_OUTPUT_INVALID'] as const;
export function safeContentValidationError(value:unknown):ContentValidationError|undefined {
  if(!value || typeof value!=='object') return undefined;
  const read=(key:string)=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&'value' in d?d.value:undefined;};
  const stage=read('stage'),path=read('path'),rule=read('rule');
  if(!['content-json','content-resource','content-schema','content-semantic','content-grounding','provider-output'].includes(stage) ||
    !CONTENT_VALIDATION_RULES.includes(rule) || typeof path!=='string' ||
    !/^(?:\$|pageTitle|pageGoal|toneOfVoice|notes|keyMessages(?:\[[0-9]\])?|sections(?:\[[0-9]\](?:\.(?:type|purpose|heading|text|callToAction|points(?:\[[0-9]\])?))?)?)$/.test(path)) return undefined;
  return {stage,path,rule};
}
