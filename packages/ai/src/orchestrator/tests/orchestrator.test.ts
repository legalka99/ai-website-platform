import type { AIAgent, AgentContext, AgentResult } from '../../agent.js';
import { DefaultOrchestrator } from '../orchestrator.js';
import { DefaultResultValidator } from '../default-validator.js';

class TestAgent implements AIAgent {
  public readonly type: AIAgent['type'];
  private readonly output: Record<string, unknown>;

  constructor(
    type: AIAgent['type'],
    output: Record<string, unknown>,
  ) {
    this.type = type;
    this.output = output;
  }

  async run(_context: AgentContext): Promise<AgentResult> {
    return {
      success: true,
      output: this.output,
    };
  }
}

async function runTest() {
  const validAgent = new TestAgent('business', {
    businessName: 'Test Company',
  });

  const invalidAgent = new TestAgent('design', {});

  const orchestrator = new DefaultOrchestrator(
    [
      {
        agent: validAgent,
      },
      {
        agent: invalidAgent,
      },
    ],
    new DefaultResultValidator(),
  );

  const result = await orchestrator.run({
    projectId: 'test-project',
    goal: 'Test validation',
    input: {
      company: 'Test Company',
    },
  });

  if (result.success) {
    throw new Error('Test failed: invalid result was accepted.');
  }

  if (!result.error?.startsWith('Validation failed:')) {
    throw new Error('Test failed: validation error was not returned.');
  }

  console.log('Validation test passed.');
  console.log(result.error);
}

runTest().catch((error) => {
  throw error;
});
