import type {BlockType} from './block-generation.js';
import type {GenerationOperation} from './generation-intent.js';

export const UNDERSTANDING_SOURCES=['block_instruction','brief_field','edit_command','clarification_answer'] as const;
export type UnderstandingSource=typeof UNDERSTANDING_SOURCES[number];
export const CORRECTION_KINDS=['spelling','grammar','punctuation','whitespace','command_typo'] as const;
export type CorrectionKind=typeof CORRECTION_KINDS[number];
export const CONFIDENCE_LEVELS=['high','medium','low'] as const;
export type UnderstandingConfidence=typeof CONFIDENCE_LEVELS[number];
export const ASSERTION_CATEGORIES=['identity','offering','audience','geography','advantage','price','service','guarantee','other'] as const;
export type SemanticAssertionCategory=typeof ASSERTION_CATEGORIES[number];
export const ASSERTION_MODALITIES=['certain','uncertain','conditional'] as const;
export type SemanticModality=typeof ASSERTION_MODALITIES[number];
export const CLARIFICATION_CODES=['TARGET_UNCLEAR','OPERATION_UNCLEAR','CLAIM_UNCLEAR','CONFLICTING_INSTRUCTIONS','CONFIRM_RISKY_CLAIM'] as const;
export type ClarificationCode=typeof CLARIFICATION_CODES[number];

export interface LanguageCorrection {
 readonly original:string;
 readonly corrected:string;
 readonly kind:CorrectionKind;
 readonly confidence:UnderstandingConfidence;
}
export interface SemanticQualifier {
 readonly kind:'condition'|'scope'|'quantity'|'location'|'time';
 readonly value:string;
}
/** Semantic interpretation only. Authority is deliberately absent and remains server-owned. */
export interface SemanticAssertion {
 readonly originalSpan:string;
 readonly normalizedClaim:string;
 readonly category:SemanticAssertionCategory;
 readonly polarity:'positive'|'negative';
 readonly modality:SemanticModality;
 readonly qualifiers:readonly SemanticQualifier[];
 readonly confidence:number;
}
export interface ClarificationChoice {readonly id:string;readonly label:string}
export interface Clarification {
 readonly code:ClarificationCode;
 readonly question:string;
 readonly choices?:readonly ClarificationChoice[];
 readonly unresolved:readonly {readonly kind:'intent'|'target'|'fact'|'qualifier';readonly field?:string}[];
}
export interface InterpretedUserInput {
 readonly version:1;
 readonly original:{readonly text:string;readonly language:'ru'|'en'|'und';readonly source:UnderstandingSource};
 readonly normalized:{readonly text:string;readonly corrections:readonly LanguageCorrection[];readonly meaningPreserved:boolean};
 readonly intent:{
  readonly operation:GenerationOperation;
  readonly target?:{readonly scope:'block'|'page'|'site';readonly blockType?:BlockType;readonly field?:'heading'|'text'|'points'|'callToAction'};
  readonly constraints:readonly string[];
  readonly confidence:UnderstandingConfidence;
  /** Literal operands are present only for REPLACE_EXACT and are never normalized. */
  readonly exactReplacement?:{readonly expectedText:string;readonly replacementText:string};
 };
 readonly assertions:readonly SemanticAssertion[];
 readonly outcome:
  |{readonly status:'understood'}
  |{readonly status:'needs_clarification';readonly clarification:Clarification}
  |{readonly status:'rejected';readonly code:'UNSAFE_INPUT'|'INVALID_INPUT'|'LIMIT_EXCEEDED'};
}
export interface UnderstandingContext {
 readonly source:UnderstandingSource;
 readonly scope:'block'|'page'|'site';
 readonly explicitBlockType?:BlockType;
 readonly currentBlockType?:BlockType;
 readonly targetKnown?:boolean;
}
