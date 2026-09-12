import type { AIAgent } from '../agent.js';
import type { BusinessProfile } from '../contracts/business-profile.js';

export interface BusinessAgent
  extends AIAgent<Record<string, unknown>, BusinessProfile> {
  type: 'business';
}
