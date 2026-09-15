import { WebsiteWorkflowOrchestrator } from '../orchestrator/website-workflow-orchestrator.js';
import type { WebsiteWorkflowAgents } from '../orchestrator/website-workflow-types.js';
import { createRoutedDesignService } from './routed-design-service.js';
import type { RoutedServiceOptions } from './guarded-router.js';

/** Server composition only. The existing orchestrator owns stage order and validation.
 * Supply the same server context and shared cost guard used to create the Business agent.
 */
export async function createWebsiteWorkflowService(
  options: RoutedServiceOptions,
  agents: Omit<WebsiteWorkflowAgents, 'design'>,
): Promise<WebsiteWorkflowOrchestrator> {
  const design = await createRoutedDesignService(options);
  return new WebsiteWorkflowOrchestrator({ ...agents, design });
}
