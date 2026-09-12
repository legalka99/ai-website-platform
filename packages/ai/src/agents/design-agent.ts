import type { AIAgent } from '../agent.js';
import type { BusinessProfile } from '../contracts/business-profile.js';
import type { DesignDirection } from '../contracts/design-direction.js';

export interface DesignAgent
  extends AIAgent<BusinessProfile, DesignDirection> {
  type: 'design';
}
