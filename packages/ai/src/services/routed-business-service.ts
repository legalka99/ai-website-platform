import { DefaultBusinessAgent } from '../agents/default-business-agent.js';
import { createGuardedRouter, type RoutedServiceOptions } from './guarded-router.js';
export type { RoutedProviderConfig as BusinessProviderConfig } from './guarded-router.js';
export async function createRoutedBusinessService(options:RoutedServiceOptions):Promise<DefaultBusinessAgent> {
  return new DefaultBusinessAgent(await createGuardedRouter(options,'business'));
}
