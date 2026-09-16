import { safeDeveloperValidationError, type DeveloperValidationError } from '../contracts/developer-validation-error.js';
import { validateDeveloperReuse } from '../validation/developer-output-validator.js';
import type { DeveloperAgentInput } from '../contracts/developer-agent-input.js';
import type { DeveloperOutput } from '../contracts/developer-output.js';
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
    let validationError:DeveloperValidationError|undefined;
    const execute = async <I extends object, O extends object>(expectedStage: AgentType, agent: AIAgent<I, O>, input: I): Promise<O> => {
      stage = expectedStage;
      if (agent.type !== expectedStage) throw new Error('Agent role does not match the workflow stage');
      if(task.signal?.aborted)throw new Error('Workflow cancelled');
      const developerSource=expectedStage==='developer'?structuredClone(input) as unknown as DeveloperAgentInput:undefined;
      let result;
      try {result = await agent.run({ projectId: task.projectId, goal: task.goal, input:expectedStage==='developer'?structuredClone(input):input, ...(task.signal?{signal:task.signal}:{}) });}
      catch(error) {if(expectedStage==='developer')throw new Error('Developer execution failed');throw error;}
      if (result?.execution) executions[expectedStage] = result.execution;
      if(task.signal?.aborted)throw new Error('Workflow cancelled');
      if (!result || result.success !== true) {
        if(expectedStage==='developer')validationError=safeDeveloperValidationError(result?.validationError);
        throw new Error(expectedStage==='developer'?'Developer failed':result?.error || 'Agent failed');
      }
      const validation = validateWebsiteAgentOutput(expectedStage, result.output, task.projectId);
      if (!validation.valid) {
        if(expectedStage==='developer')validationError=safeDeveloperValidationError({stage:'developer-website',path:validation.issues[0]?.field?.replace(/^developer\./,'')??'$',rule:'WEBSITE_INVALID'})??{stage:'developer-website',path:'$',rule:'WEBSITE_INVALID'};
        throw new Error(`Validation failed: ${validation.issues.map(issue => `${issue.field}: ${issue.message}`).join('; ')}`);
      }
      if(expectedStage==='content' && state.business && state.design) {
        const grounding=validateContentGrounding(result.output as ContentPlan,{business:state.business,design:state.design});
        if(grounding) throw new Error(`Content validation failed: ${grounding.stage} ${grounding.path} ${grounding.rule}`);
      }
      if(developerSource && !validateDeveloperReuse(result.output as DeveloperOutput,developerSource)) {
        validationError={stage:'developer-grounding',path:'$',rule:'COPY_MISMATCH'};
        throw new Error('Developer copy validation failed');
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
      if(stage==='developer') {
        // Covers failures before/after agent.run too (e.g. snapshot failures).
        // Never forward an unexpected exception's message from this boundary.
        const known=['Developer failed','Developer execution failed','Workflow cancelled','Developer copy validation failed'];
        const message=error instanceof Error&&known.includes(error.message)?error.message:validationError?'Validation failed: Developer output violates the safe Website contract.':'Developer execution failed';
        return {success:false,state,executions,...(validationError?{validationError}:{}),error:`developer: ${message}`};
      }
      return { success: false, state, executions, ...(validationError?{validationError}:{}), error: `${stage}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
