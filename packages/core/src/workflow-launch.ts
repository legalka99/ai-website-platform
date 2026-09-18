/** Browser-safe launch/status DTO. No prompts or provider configuration. */
export const WORKFLOW_LIMITS = Object.freeze({maxOutputTokens:4000,maxWorkflowOutputTokens:40000,maxRequestsPerWorkflow:10,timeoutMs:600000});
export interface LaunchRunView {
 id:string;projectId:string;briefVersionId:string;briefVersion:number;
 status:'running'|'completed'|'failed'|'cancelled'|'qa_failed';
 startedAt:string;completedAt:string|null;deadlineAt:string;
 failureCode:'WORKFLOW_FAILED'|'CANCELLED'|'BUDGET_EXCEEDED'|'TIMEOUT'|null;
 stages:{stage:'business'|'design'|'content'|'developer'|'qa';status:'waiting'|'running'|'completed'|'failed'|'cancelled'}[];
 versionId:string|null;websiteId:string|null;qaId:string|null;
}
export interface LaunchStateView {available:boolean;run:LaunchRunView|null;limits:typeof WORKFLOW_LIMITS}
