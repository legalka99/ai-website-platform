import type { BusinessProfile } from './business-profile.js';
import type { DesignDirection } from './design-direction.js';
import type { ContentPlan } from './content-plan.js';
import type { DeveloperOutput } from './developer-output.js';
import type { QAReport } from './qa-report.js';

export interface WebsiteWorkflowState {
  business?: BusinessProfile;
  design?: DesignDirection;
  content?: ContentPlan;
  developer?: DeveloperOutput;
  qa?: QAReport;
}
