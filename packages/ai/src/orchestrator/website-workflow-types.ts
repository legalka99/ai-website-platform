import type {
  BusinessAgent,
  ContentAgent,
  DesignAgent,
  DeveloperAgent,
  QAAgent,
} from '../agents/index.js';
import type { WebsiteWorkflowState } from '../contracts/website-workflow-state.js';

export interface WebsiteWorkflowAgents {
  business: BusinessAgent;
  design: DesignAgent;
  content: ContentAgent;
  developer: DeveloperAgent;
  qa: QAAgent;
}

export interface WebsiteWorkflowTask {
  projectId: string;
  goal: string;
  input: Record<string, unknown>;
}

export interface WebsiteWorkflowResult {
  success: boolean;
  state: WebsiteWorkflowState;
  /** Local per-stage telemetry; optional for backward compatibility, no persistence implied. */
  executions?: Partial<Record<import('../agent.js').AgentType, NonNullable<import('../agent.js').AgentResult['execution']>>>;
  error?: string;
}
