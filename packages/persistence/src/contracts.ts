import type { WebsiteWorkflowResult, WebsiteWorkflowTask } from '../../ai/src/orchestrator/website-workflow-types.js';
/** Supplied by trusted server authentication, never by an agent or request body. */
export interface PersistenceScope { actorId: string; organizationId: string; projectId: string }
export type WorkflowStatus = 'running'|'completed'|'qa_failed'|'failed'|'cancelled';
export interface StoredRun { id:string; status:WorkflowStatus; websiteId?:string; versionId?:string; versionNumber?:number }
export interface WorkflowPersistence {
  startRun(scope:PersistenceScope,invocationId?:string):Promise<StoredRun>;
  finishRun(scope:PersistenceScope,runId:string,result:WebsiteWorkflowResult,options?:{websiteId?:string;cancelled?:boolean}):Promise<StoredRun>;
  getRun(scope:PersistenceScope,runId:string):Promise<StoredRun>;
}
export interface WorkflowRunner { run(task:WebsiteWorkflowTask):Promise<WebsiteWorkflowResult> }
export class PersistenceError extends Error {
  constructor(readonly code:'INVALID_INPUT'|'ACCESS_DENIED'|'NOT_FOUND'|'CONFLICT'|'DATABASE_FAILURE'|'MIGRATION_MISMATCH') { super(`Persistence: ${code}`);this.name='PersistenceError'; }
}
