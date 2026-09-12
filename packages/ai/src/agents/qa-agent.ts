import type { AIAgent } from '../agent.js';
import type { DeveloperOutput } from '../contracts/developer-output.js';
import type { QAReport } from '../contracts/qa-report.js';

export interface QAAgent
  extends AIAgent<DeveloperOutput, QAReport> {
  type: 'qa';
}
