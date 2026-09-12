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

export interface AgentResult<
  TOutput extends object = Record<string, unknown>,
> {
  success: boolean;
  output: TOutput;
  error?: string;
}

export interface AIAgent<
  TInput extends object = Record<string, unknown>,
  TOutput extends object = Record<string, unknown>,
> {
  type: AgentType;
  run(context: AgentContext<TInput>): Promise<AgentResult<TOutput>>;
}
