export type GenerationScope = {type:'block';pageId:string;blockId?:string}|{type:'page';pageId:string}|{type:'site'};
export const BLOCK_TYPES=['hero','advantages','services','process','faq','cta','text'] as const;
export type BlockType=typeof BLOCK_TYPES[number];
export const BLOCK_LIMITS=Object.freeze({maxRequestsPerWorkflow:4,maxOutputTokens:2000,maxWorkflowOutputTokens:8000,timeoutMs:120000});
export const BLOCK_STAGES=['design','content','developer','qa'] as const;
export type BlockStage=typeof BLOCK_STAGES[number];
export interface BlockGenerationRequest {pageId:string;blockId?:string;instruction:string;blockType?:BlockType;idempotencyKey:string}
export interface BlockRunView {id:string;pageId:string;blockId:string;status:'running'|'completed'|'failed';stage:BlockStage|'starting';errorCode:string|null;deadlineAt:string;versionId:string|null}
export interface BlockCreationView {available:boolean;pages:{id:string;title:string}[];run:BlockRunView|null}
