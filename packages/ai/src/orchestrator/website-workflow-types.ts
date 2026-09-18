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
  signal?: AbortSignal;
  /** Trusted server persistence observer; never sourced from user input. */
  onStage?: (stage: import('../agent.js').AgentType, phase: 'started' | 'completed', execution?: import('../agent.js').AgentResult['execution']) => Promise<void>;
  /** Trusted server argument, never a model output or request-body evidence. */
  confirmedBusinessFacts?: import('../../../core/src/confirmed-business-facts.js').ConfirmedBusinessFacts;
  input: Record<string, unknown>;
}

export interface WebsiteWorkflowResult {
  success: boolean;
  state: WebsiteWorkflowState;
  /** Local per-stage telemetry; optional for backward compatibility, no persistence implied. */
  executions?: Partial<Record<import('../agent.js').AgentType, NonNullable<import('../agent.js').AgentResult['execution']>>>;
  /** Optional safe agent failure only; legacy callers may omit it. */
  stageError?: import('../contracts/stage-error.js').StageError;
  error?: string;
  validationError?: import('../contracts/content-validation-error.js').ContentValidationError | import('../contracts/developer-validation-error.js').DeveloperValidationError | import('../contracts/qa-validation-error.js').QAValidationError;
}
