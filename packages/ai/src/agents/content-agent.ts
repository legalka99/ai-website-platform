import type { AIAgent } from '../agent.js';
import type { ContentAgentInput } from '../contracts/content-agent-input.js';
import type { ContentPlan } from '../contracts/content-plan.js';

export interface ContentAgent
  extends AIAgent<ContentAgentInput, ContentPlan> {
  type: 'content';
}
