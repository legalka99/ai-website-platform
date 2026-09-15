import { DefaultDesignAgent } from '../agents/default-design-agent.js';
import { createGuardedRouter, type RoutedServiceOptions } from './guarded-router.js';
export async function createRoutedDesignService(options:RoutedServiceOptions):Promise<DefaultDesignAgent> {
  return new DefaultDesignAgent(await createGuardedRouter(options,'design'));
}
