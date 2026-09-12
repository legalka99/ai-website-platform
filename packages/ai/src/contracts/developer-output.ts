import type { Website } from '../../../website-model/src/index.js';

export interface DeveloperOutput {
  website: Website;
  generatedAt: string;
  notes?: string;
}
