import type { AIAgent, AgentContext, AgentResult } from '../agent.js';

export interface OrchestratorTask {
  projectId: string;
  goal: string;
  input: Record<string, unknown>;
}

export interface AgentStep {
  agent: AIAgent;
  context: AgentContext;
}

export interface OrchestratorResult {
  success: boolean;
  output: Record<string, unknown>;
  steps: AgentResult[];
  error?: string;
}

export interface Orchestrator {
  run(task: OrchestratorTask): Promise<OrchestratorResult>;
}
