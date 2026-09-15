import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readOpenAIConfig } from '../.test-build/packages/ai/src/providers/config.js';
import { readYandexConfig } from '../.test-build/packages/ai/src/providers/yandex-config.js';
import { readRouterPolicy } from '../.test-build/packages/ai/src/router/policy.js';
import { createRoutedDesignService } from '../.test-build/packages/ai/src/services/routed-design-service.js';
import { validateDesignDirection } from '../.test-build/packages/ai/src/validation/design-direction-validator.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard, DEFAULT_AI_LIMITS, assertLocalEnvFile, redact } from '../.test-build/packages/security/src/index.js';

export function parseDesignSmokeArgs(args) {
  if(args.some(arg=>!['--confirm-paid-request','--provider=openai','--provider=yandex'].includes(arg)) ||
    args.filter(arg=>arg.startsWith('--provider=')).length>1) throw new Error('Invalid arguments');
  return {provider:args.find(arg=>arg.startsWith('--provider='))?.split('=')[1] ?? 'openai',confirmed:args.includes('--confirm-paid-request')};
}
export function designSmokeInput() {
  return {companyName:'Учебный пример Kleo',industry:'Стеклянные конструкции',
    description:'Учебная компания: изготовление стеклянных перегородок и душевых ограждений на заказ.',
    productsOrServices:['Стеклянные перегородки','Душевые ограждения'],targetAudience:['Владельцы квартир'],
    websiteGoals:['Получение запросов на расчёт'],desiredActions:['Запросить расчёт'],
    designPreferences:{style:'Минималистичный',mood:['Спокойный','Визуально лёгкий']}};
}
// Each projection allocates fresh objects. Never serialize arbitrary agent/provider metadata.
const strings=(source,fields)=>Object.fromEntries(fields.flatMap(key=>{
  const d=source && Object.getOwnPropertyDescriptor(source,key);
  return d && 'value' in d && typeof d.value==='string' && d.value.length<=256 ? [[key,d.value]]:[];
}));
const numbers=(source,fields)=>Object.fromEntries(fields.flatMap(key=>{
  const d=source && Object.getOwnPropertyDescriptor(source,key);
  return d && 'value' in d && Number.isFinite(d.value) && d.value>=0 ? [[key,d.value]]:[];
}));
const usage=value=>value ? {...strings(value,['provider','model','timestamp','requestId','projectId','workflowId','actorId','organizationId','agentType']),
  ...numbers(value,['inputTokens','outputTokens','totalTokens','cachedInputTokens','durationMs'])}:undefined;
export function designSmokeOutput(result,context,provider,model,knownSecrets=[]) {
  const execution=result.execution;
  const routing=execution?.routing;
  const decision=routing?.decision;
  const valid=result.success===true && validateDesignDirection(result.output).valid;
  const data={success:valid,projectId:context.projectId,workflowId:context.workflowId,provider,model,
    ...(valid?{design:structuredClone(result.output)}:{error:'Design smoke не вернул проверенный результат.',...strings(result,['errorCode'])}),
    requestId:execution?.usage?.requestId,usage:usage(execution?.usage),
    routing:routing?{decision:{...strings(decision,['provider','model','reason','policyId','policyVersion']),
      fallbackProviders:Array.isArray(decision?.fallbackProviders)?decision.fallbackProviders.filter(id=>['openai','yandex'].includes(id)).slice(0,1):[]},
      attempts:Array.isArray(routing.attempts)?routing.attempts.slice(0,2).map(a=>({...strings(a,['provider','model','outcome','errorCode']),usage:usage(a.usage)})):[]}:undefined,
    budget:execution?.budget?{...strings(execution.budget,['projectId','workflowId']),...numbers(execution.budget,['maxOutputTokens','reservedOutputTokens','requests','maxRequests'])}:undefined};
  return JSON.stringify(redact(data,knownSecrets),null,2);
}
function loadLocalEnvironment() {
  const envPath=fileURLToPath(new URL('../.env',import.meta.url));
  if(existsSync(envPath)) {assertLocalEnvFile(envPath,process.env.NODE_ENV??'development');loadEnvFile(envPath);}
  return process.env;
}
/** Dependencies are trusted offline-test injection, never CLI flags or model data. */
export async function runDesignSmoke(args,{loadEnvironment=loadLocalEnvironment,transport,write=message=>console.log(message)}={}) {
  let parsed;
  try {parsed=parseDesignSmokeArgs(args);} catch {write('Некорректные параметры. Допустимы --provider=openai или --provider=yandex и --confirm-paid-request.');return 1;}
  if(!parsed.confirmed) {write('Запрос не отправлен. Для одного платного вызова добавьте --confirm-paid-request.');return 1;}
  try {
    const env=loadEnvironment();
    const environment=env.NODE_ENV??'development';
    if(!['development','test'].includes(environment)) throw new Error();
    const config=parsed.provider==='openai'?readOpenAIConfig(env):readYandexConfig(env);
    // Technical smoke ceiling only; preserve smaller configured limits.
    config.maxOutputTokens=Math.min(config.maxOutputTokens,2000);
    const context={projectId:'kleo-design-smoke',organizationId:'local',workflowId:`design-${randomUUID()}`,actor:{id:'local-owner',authenticated:true}};
    const credentials={id:`local-${parsed.provider}`,projectId:context.projectId,organizationId:context.organizationId,provider:parsed.provider,secretRef:`local/${parsed.provider}`};
    const {apiKey,...publicConfig}=config;
    const policy=readRouterPolicy({KLEO_AI_PRIMARY_PROVIDER:parsed.provider});policy.maxAttempts=1;
    const costs=new AICostGuard({...DEFAULT_AI_LIMITS,maxConcurrent:1,maxRequestsPerWorkflow:1,maxOutputTokens:config.maxOutputTokens,maxWorkflowOutputTokens:config.maxOutputTokens});
    const agent=await createRoutedDesignService({context,policy,costs,
      authorization:new AuthorizationPolicy([{...context,actorId:context.actor.id,role:'owner'}]),
      secrets:new LocalSecretProvider([{...credentials,value:apiKey}],environment),
      providers:[{id:parsed.provider,config:publicConfig,credentials,transport}]});
    const result=await agent.run({projectId:context.projectId,goal:'Предложить направление дизайна страницы для запроса расчёта.',input:designSmokeInput()});
    write(designSmokeOutput(result,context,parsed.provider,config.model,[apiKey]));
    return result.success?0:1;
  } catch {write('Не удалось запустить Design smoke. Проверьте локальную конфигурацию, режим и права файла настроек.');return 1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) process.exitCode=await runDesignSmoke(process.argv.slice(2));
