import { WebsiteWorkflowOrchestrator } from '../orchestrator/website-workflow-orchestrator.js';
import type { WebsiteWorkflowAgents } from '../orchestrator/website-workflow-types.js';
import { createRoutedContentService } from './routed-content-service.js';
import { createRoutedDesignService } from './routed-design-service.js';
import type { RoutedServiceOptions } from './guarded-router.js';

/** Server composition only. The existing orchestrator owns stage order and validation.
 * Content defaults to the real routed service; an explicit trusted Content implementation
 * remains supported for existing callers/tests. Never accept agent implementations from user data.
 * Supply the same server context and shared cost guard used to create the Business agent.
 */
export async function createWebsiteWorkflowService(
  options: RoutedServiceOptions,
  agents: Omit<WebsiteWorkflowAgents, 'design' | 'content'> & Partial<Pick<WebsiteWorkflowAgents, 'content'>>,
): Promise<WebsiteWorkflowOrchestrator> {
  const design = await createRoutedDesignService(options);
  const content = agents.content ?? await createRoutedContentService(options);
  return new WebsiteWorkflowOrchestrator({ ...agents, design, content });
}
