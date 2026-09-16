import { DefaultQAAgent } from '../agents/default-qa-agent.js';
import { createGuardedRouter,type RoutedServiceOptions } from './guarded-router.js';
export async function createRoutedQAService(options:RoutedServiceOptions):Promise<DefaultQAAgent> {
  const projectId=options.context.projectId;
  return new DefaultQAAgent(await createGuardedRouter(options,'qa'),projectId);
}
