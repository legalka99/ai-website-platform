export type AgentType =
  | 'business'
  | 'design'
  | 'content'
  | 'developer'
  | 'qa';

export interface AgentContext {
  projectId: string;
  input: Record<string, unknown>;
}

export interface AgentResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export interface AIAgent {
  type: AgentType;
  run(context: AgentContext): Promise<AgentResult>;
}
