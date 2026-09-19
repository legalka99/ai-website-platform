import {BLOCK_TYPES,type BlockType} from '../../../core/src/block-generation.js';
import type {CreativeContext,NormalizedBlockIntent,GenerationOperation} from '../../../core/src/generation-intent.js';
import {validateExternal} from '../../../security/src/validation.js';
import {SecurityError} from '../../../security/src/errors.js';
import {containsSecret} from '../../../security/src/redaction.js';
import {plainJSON} from '../agents/design-schema.js';
import {isSafeContentText} from '../validation/content-text-policy.js';
import {normalizeNaturalLanguage} from './language-normalization.js';
/** Bounded typo aliases for routing hints, not a factual normalizer or general NLU model. */
export function normalizeBlockIntent(raw:string,explicitType?:BlockType):NormalizedBlockIntent {
 if(typeof raw!=='string'||!raw.trim()||raw.length>2000||containsSecret(raw)||explicitType!==undefined&&!BLOCK_TYPES.includes(explicitType))throw new SecurityError('INVALID_INPUT');
 // Intent normalization may correct command words, but exact replacement operands remain owned by the strict executor.
 const normalizedInstruction=normalizeNaturalLanguage(raw).text;
 const edit=normalizedInstruction.match(/^(замени|replace|перепиши|rewrite|удали|delete|перемести|move|отредактируй|edit|поменяй)(?=\s|$)/iu);
 if(edit){const operation=({замени:'REPLACE_EXACT',replace:'REPLACE_EXACT',перепиши:'REWRITE',rewrite:'REWRITE',удали:'DELETE',delete:'DELETE',перемести:'MOVE',move:'MOVE',отредактируй:'EDIT',edit:'EDIT',поменяй:'EDIT'} as Record<string,GenerationOperation>)[edit[1]!.toLowerCase()]!;return {operation,rawInstruction:raw,normalizedInstruction:operation==='REPLACE_EXACT'?raw:normalizedInstruction};}
 const tokens:string[]=normalizedInstruction.toLowerCase().match(/[\p{L}]+/gu)??[];
 const hinted=tokens.some(token=>token.startsWith('преимуществ'))?'advantages':tokens.includes('экран')?'hero':tokens.some(token=>token.startsWith('услуг'))?'services':undefined;
 return {operation:'GENERATE',rawInstruction:raw,normalizedInstruction,...(explicitType??hinted?{blockType:explicitType??hinted}:{})};
}
export function validateCreativeContext(value:unknown):CreativeContext {
 validateExternal(value,plainJSON,{maxBytes:12000,maxString:500,maxArray:8,maxDepth:3,maxNodes:80});
 const fail=():never=>{throw new SecurityError('INVALID_INPUT');};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['marketInsights','competitorInsights','seoContext'].includes(k)))return fail();
 const v=value as CreativeContext;
 const list=(x:unknown)=>Array.isArray(x)&&x.length<=8&&x.every(s=>typeof s==='string'&&s.length<=500&&isSafeContentText(s));
 for(const key of ['marketInsights','competitorInsights'] as const)if(v[key]!==undefined&&!list(v[key]))return fail();
 if(v.seoContext!==undefined){const c=v.seoContext;if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['topics','intent'].includes(k))||!list(c.topics)||c.intent!==undefined&&(typeof c.intent!=='string'||c.intent.length>500||!isSafeContentText(c.intent)))return fail();}
 return structuredClone(v);
}
