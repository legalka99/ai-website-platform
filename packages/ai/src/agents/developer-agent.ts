import type { AIAgent } from '../agent.js';
import type { DeveloperAgentInput } from '../contracts/developer-agent-input.js';
import type { DeveloperOutput } from '../contracts/developer-output.js';

export interface DeveloperAgent
  extends AIAgent<DeveloperAgentInput, DeveloperOutput> {
  type: 'developer';
}
