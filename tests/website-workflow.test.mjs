import test from 'node:test';
import assert from 'node:assert/strict';
import { WebsiteWorkflowOrchestrator } from '../.test-build/packages/ai/src/orchestrator/website-workflow-orchestrator.js';
import { validOutputs } from './fixtures/website.mjs';

const stages = ['business', 'design', 'content', 'developer', 'qa'];
const task = { projectId: 'project-1', goal: 'Create website', input: { companyName: 'Example' } };
function fixture(failure, throws = false, passed = true) {
  const calls = [];
  const outputs = validOutputs(passed);
  const agents = Object.fromEntries(stages.map(type => [type, { type, async run(context) {
    calls.push({ type, context });
    if (type === failure && throws) throw new Error('Unavailable');
    const output = type === 'developer' ? { ...outputs.developer, website: { ...outputs.developer.website, projectId: context.projectId } } : outputs[type];
    return { success: type !== failure, output, error: type === failure ? 'Unavailable' : undefined };
  } }]));
  return { runner: new WebsiteWorkflowOrchestrator(agents), calls, outputs };
}
test('passes all accumulated inputs to the correct stages', async () => {
  const { runner, calls, outputs } = fixture();
  const result = await runner.run(task);
  assert.equal(result.success, true);
  assert.deepEqual(result.state, outputs);
  assert.deepEqual(calls.map(c => c.type), stages);
  assert.deepEqual(calls.map(c => c.context.input), [task.input, outputs.business, { business: outputs.business, design: outputs.design }, { business: outputs.business, design: outputs.design, content: outputs.content }, outputs.developer]);
  for (const { context } of calls) { assert.equal(context.projectId, task.projectId); assert.equal(context.goal, task.goal); }
});
for (const stage of stages) for (const throws of [false, true]) {
  test(`stops and preserves previous results on ${stage} ${throws ? 'exception' : 'failure'}`, async () => {
    const { runner, calls, outputs } = fixture(stage, throws);
    const result = await runner.run(task);
    const index = stages.indexOf(stage);
    assert.equal(result.success, false);
    assert.equal(result.error, `${stage}: Unavailable`);
    assert.deepEqual(calls.map(c => c.type), stages.slice(0, index + 1));
    assert.deepEqual(result.state, Object.fromEntries(stages.slice(0, index).map(key => [key, outputs[key]])));
  });
}
test('retains rejected QA report and does not report success', async () => {
  const { runner } = fixture(undefined, false, false);
  const result = await runner.run(task);
  assert.equal(result.success, false);
  assert.equal(result.state.qa.passed, false);
});
test('separate runs have independent state', async () => {
  const { runner } = fixture();
  const [a, b] = await Promise.all([runner.run(task), runner.run({ ...task, projectId: 'project-2' })]);
  assert.notEqual(a.state, b.state);
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  assert.equal(a.state.developer.website.projectId, 'project-1');
  assert.equal(b.state.developer.website.projectId, 'project-2');
});

for (const stage of stages) {
  test(`rejects malformed ${stage} output before calling the next agent`, async () => {
    const { runner, outputs, calls } = fixture();
    delete outputs[stage][Object.keys(outputs[stage])[0]];
    const result = await runner.run(task);
    assert.equal(result.success, false);
    assert.match(result.error, new RegExp(`^${stage}: Validation failed:`));
    assert.equal(calls.length, stages.indexOf(stage) + 1);
    assert.deepEqual(Object.keys(result.state), stages.slice(0, stages.indexOf(stage)));
  });
}

test('rejects a contradictory passing QA report', async () => {
  const { runner, outputs } = fixture();
  outputs.qa.issues.push({ code: 'BROKEN', severity: 'critical', message: 'Cannot use website' });
  const result = await runner.run(task);
  assert.equal(result.success, false);
  assert.match(result.error, /qa: Validation failed: qa.passed/);
  assert.ok(result.state.developer);
  assert.equal(result.state.qa, undefined);
});
