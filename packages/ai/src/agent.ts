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
  metadata?: Record<string, unknown>;
}

export type AgentResult<
  TOutput extends object = Record<string, unknown>,
> = ({ success: true; output: TOutput; error?: never } | {
  success: false; output?: TOutput; error: string; errorCode?: string; missingFields?: string[];
}) & {
  execution?: { projectId: string; goal: string; usage?: import('./provider.js').AIUsageRecord; budget?: import('../../security/src/rate-limit.js').AIBudgetMetadata };
};

export interface AIAgent<
  TInput extends object = Record<string, unknown>,
  TOutput extends object = Record<string, unknown>,
> {
  type: AgentType;
  run(context: AgentContext<TInput>): Promise<AgentResult<TOutput>>;
}
