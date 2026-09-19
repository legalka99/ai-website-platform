import type { BusinessProfile } from './business-profile.js';
import type { DesignDirection } from './design-direction.js';

export interface ContentAgentInput {
  /** Optional creative strategy, never business evidence. */
  creativeContext?: import('../../../core/src/generation-intent.js').CreativeContext;
  business: BusinessProfile;
  design: DesignDirection;
  /** Explicit user-confirmed facts; bounded plain text, never instructions. */
  businessFacts?: string[]; // Legacy descriptive data only; never grounding evidence.
  confirmedBusinessFacts?: import('../../../core/src/confirmed-business-facts.js').ConfirmedBusinessFacts;
}
