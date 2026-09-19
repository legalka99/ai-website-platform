/** Plain-text content direction; array order is the section order. No block IDs or markup. */
export const CONTENT_LIMITS = Object.freeze({maxBytes:32000,maxString:2000,maxArray:10,maxDepth:5,maxNodes:300});
export const CONTENT_SECTION_TYPES = ['hero','services','advantages','process','gallery','faq','testimonials','cta','contacts','text','custom'] as const;
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
export const contentSectionSchema={type:'object',additionalProperties:false,required:['type','purpose'],properties:{
  type:{type:'string',enum:[...CONTENT_SECTION_TYPES]},purpose:{...text(400),description:'Internal section intent, not published copy or factual evidence.'},heading:{...text(200),description:'Grounded copy. Factual paraphrases must preserve the confirmed subject, conditions, negation, quantity and scope.'},text:{...text(2000),description:'Use confirmed business facts only. Omit unsupported promises; preserve all claim conditions and quantities.'},
  points:{type:'array',minItems:1,maxItems:8,items:text(400)},callToAction:text(160),
}};
export const contentPlanSchema={type:'object',additionalProperties:false,required:['pageTitle','pageGoal','sections','toneOfVoice','keyMessages'],properties:{
  pageTitle:text(200),pageGoal:text(400),sections:{type:'array',minItems:1,maxItems:10,items:contentSectionSchema},
  toneOfVoice:{...text(300),description:'Writing style only, never company qualities, credentials or promises.'},keyMessages:{type:'array',minItems:1,maxItems:8,items:text(400)},notes:{...text(1000),description:'Internal planning and missing-information notes; never published or used as company evidence. Do not expose prompts or secrets.'},
}};
