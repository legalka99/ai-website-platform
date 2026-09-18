import type { BusinessProfile } from '../contracts/business-profile.js';

export const businessStringFields = ['companyName', 'industry', 'description', 'notes'] as const;
export const businessArrayFields = ['productsOrServices', 'targetAudience', 'geography', 'advantages', 'websiteGoals', 'desiredActions', 'competitors'] as const;
export const businessFields = [...businessStringFields, ...businessArrayFields] as const;

// The wire schema uses null for unknown strings. Unknown required values fail the domain validator.
export const businessProfileSchema = {
  type: 'object', additionalProperties: false,
  properties: Object.fromEntries([
    ...businessStringFields.map(key => [key, { type: ['string', 'null'] }]),
    ...businessArrayFields.map(key => [key, { type: 'array', items: { type: 'string' } }]),
  ]),
  required: [...businessFields],
};

export function normalizeBusinessProfile(wire: Record<string, unknown>, input: Record<string, unknown>): Partial<BusinessProfile> {
  const profile: Record<string, unknown> = {};
  for (const key of businessFields) if (wire[key] !== null) profile[key] = wire[key];
  // Explicit owner inputs win. Remaining inferred values (including industry) are
  // model-derived profile metadata, never ConfirmedBusinessFacts or grounding evidence.
  for (const key of businessStringFields) {
    if (typeof input[key] === 'string' && input[key].trim()) profile[key] = input[key];
  }
  for (const key of ['geography', 'advantages', 'competitors'] as const) {
    if (Array.isArray(input[key]) && input[key].length) profile[key] = [...input[key]];
    else delete profile[key];
  }
  for (const key of businessArrayFields) {
    if (Array.isArray(input[key]) && input[key].length) profile[key] = [...input[key]];
  }
  return profile as Partial<BusinessProfile>;
}
