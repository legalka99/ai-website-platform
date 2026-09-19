import type {QAReviewScope} from '../agents/qa-schema.js';
import { DefaultQAAgent } from '../agents/default-qa-agent.js';
import { createGuardedRouter,type RoutedServiceOptions } from './guarded-router.js';
export async function createRoutedQAService(options:RoutedServiceOptions,scope:QAReviewScope='website'):Promise<DefaultQAAgent> {
  const projectId=options.context.projectId;
  return new DefaultQAAgent(await createGuardedRouter(options,'qa'),projectId,scope);
}
