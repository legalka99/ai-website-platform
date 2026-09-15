import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readOpenAIConfig } from '../.test-build/packages/ai/src/providers/config.js';
import { createRoutedBusinessService } from '../.test-build/packages/ai/src/services/routed-business-service.js';
import { readYandexConfig } from '../.test-build/packages/ai/src/providers/yandex-config.js';
import { readRouterPolicy } from '../.test-build/packages/ai/src/router/policy.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard, DEFAULT_AI_LIMITS, assertLocalEnvFile, redact, SecurityError } from '../.test-build/packages/security/src/index.js';

try {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) { assertLocalEnvFile(envPath, process.env.NODE_ENV ?? 'development'); loadEnvFile(envPath); }
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--confirm-paid-request','--allow-fallback','--provider=openai','--provider=yandex','--provider=router'].includes(arg)) || args.filter(arg=>arg.startsWith('--provider=')).length>1) throw new AIProviderError('INVALID_CONFIG');
  const mode=args.find(arg=>arg.startsWith('--provider='))?.split('=')[1] ?? 'openai';
  const policy=readRouterPolicy(mode==='router'?process.env:{KLEO_AI_PRIMARY_PROVIDER:mode});
  policy.maxAttempts=args.includes('--allow-fallback')?2:1;
  const task=policy.tasks.business;
  const ids=[...new Set([task.preferred,task.fallback].filter(Boolean))];
  const configs=ids.map(id=>({id,config:id==='openai'?readOpenAIConfig(process.env):readYandexConfig(process.env)}));
  if (!args.includes('--confirm-paid-request')) {
    console.error('Запрос не отправлен. Для реального вызова добавьте --confirm-paid-request. Fallback в smoke требует также --allow-fallback.');
    process.exitCode = 1;
  } else {
    const environment = process.env.NODE_ENV ?? 'development';
    if (!['development', 'test'].includes(environment)) throw new SecurityError('SECRET_UNAVAILABLE');
    const context = { projectId: 'kleo-local-smoke', organizationId: 'local', workflowId: 'manual-smoke', actor: { id: 'local-owner', authenticated: true } };
    const providers=configs.map(({id,config})=>({id,config:{...config,apiKey:undefined},credentials:{id:`local-${id}`,projectId:context.projectId,organizationId:context.organizationId,provider:id,secretRef:`local/${id}`}}));
    const knownSecrets=configs.map(x=>x.config.apiKey);
    const authorization = new AuthorizationPolicy([{ ...context, actorId: context.actor.id, role: 'owner' }]);
    const maxTokens=Math.max(...configs.map(x=>x.config.maxOutputTokens));
    const costs = new AICostGuard({ ...DEFAULT_AI_LIMITS, maxConcurrent: 1, maxRequestsPerWorkflow: policy.maxAttempts, maxOutputTokens:maxTokens, maxWorkflowOutputTokens:maxTokens*policy.maxAttempts });
    const secrets = new LocalSecretProvider(providers.map((p,i)=>({...p.credentials,value:knownSecrets[i]})),environment);
    const agent = await createRoutedBusinessService({context,providers,secrets,authorization,costs,policy});
    const result = await agent.run({ projectId: 'kleo-local-smoke', goal: 'Подготовить профиль для страницы с запросом расчёта.', input: {
      companyName: 'Учебный пример Kleo', description: 'Учебная компания: изготовление стеклянных перегородок и душевых ограждений на заказ.',
      industry: 'Стеклянные конструкции', productsOrServices: ['Стеклянные перегородки', 'Душевые ограждения'],
      targetAudience: ['Владельцы квартир'], websiteGoals: ['Получение запросов на расчёт'], desiredActions: ['Запросить расчёт'],
    } });
    if (!result.success) {
      console.error(JSON.stringify(redact({ error: result.error, code: result.errorCode, missingFields: result.missingFields, usage: result.execution?.usage, routing: result.execution?.routing, budget: result.execution?.budget }, knownSecrets), null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(redact({ profile: result.output, usage: result.execution?.usage, routing: result.execution?.routing, budget: result.execution?.budget }, knownSecrets), null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof SecurityError ? 'Проверьте локальный режим и права .env: файл должен принадлежать вам и иметь права 600 (chmod 600 .env).' : error instanceof AIProviderError ? error.message : 'Не удалось запустить проверку. Проверьте локальный .env и установленные зависимости.');
  process.exitCode = 1;
}
