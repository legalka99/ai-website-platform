/** Plain-text content direction; array order is the section order. No block IDs or markup. */
export const CONTENT_LIMITS = Object.freeze({maxBytes:32000,maxString:2000,maxArray:10,maxDepth:5,maxNodes:300});
export const CONTENT_SECTION_TYPES = ['hero','services','advantages','process','gallery','faq','testimonials','cta','contacts','text','custom'] as const;
const text=(maxLength:number)=>({type:'string',minLength:1,maxLength,pattern:'\\S'});
export const contentSectionSchema={type:'object',additionalProperties:false,required:['type','purpose'],properties:{
  type:{type:'string',enum:[...CONTENT_SECTION_TYPES]},purpose:text(400),heading:text(200),text:text(2000),
  points:{type:'array',minItems:1,maxItems:8,items:text(400)},callToAction:text(160),
}};
export const contentPlanSchema={type:'object',additionalProperties:false,required:['pageTitle','pageGoal','sections','toneOfVoice','keyMessages'],properties:{
  pageTitle:text(200),pageGoal:text(400),sections:{type:'array',minItems:1,maxItems:10,items:contentSectionSchema},
  toneOfVoice:text(300),keyMessages:{type:'array',minItems:1,maxItems:8,items:text(400)},notes:text(1000),
}};
