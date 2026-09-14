import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWebsiteAgentOutput as validate } from '../.test-build/packages/ai/src/orchestrator/website-result-validator.js';
import { validOutputs } from './fixtures/website.mjs';

test('accepts complete valid responses, including omitted optional fields', () => {
  for (const [stage, value] of Object.entries(validOutputs())) assert.deepEqual(validate(stage, value, 'project-1'), { valid: true, issues: [] });
});
test('rejects non-object and empty responses for each stage without throwing', () => {
  for (const stage of Object.keys(validOutputs())) for (const value of [undefined, null, [], {}, 'text', 7]) assert.equal(validate(stage, value, 'project-1').valid, false);
});
const cases = [
  ['business', value => { value.targetAudience = []; }, 'business.targetAudience'],
  ['business', value => { value.companyName = '  '; }, 'business.companyName'],
  ['design', value => { value.colors.text = null; }, 'design.colors.text'],
  ['content', value => { value.sections[0].purpose = 42; }, 'content.sections[0].purpose'],
  ['developer', value => { value.website.pages = []; }, 'developer.website.pages'],
  ['developer', value => { value.website.pages[0].blocks[0].type = 'unsupported'; }, 'developer.website.pages[0].blocks[0].type'],
  ['developer', value => { value.website.pages[0].blocks[0].visible = 'yes'; }, 'developer.website.pages[0].blocks[0].visible'],
  ['developer', value => { value.website.designSystem.typography.baseFontSize = Infinity; }, 'developer.website.designSystem.typography.baseFontSize'],
  ['developer', value => { value.website.projectId = 'other'; }, 'developer.website.projectId'],
  ['developer', value => { value.website.status = 'published'; }, 'developer.website.status'],
  ['developer', value => { value.website.pages[0].status = 'published'; }, 'developer.website.pages[0].status'],
  ['developer', value => { value.website.pages.push(structuredClone(value.website.pages[0])); }, 'developer.website.pages[1].id'],
  ['developer', value => { const copy = structuredClone(value.website.pages[0]); copy.id = 'page-2'; copy.blocks[0].id = 'hero-2'; value.website.pages.push(copy); }, 'developer.website.pages[1].slug'],
  ['developer', value => { value.website.pages[0].blocks.push(structuredClone(value.website.pages[0].blocks[0])); }, 'developer.website.pages[0].blocks[1].id'],
  ['developer', value => { value.generatedAt = 'yesterday'; }, 'developer.generatedAt'],
  ['qa', value => { value.passed = 'true'; }, 'qa.passed'],
  ['qa', value => { value.score = 101; }, 'qa.score'],
  ['qa', value => { value.score = NaN; }, 'qa.score'],
  ['qa', value => { value.issues = [{ code: 'BROKEN', severity: 'error', message: 'Broken page' }]; }, 'qa.passed'],
];
for (const [stage, mutate, field] of cases) test(`rejects invalid ${field}`, () => {
  const output = validOutputs()[stage];
  mutate(output);
  const result = validate(stage, output, 'project-1');
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.field === field));
});
test('accepts a failed QA report and nonblocking warnings', () => {
  assert.equal(validate('qa', validOutputs(false).qa, 'project-1').valid, true);
  const qa = validOutputs().qa;
  qa.issues.push({ code: 'OPTIONAL', severity: 'warning', message: 'Add a portfolio when available' });
  assert.equal(validate('qa', qa, 'project-1').valid, true);
});
