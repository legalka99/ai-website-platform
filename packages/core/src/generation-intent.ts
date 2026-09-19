import type {BlockType} from './block-generation.js';
/** Intent selects behavior, never factual authority or project authorization. */
export type GenerationOperation='GENERATE'|'REWRITE'|'REPLACE_EXACT'|'EDIT'|'DELETE'|'ADD'|'MOVE';
export interface NormalizedBlockIntent {operation:GenerationOperation;rawInstruction:string;normalizedInstruction:string;blockType?:BlockType}
export interface CreativeContext {
 /** Strategy only. These collections must never feed ConfirmedBusinessFacts. */
 marketInsights?:string[];
 competitorInsights?:string[];
 seoContext?:{topics:string[];intent?:string};
}
export interface ExactReplacement {
 operation:'REPLACE_EXACT';
 target:{projectId:string;pageId:string;blockId:string;field:'heading'|'text'|'points'|'callToAction';pointIndex?:number};
 expectedText:string;
 replacementText:string;
}
