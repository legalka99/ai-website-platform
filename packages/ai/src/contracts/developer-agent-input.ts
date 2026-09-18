import type { BusinessProfile } from './business-profile.js';
import type { DesignDirection } from './design-direction.js';
import type { ContentPlan } from './content-plan.js';

export interface DeveloperAgentInput {
  business: BusinessProfile;
  design: DesignDirection;
  content: ContentPlan;
  /** Optional explicit confirmed facts, same bounds as Content input. */
  businessFacts?: string[]; // Legacy descriptive data only; never grounding evidence.
  confirmedBusinessFacts?: import('../../../core/src/confirmed-business-facts.js').ConfirmedBusinessFacts;
}
