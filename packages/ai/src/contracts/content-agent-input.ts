import type { BusinessProfile } from './business-profile.js';
import type { DesignDirection } from './design-direction.js';

export interface ContentAgentInput {
  business: BusinessProfile;
  design: DesignDirection;
}
