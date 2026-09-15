import { validOutputs } from './website.mjs';
export function businessWire() {
  return { ...validOutputs().business, geography: [], advantages: [], competitors: [], notes: null };
}
export function businessContext() {
  return { projectId: 'project-1', goal: 'Create a page to receive enquiries', input: {
    companyName: 'Example', description: 'Custom glass partitions',
    productsOrServices: ['Partitions'], targetAudience: ['Homeowners'], websiteGoals: ['Receive enquiries'], desiredActions: ['Request a quote'],
  } };
}
