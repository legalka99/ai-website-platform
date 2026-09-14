import type { AgentType } from '../agent.js';
import type { ValidationIssue, ValidationResult } from './validation.js';

type Rule = (value: unknown, path: string, issues: ValidationIssue[]) => void;
const issue = (issues: ValidationIssue[], field: string, message: string, code = 'INVALID_OUTPUT') => {
  issues.push({ code, field, message });
};
const text: Rule = (value, path, issues) => {
  if (typeof value !== 'string' || !value.trim()) issue(issues, path, 'Expected non-empty text.');
};
const boolean: Rule = (value, path, issues) => {
  if (typeof value !== 'boolean') issue(issues, path, 'Expected a boolean.');
};
const number = (min: number, max = Infinity, integer = false): Rule => (value, path, issues) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    issue(issues, path, 'Number is outside the allowed range or has the wrong type.');
  }
};
const choice = (...values: string[]): Rule => (value, path, issues) => {
  if (typeof value !== 'string' || !values.includes(value)) issue(issues, path, `Expected one of: ${values.join(', ')}.`);
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
const timestamp: Rule = (value, path, issues) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    issue(issues, path, 'Expected an ISO date and time.');
  }
};
const colors = object({ primary: text, secondary: optional(text), background: text, text, accent: optional(text) });
const block = object({
  id: text, type: choice('hero', 'text', 'image', 'services', 'advantages', 'gallery', 'faq', 'testimonials', 'contacts', 'cta', 'custom'),
  order: number(0, Infinity, true), visible: boolean, content: record, settings: optional(record),
});
const page = object({
  id: text, slug: text, title: text, status: choice('draft', 'published'), order: number(0, Infinity, true),
  blocks: array(block, 1), seo: optional(object({ title: optional(text), description: optional(text), keywords: optional(array(text)) })),
});
const website = object({
  id: text, projectId: text, name: text, status: choice('draft', 'published', 'archived'),
  designSystem: object({
    colors,
    typography: object({ headingFont: text, bodyFont: text, baseFontSize: number(1) }),
    spacing: object({ section: number(0), block: number(0) }), borderRadius: number(0),
  }),
  pages: array(page, 1), createdAt: timestamp, updatedAt: timestamp,
});

const rules: Record<AgentType, Rule> = {
  business: object({
    companyName: text, industry: text, description: text, productsOrServices: array(text, 1), targetAudience: array(text, 1),
    geography: optional(array(text)), advantages: optional(array(text)), websiteGoals: array(text, 1),
    desiredActions: array(text, 1), competitors: optional(array(text)), notes: optional(text),
  }),
  design: object({
    styleName: text, description: text, mood: array(text, 1), colors,
    typography: object({ headingStyle: text, bodyStyle: text }), layoutPrinciples: array(text, 1),
    visualReferences: optional(array(text)), notes: optional(text),
  }),
  content: object({
    pageTitle: text, pageGoal: text, toneOfVoice: text, keyMessages: array(text, 1),
    sections: array(object({ type: text, purpose: text, heading: optional(text), text: optional(text), points: optional(array(text)), callToAction: optional(text) }), 1),
    notes: optional(text),
  }),
  developer: object({ website, generatedAt: timestamp, notes: optional(text) }),
  qa: object({
    passed: boolean, score: number(0, 100), checkedAt: timestamp, notes: optional(text),
    issues: array(object({ code: text, severity: choice('info', 'warning', 'error', 'critical'), message: text,
      pageId: optional(text), blockId: optional(text), recommendation: optional(text) })),
  }),
};

/** Runtime boundary for agent responses. This verifies data, not visual quality or business facts. */
export function validateWebsiteAgentOutput(stage: AgentType, output: unknown, projectId: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  rules[stage](output, stage, issues);
  if (issues.length || !isObject(output)) return { valid: false, issues };

  if (stage === 'qa' && output.passed === true) {
    const reports = output.issues as Record<string, unknown>[];
    if (reports.some(entry => entry.severity === 'error' || entry.severity === 'critical')) {
      issue(issues, 'qa.passed', 'A passing report cannot contain blocking errors.', 'QA_CONTRADICTION');
    }
  }
  if (stage === 'developer') {
    const site = output.website as Record<string, unknown>;
    if (site.projectId !== projectId) issue(issues, 'developer.website.projectId', 'Website belongs to another project.', 'PROJECT_MISMATCH');
    if (site.status !== 'draft') issue(issues, 'developer.website.status', 'Generated websites must remain drafts.', 'DRAFT_REQUIRED');
    const pages = site.pages as Record<string, unknown>[];
    const pageIds = new Set<unknown>();
    const slugs = new Set<unknown>();
    const blockIds = new Set<unknown>();
    const unique = (seen: Set<unknown>, value: unknown, path: string) => {
      if (seen.has(value)) issue(issues, path, 'Duplicate identifier or page address.', 'DUPLICATE_VALUE');
      seen.add(value);
    };
    pages.forEach((entry, pageIndex) => {
      const path = `developer.website.pages[${pageIndex}]`;
      unique(pageIds, entry.id, `${path}.id`);
      unique(slugs, entry.slug, `${path}.slug`);
      if (entry.status !== 'draft') issue(issues, `${path}.status`, 'Generated pages must remain drafts.', 'DRAFT_REQUIRED');
      (entry.blocks as Record<string, unknown>[]).forEach((item, blockIndex) => unique(blockIds, item.id, `${path}.blocks[${blockIndex}].id`));
    });
  }
  return { valid: issues.length === 0, issues };
}
