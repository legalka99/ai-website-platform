import { validateContentGrounding } from '../validation/content-grounding-validator.js';
import type { ContentPlan } from '../contracts/content-plan.js';
import type { AIAgent, AgentType } from '../agent.js';
import { validateWebsiteAgentOutput } from './website-result-validator.js';
import type { WebsiteWorkflowState } from '../contracts/website-workflow-state.js';
import type { WebsiteWorkflowAgents, WebsiteWorkflowResult, WebsiteWorkflowTask } from './website-workflow-types.js';

export class WebsiteWorkflowOrchestrator {
  constructor(private readonly agents: WebsiteWorkflowAgents) {}

  async run(task: WebsiteWorkflowTask): Promise<WebsiteWorkflowResult> {
    const state: WebsiteWorkflowState = {};
    const executions: NonNullable<WebsiteWorkflowResult['executions']> = {};
    let stage = 'business';
    const execute = async <I extends object, O extends object>(expectedStage: AgentType, agent: AIAgent<I, O>, input: I): Promise<O> => {
      stage = expectedStage;
      if (agent.type !== expectedStage) throw new Error('Agent role does not match the workflow stage');
      const result = await agent.run({ projectId: task.projectId, goal: task.goal, input });
      if (result?.execution) executions[expectedStage] = result.execution;
      if (!result || result.success !== true) throw new Error(result?.error || 'Agent failed');
      const validation = validateWebsiteAgentOutput(expectedStage, result.output, task.projectId);
      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.issues.map(issue => `${issue.field}: ${issue.message}`).join('; ')}`);
      }
      if(expectedStage==='content' && state.business && state.design) {
        const grounding=validateContentGrounding(result.output as ContentPlan,{business:state.business,design:state.design});
        if(grounding) throw new Error(`Content validation failed: ${grounding.stage} ${grounding.path} ${grounding.rule}`);
      }
      return result.output;
    };

    try {
      state.business = await execute('business', this.agents.business, task.input);
      state.design = await execute('design', this.agents.design, state.business);
      state.content = await execute('content', this.agents.content, { business: state.business, design: state.design });
      state.developer = await execute('developer', this.agents.developer, {
        business: state.business, design: state.design, content: state.content,
      });
      state.qa = await execute('qa', this.agents.qa, state.developer);
      if (!state.qa.passed) return { success: false, state, executions, error: 'qa: Website did not pass quality checks' };
      return { success: true, state, executions };
    } catch (error) {
      return { success: false, state, executions, error: `${stage}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
