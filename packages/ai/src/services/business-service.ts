import { DefaultBusinessAgent } from '../agents/default-business-agent.js';
import { OpenAIProvider } from '../providers/openai-provider.js';
import type { OpenAIProviderConfig } from '../providers/config.js';
import { AIProviderError } from '../providers/errors.js';
import { GuardedAIProvider, type AIServiceContext } from './guarded-provider.js';
import type { SecretProvider, IntegrationCredentialRef } from '../../../security/src/secrets.js';
import type { AuthorizationPolicy } from '../../../security/src/authorization.js';
import type { AICostGuard } from '../../../security/src/rate-limit.js';
import { SecurityError } from '../../../security/src/errors.js';
/** Trusted server wiring only; never called with actor/credential references supplied by the model. */
export async function createBusinessService(options: { context: AIServiceContext; authorization: AuthorizationPolicy; costs: AICostGuard;
  credentials: IntegrationCredentialRef; secrets: SecretProvider; config: Omit<OpenAIProviderConfig, 'apiKey'>; transport?: typeof fetch }): Promise<DefaultBusinessAgent> {
  const { context, credentials, authorization, secrets, config, costs } = options;
  if (!authorization.authorize(context.actor, 'generate', context) || credentials.provider !== 'openai' ||
    credentials.projectId !== context.projectId || credentials.organizationId !== context.organizationId) throw new SecurityError('ACCESS_DENIED');
  let key: string;
  try { key = await secrets.resolve(credentials); } catch { throw new AIProviderError('AUTH'); }
  const provider = new OpenAIProvider({ ...config, apiKey: key }, options.transport);
  return new DefaultBusinessAgent(new GuardedAIProvider(provider, context, authorization, costs, config.maxOutputTokens), config.model);
}
