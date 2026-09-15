import type { AIAgent } from '../agent.js';
import type { DesignAgentInput } from '../contracts/design-agent-input.js';
import type { DesignDirection } from '../contracts/design-direction.js';

export interface DesignAgent
  extends AIAgent<DesignAgentInput, DesignDirection> {
  type: 'design';
}
