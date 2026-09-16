import type { AIAgent } from '../agent.js';
import type { QAAgentInput } from '../contracts/qa-agent-input.js';
import type { QAReport } from '../contracts/qa-report.js';

export interface QAAgent
  extends AIAgent<QAAgentInput, QAReport> {
  type: 'qa';
  readonly requiresReviewContext?: boolean;
}
