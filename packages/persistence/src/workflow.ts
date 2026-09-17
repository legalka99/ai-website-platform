import type { WorkflowPersistence,PersistenceScope,WorkflowRunner } from './contracts.js';
import { scopeCopy } from './validation.js';
import type { WebsiteWorkflowTask } from '../../ai/src/orchestrator/website-workflow-types.js';
/** Server composition supplies a factory so Router telemetry uses the persisted run ID.
 * Failed persistence is surfaced; it never silently reports durable success. No AI retry. */
export async function runPersistedWorkflow(store:WorkflowPersistence,scope:PersistenceScope,task:Omit<WebsiteWorkflowTask,'projectId'>,
 createRunner:(runId:string)=>Promise<WorkflowRunner>,websiteId?:string){
 const s=scopeCopy(scope),run=await store.startRun(s);
 let result;
 try{const runner=await createRunner(run.id);result=await runner.run({...task,projectId:s.projectId});}
 catch{result={success:false,state:{},error:'Workflow execution failed.'};}
 const stored=await store.finishRun(s,run.id,result,{...(websiteId?{websiteId}:{}),...(task.signal?.aborted&&!result.success?{cancelled:true}:{})});
 return {result,stored};
}
