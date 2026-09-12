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
  error?: string;
}
