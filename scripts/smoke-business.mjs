import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { AIProviderError } from '../.test-build/packages/ai/src/providers/errors.js';
import { readOpenAIConfig } from '../.test-build/packages/ai/src/providers/config.js';
import { OpenAIProvider } from '../.test-build/packages/ai/src/providers/openai-provider.js';
import { DefaultBusinessAgent } from '../.test-build/packages/ai/src/agents/default-business-agent.js';

try {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  const config = readOpenAIConfig(process.env);
  if (!process.argv.includes('--confirm-paid-request')) {
    console.error('Запрос не отправлен. Для одного реального вызова: npm run smoke:business -- --confirm-paid-request');
    process.exitCode = 1;
  } else {
    const agent = new DefaultBusinessAgent(new OpenAIProvider(config), config.model);
    const result = await agent.run({ projectId: 'kleo-local-smoke', goal: 'Подготовить профиль для страницы с запросом расчёта.', input: {
      companyName: 'Учебный пример Kleo', description: 'Учебная компания: изготовление стеклянных перегородок и душевых ограждений на заказ.',
      industry: 'Стеклянные конструкции', productsOrServices: ['Стеклянные перегородки', 'Душевые ограждения'],
      targetAudience: ['Владельцы квартир'], websiteGoals: ['Получение запросов на расчёт'], desiredActions: ['Запросить расчёт'],
    } });
    if (!result.success) {
      console.error(JSON.stringify({ error: result.error, code: result.errorCode, missingFields: result.missingFields, usage: result.execution?.usage }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ profile: result.output, usage: result.execution?.usage }, null, 2));
    }
  }
} catch (error) {
  console.error(error instanceof AIProviderError ? error.message : 'Не удалось запустить проверку. Проверьте локальный .env и установленные зависимости.');
  process.exitCode = 1;
}
