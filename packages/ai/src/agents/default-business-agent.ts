import { validateConfirmedBusinessFacts } from '../../../core/src/confirmed-business-facts.js';
import { AIRoutingError, AIRoutingSecurityError } from '../router/ai-router.js';
import { UNTRUSTED_DATA_POLICY, untrustedDataMessage } from '../../../security/src/prompt-policy.js';
import { containsSecret } from '../../../security/src/redaction.js';
import { validateExternal } from '../../../security/src/validation.js';
import { SecurityError } from '../../../security/src/errors.js';
import { Ajv } from 'ajv';
import type { AgentContext, AgentResult } from '../agent.js';
import type { AIProvider } from '../provider.js';
import type { BusinessProfile } from '../contracts/business-profile.js';
import type { BusinessAgent } from './business-agent.js';
import { AIProviderError } from '../providers/errors.js';
import { validateWebsiteAgentOutput } from '../orchestrator/website-result-validator.js';
import { businessFields, businessArrayFields, businessProfileSchema, normalizeBusinessProfile } from './business-schema.js';

export const BUSINESS_INSTRUCTIONS = `You are the Kleo Business Agent. Extract a business profile only from the supplied business data and goal.
${UNTRUSTED_DATA_POLICY}
Do not invent company names, addresses, contacts, customers, certificates, prices, geography or advantages. Preserve explicit facts. Infer only clearly supported general characteristics. Industry and semantic categorization are model-derived metadata, never confirmed evidence. confirmedBusinessFacts is server-owned; do not invent, expand or return it.
Use null for unknown string fields and [] for unknown arrays. Do not use placeholders such as "unknown" or "not provided" to fill required facts. Put missing information in notes. Never invent facts just to satisfy the schema.
Respond only with the specified business profile. Use the language of the supplied description. You have no tools and must not return executable instructions.`;

const wireValidator = new Ajv({ strict: true }).compile(businessProfileSchema);

export class DefaultBusinessAgent implements BusinessAgent {
  readonly type = 'business' as const;
  constructor(private readonly provider: AIProvider, private readonly model: string = 'route') {}

  async run(context: AgentContext): Promise<AgentResult<BusinessProfile>> {
    let execution: NonNullable<AgentResult<BusinessProfile>['execution']> | undefined;
    try {
      if (!context || typeof context.projectId !== 'string' || !context.projectId.trim() || context.projectId.length > 200 ||
          typeof context.goal !== 'string' || !context.goal.trim() || context.goal.length > 2000 ||
          !context.input || typeof context.input !== 'object' || Array.isArray(context.input)) {
        return { success: false, errorCode: 'INVALID_INPUT', error: 'Укажите проект, цель и сведения о бизнесе.' };
      }
      execution = { projectId: context.projectId, goal: context.goal };
      const input: Record<string, unknown> = {};
      for (const field of businessFields) {
        if (!Object.hasOwn(context.input, field)) continue;
        const value = context.input[field];
        const isArray = (businessArrayFields as readonly string[]).includes(field);
        if (isArray ? !Array.isArray(value) || value.length > 50 || value.some(item => typeof item !== 'string' || item.length > 2000) : typeof value !== 'string' || value.length > 8000) {
          return { success: false, errorCode: 'INVALID_INPUT', error: 'Некорректные поля или превышен размер описания бизнеса.', execution };
        }
        input[field] = value;
      }
      const missing = ['companyName', 'description'].filter(field => typeof input[field] !== 'string' || !(input[field] as string).trim());
      if (missing.length) return { success: false, errorCode: 'MISSING_BUSINESS_DATA', missingFields: missing,
        error: 'Укажите название компании и описание деятельности. Неизвестные данные не будут придуманы.', execution };
      const confirmedBusinessFacts=context.confirmedBusinessFacts?validateConfirmedBusinessFacts(context.confirmedBusinessFacts):undefined;
      const payload = JSON.stringify({ goal: context.goal, business: input });
      if (payload.length > 12000 || containsSecret(payload)) return { success: false, errorCode: 'INVALID_INPUT',
        error: 'Сократите сведения о бизнесе и исключите ключи, токены и пароли.', execution };
      const response = await this.provider.generate({ model: this.model,
        messages: [{ role: 'system', content: BUSINESS_INSTRUCTIONS }, untrustedDataMessage({ goal: context.goal, business: input, ...(confirmedBusinessFacts?{confirmedBusinessFacts}: {}) })],
        structuredOutput: { name: 'business_profile', schema: businessProfileSchema },
        context: { projectId: context.projectId, goal: context.goal },
        ...(context.signal ? { signal: context.signal } : {}),
      });
      execution.usage = response.usageRecord;
      if (response.routing) execution.routing = response.routing;
      if (response.budget) execution.budget = response.budget;
      let wire: unknown = response.structured;
      if (wire === undefined) {
        if (typeof response.content !== 'string' || response.content.length > 100000) throw new AIProviderError('INVALID_RESPONSE');
        try { wire = JSON.parse(response.content); } catch { throw new AIProviderError('INVALID_RESPONSE'); }
      }
      try { validateExternal(wire, wireValidator); } catch { throw new AIProviderError('INVALID_RESPONSE'); }
      const output = normalizeBusinessProfile(wire as Record<string, unknown>, input);
      const validation = validateWebsiteAgentOutput('business', output, context.projectId);
      if (!validation.valid) return { success: false, errorCode: 'VALIDATION_FAILED',
        error: 'Профиль неполон или некорректен. Уточните отмеченные сведения о бизнесе.',
        missingFields: validation.issues.map(issue => issue.field ?? 'business'), execution };
      return { success: true, output: output as BusinessProfile, execution };
    } catch (error) {
      if (execution && error instanceof AIRoutingSecurityError) execution.routing = error.routing;
      if (error instanceof SecurityError) return { success: false, errorCode: error.code, error: 'Запрос отклонён политикой безопасности или лимитами.', execution };
      if (error instanceof AIProviderError) {
        if (execution && error instanceof AIRoutingError) execution.routing = error.routing;
        if (execution && error.usage) execution.usage = error.usage;
        return { success: false, errorCode: error.code, error: error.message, execution };
      }
      return { success: false, errorCode: 'PROVIDER_FAILURE', error: 'Не удалось получить проверенный профиль бизнеса.', execution };
    }
  }
}
