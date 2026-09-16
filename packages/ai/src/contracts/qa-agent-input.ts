import type { DeveloperOutput } from './developer-output.js';
import type { DeveloperAgentInput } from './developer-agent-input.js';

/** Additive compatibility with existing QA implementations receiving DeveloperOutput.
 * Real QA requires reviewContext; a Website alone cannot establish factual authority. */
export interface QAAgentInput extends DeveloperOutput {
  reviewContext?: DeveloperAgentInput;
}
