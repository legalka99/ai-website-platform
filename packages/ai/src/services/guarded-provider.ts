import type { AgentType } from '../agent.js';
import { AIProviderError } from '../providers/errors.js';
import type { AIProvider, AIRequest, AIResponse } from '../provider.js';
import type { Actor, AuthorizationPolicy, ProjectResource } from '../../../security/src/authorization.js';
import type { AICostGuard } from '../../../security/src/rate-limit.js';
import { SecurityError } from '../../../security/src/errors.js';
export interface AIServiceContext extends ProjectResource { actor: Actor; workflowId: string }
/** Server composition boundary. Agents receive only generate(); no SecretProvider/env/tool capability. */
export class GuardedAIProvider implements AIProvider {
  #provider: AIProvider; #context: AIServiceContext;
  constructor(provider: AIProvider, context: AIServiceContext, private readonly authorization: AuthorizationPolicy,
    private readonly costs: AICostGuard, private readonly maxOutputTokens: number, private readonly agentType?: AgentType) {
    this.#provider = provider; this.#context = { ...context, actor: { ...context.actor } };
  }
  async generate(request: AIRequest): Promise<AIResponse> {
    if (request.context?.projectId !== this.#context.projectId || !this.authorization.authorize(this.#context.actor, 'generate', this.#context)) throw new SecurityError('ACCESS_DENIED');
    const tokens = request.maxTokens ?? this.maxOutputTokens;
    if (tokens > this.maxOutputTokens) throw new SecurityError('LIMIT_EXCEEDED');
    const reservation = this.costs.reserve(this.#context.projectId, this.#context.workflowId, tokens);
    const scope = { projectId: this.#context.projectId, workflowId: this.#context.workflowId,
      actorId: this.#context.actor.id, organizationId: this.#context.organizationId, agentType: this.agentType };
    try {
      const response = await this.#provider.generate({ ...request, maxTokens: tokens });
      return { ...response, budget: reservation.budget,
        usageRecord: response.usageRecord ? { ...response.usageRecord, ...scope } : undefined };
    } catch (error) {
      if (error instanceof AIProviderError) throw new AIProviderError(error.code, error.usage ? {...error.usage, ...scope} : undefined, error.diagnostic);
      if (error instanceof SecurityError) throw error;
      throw new AIProviderError('API_ERROR');
    } finally { reservation.release(); }
  }
}
