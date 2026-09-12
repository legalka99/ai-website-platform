import type { AgentContext, AgentResult } from '../agent.js';
import type {
  AgentStep,
  Orchestrator,
  OrchestratorResult,
  OrchestratorTask,
} from './types.js';

export class DefaultOrchestrator implements Orchestrator {
  constructor(private readonly steps: AgentStep[] = []) {}

  async run(task: OrchestratorTask): Promise<OrchestratorResult> {
    const results: AgentResult[] = [];

    let input = task.input;

    for (const step of this.steps) {
      const context: AgentContext = {
        projectId: task.projectId,
        input,
      };

      const result = await step.agent.run(context);

      results.push(result);

      if (!result.success) {
        return {
          success: false,
          output: input,
          steps: results,
          error: result.error ?? `Agent ${step.agent.type} failed`,
        };
      }

      input = result.output;
    }

    return {
      success: true,
      output: input,
      steps: results,
    };
  }
}
