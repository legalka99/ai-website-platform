import { validateQAReport } from '../validation/qa-report-validator.js';
import { validateDeveloperOutput } from '../validation/developer-output-validator.js';
import { validateContentPlan } from '../validation/content-plan-validator.js';
import { validateDesignDirection } from '../validation/design-direction-validator.js';
import type { AgentType } from '../agent.js';
import type { ValidationIssue, ValidationResult } from './validation.js';

type Rule = (value: unknown, path: string, issues: ValidationIssue[]) => void;
const issue = (issues: ValidationIssue[], field: string, message: string, code = 'INVALID_OUTPUT') => {
  issues.push({ code, field, message });
};
const text: Rule = (value, path, issues) => {
  if (typeof value !== 'string' || !value.trim()) issue(issues, path, 'Expected non-empty text.');
};
const optional = (rule: Rule): Rule => (value, path, issues) => {
  if (value !== undefined) rule(value, path, issues);
};
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const record: Rule = (value, path, issues) => {
  if (!isObject(value)) issue(issues, path, 'Expected an object.');
};
const object = (fields: Record<string, Rule>): Rule => (value, path, issues) => {
  if (!isObject(value)) { record(value, path, issues); return; }
  for (const [key, rule] of Object.entries(fields)) rule(value[key], `${path}.${key}`, issues);
};
const array = (rule: Rule, min = 0): Rule => (value, path, issues) => {
  if (!Array.isArray(value)) { issue(issues, path, 'Expected an array.'); return; }
  if (value.length < min) issue(issues, path, `Expected at least ${min} item(s).`);
  for (let index = 0; index < value.length; index++) rule(value[index], `${path}[${index}]`, issues);
};
const rules: Record<Exclude<AgentType,'developer'|'qa'>, Rule> = {
  business: object({
    companyName: text, industry: text, description: text, productsOrServices: array(text, 1), targetAudience: array(text, 1),
    geography: optional(array(text)), advantages: optional(array(text)), websiteGoals: array(text, 1),
    desiredActions: array(text, 1), competitors: optional(array(text)), notes: optional(text),
  }),
  design: (value, _path, issues) => { issues.push(...validateDesignDirection(value).issues); },
  content: (value, _path, issues) => { issues.push(...validateContentPlan(value).issues); },

};

/** Runtime boundary for agent responses. This verifies data, not visual quality or business facts. */
export function validateWebsiteAgentOutput(stage: AgentType, output: unknown, projectId: string): ValidationResult {
  if(stage==='qa')return validateQAReport(output);
  if(stage==='developer') return validateDeveloperOutput(output,projectId);
  const issues: ValidationIssue[] = [];
  rules[stage](output, stage, issues);
  if (issues.length || !isObject(output)) return { valid: false, issues };

  return { valid: issues.length === 0, issues };
}
