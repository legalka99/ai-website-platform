import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readOpenAIConfig } from '../.test-build/packages/ai/src/providers/config.js';
import { createBusinessService } from '../.test-build/packages/ai/src/services/business-service.js';
import { LocalSecretProvider, AuthorizationPolicy, AICostGuard, DEFAULT_AI_LIMITS, assertLocalEnvFile, redact, SecurityError } from '../.test-build/packages/security/src/index.js';

try {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) { assertLocalEnvFile(envPath, process.env.NODE_ENV ?? 'development'); loadEnvFile(envPath); }
  const config = readOpenAIConfig(process.env);
  if (!process.argv.includes('--confirm-paid-request')) {
    console.error('Запрос не отправлен. Для одного реального вызова: npm run smoke:business -- --confirm-paid-request');
    process.exitCode = 1;
  } else {
    const environment = process.env.NODE_ENV ?? 'development';
    if (!['development', 'test'].includes(environment)) throw new SecurityError('SECRET_UNAVAILABLE');
    const context = { projectId: 'kleo-local-smoke', organizationId: 'local', workflowId: 'manual-smoke', actor: { id: 'local-owner', authenticated: true } };
    const credentials = { id: 'local-openai', projectId: context.projectId, organizationId: context.organizationId, provider: 'openai', secretRef: 'local/openai' };
    const authorization = new AuthorizationPolicy([{ ...context, actorId: context.actor.id, role: 'owner' }]);
    const costs = new AICostGuard({ ...DEFAULT_AI_LIMITS, maxConcurrent: 1, maxRequestsPerWorkflow: 1, maxOutputTokens: config.maxOutputTokens, maxWorkflowOutputTokens: config.maxOutputTokens });
    const secrets = new LocalSecretProvider([{ ...credentials, value: config.apiKey }], environment);
    const agent = await createBusinessService({ context, credentials, secrets, authorization, costs,
      config: { model: config.model, timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens } });
    const result = await agent.run({ projectId: 'kleo-local-smoke', goal: 'Подготовить профиль для страницы с запросом расчёта.', input: {
      companyName: 'Учебный пример Kleo', description: 'Учебная компания: изготовление стеклянных перегородок и душевых ограждений на заказ.',
      industry: 'Стеклянные конструкции', productsOrServices: ['Стеклянные перегородки', 'Душевые ограждения'],
      targetAudience: ['Владельцы квартир'], websiteGoals: ['Получение запросов на расчёт'], desiredActions: ['Запросить расчёт'],
    } });
    if (!result.success) {
      console.error(JSON.stringify(redact({ error: result.error, code: result.errorCode, missingFields: result.missingFields, usage: result.execution?.usage }, [config.apiKey]), null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(redact({ profile: result.output, usage: result.execution?.usage }, [config.apiKey]), null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof SecurityError ? 'Проверьте локальный режим и права .env: файл должен принадлежать вам и иметь права 600 (chmod 600 .env).' : error instanceof AIProviderError ? error.message : 'Не удалось запустить проверку. Проверьте локальный .env и установленные зависимости.');
  process.exitCode = 1;
}
