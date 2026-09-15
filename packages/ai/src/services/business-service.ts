import type { DefaultBusinessAgent } from '../agents/default-business-agent.js';
import type { OpenAIProviderConfig } from '../providers/config.js';
import type { AIServiceContext } from './guarded-provider.js';
import type { SecretProvider, IntegrationCredentialRef } from '../../../security/src/secrets.js';
import type { AuthorizationPolicy } from '../../../security/src/authorization.js';
import type { AICostGuard } from '../../../security/src/rate-limit.js';
import { createRoutedBusinessService } from './routed-business-service.js';
/** Backward-compatible OpenAI-only server entry. The agent receives no concrete model. */
export async function createBusinessService(options: { context: AIServiceContext; authorization: AuthorizationPolicy; costs: AICostGuard;
  credentials: IntegrationCredentialRef; secrets: SecretProvider; config: Omit<OpenAIProviderConfig, 'apiKey'>; transport?: typeof fetch }): Promise<DefaultBusinessAgent> {
  return createRoutedBusinessService({...options,providers:[{id:'openai',config:options.config,credentials:options.credentials,transport:options.transport}],
    policy:{id:'openai-business',version:'1',maxAttempts:1,tasks:{business:{preferred:'openai',required:['structuredOutput']}}}});
}
