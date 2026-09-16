import { DefaultDeveloperAgent } from '../agents/default-developer-agent.js';
import { createGuardedRouter, type RoutedServiceOptions } from './guarded-router.js';
export async function createRoutedDeveloperService(options:RoutedServiceOptions):Promise<DefaultDeveloperAgent> {
  return new DefaultDeveloperAgent(await createGuardedRouter(options,'developer'));
}
