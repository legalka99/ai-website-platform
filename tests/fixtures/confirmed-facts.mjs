import {confirmedFactsFromBrief} from '../../.test-build/packages/core/src/confirmed-business-facts.js';
import {briefFields} from '../../.test-build/packages/core/src/business-brief.js';
export const briefId='11111111-1111-4111-8111-111111111111';
/** Explicit synthetic owner evidence; never derive automatically from a model fixture. */
export const confirmed=(fields={},id=briefId)=>confirmedFactsFromBrief({...Object.fromEntries(Object.keys(briefFields).map(k=>[k,null])),...fields},id);
