import type { BusinessProfile } from './business-profile.js';
import type { DesignDirection } from './design-direction.js';
import type { ContentPlan } from './content-plan.js';

export interface DeveloperAgentInput {
  business: BusinessProfile;
  design: DesignDirection;
  content: ContentPlan;
}
