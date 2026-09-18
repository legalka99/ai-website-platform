import { DefaultContentAgent } from '../agents/default-content-agent.js';
import { createGuardedRouter, type RoutedServiceOptions } from './guarded-router.js';
export async function createRoutedContentService(options:RoutedServiceOptions, correction:{allowCorrection?:boolean}={}):Promise<DefaultContentAgent> {
  return new DefaultContentAgent(await createGuardedRouter(options,'content'),correction);
}
