import type { ConfirmedBusinessFacts } from './confirmed-business-facts.js';
/** Shared context for whole-site and future block requests. No Brief is required here.
 * These are separate channels: instructions and suggestions never enter factual evidence.
 * The current launch uses only confirmedFacts; no block editor or approval flow is implemented.
 */
export interface UserInstruction {
 readonly kind:'user_instruction';
 readonly text:string;
}
export type CreativeInstruction = UserInstruction;
/** Research about other businesses: never a claim about this client.
 * References identify research sources; this type does not authorize fetching URLs. */
export interface MarketInsight {
 readonly kind:'market_insight';
 readonly id:string;
 readonly text:string;
 readonly source:{readonly kind:'market_research';readonly references:readonly string[]};
}
export interface AISuggestion {
 readonly kind:'ai_suggestion';
 readonly text:string;
 readonly status:'draft';
 readonly source:{readonly kind:'ai_generated';readonly marketInsightIds?:readonly string[]};
}
export interface ProjectKnowledge {
 readonly projectId:string;
 readonly confirmedFacts:ConfirmedBusinessFacts;
 readonly marketInsights?:readonly MarketInsight[];
}
export interface ProjectCreationRequest {
 readonly instruction:CreativeInstruction;
 readonly knowledge:ProjectKnowledge;
 readonly suggestions?:readonly AISuggestion[];
}
// A user-confirmed AI suggestion must become a new persisted owner confirmation,
// with its own provenance, through a future authorized server operation. Changing
// a draft's status or copying its text cannot promote it to ConfirmedBusinessFacts.
// Add a distinct trusted source kind only when that persistence/authorization exists.

// Prefer confirmed Owner Brief knowledge first. Research may fill proposal gaps,
// never confirmed-fact gaps. Price, deadlines, guarantees and free services remain
// proposal-only until a user explicitly confirms the exact claim and conditions.
// Preserve original research/AI lineage alongside that future owner confirmation.
