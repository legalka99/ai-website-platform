import type { BusinessProfile } from './business-profile.js';
import type { DesignSystem } from '../../../website-model/src/website.js';

/** Flat BusinessProfile extension preserves the current workflow's business -> design input.
 * Optional context is supplied by a trusted service, never loaded from URLs by the agent.
 */
export interface DesignAgentInput extends BusinessProfile {
  designPreferences?: {
    style?: string;
    mood?: string[];
    colors?: Partial<DesignSystem['colors']>;
    notes?: string;
  };
  existingDesignSystem?: DesignSystem;
}
