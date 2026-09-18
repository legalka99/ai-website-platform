export type AgentType =
  | 'business'
  | 'design'
  | 'content'
  | 'developer'
  | 'qa';

export interface AgentContext<
  TInput extends object = Record<string, unknown>,
> {
  projectId: string;
  goal: string;
  input: TInput;
  confirmedBusinessFacts?: import('../../core/src/confirmed-business-facts.js').ConfirmedBusinessFacts;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type AgentResult<
  TOutput extends object = Record<string, unknown>,
> = ({ success: true; output: TOutput; error?: never } | {
  success: false; validationError?: import('./contracts/content-validation-error.js').ContentValidationError | import('./contracts/developer-validation-error.js').DeveloperValidationError | import('./contracts/qa-validation-error.js').QAValidationError; output?: TOutput; error: string; errorCode?: string; missingFields?: string[];
}) & {
  execution?: { designDiagnostic?: import('./contracts/design-diagnostic.js').DesignDiagnostic; routing?: import('./router/types.js').RoutingRecord; projectId: string; goal: string; usage?: import('./provider.js').AIUsageRecord; budget?: import('../../security/src/rate-limit.js').AIBudgetMetadata };
};

export interface AIAgent<
  TInput extends object = Record<string, unknown>,
  TOutput extends object = Record<string, unknown>,
> {
  type: AgentType;
  run(context: AgentContext<TInput>): Promise<AgentResult<TOutput>>;
}
