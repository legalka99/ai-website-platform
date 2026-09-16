import { developerInput,layout,developerOptions } from './developer.mjs';
import { buildDeveloperWebsite } from '../../.test-build/packages/ai/src/services/developer-website-builder.js';
export function qaInput(){const reviewContext=developerInput();return {...buildDeveloperWebsite(reviewContext,layout(),'project-1'),reviewContext};}
export const qaContext=()=>({projectId:'project-1',goal:'Review the website',input:qaInput()});
export const qaWire=(passed=true)=>({passed,score:passed?90:40,notes:null,issues:passed?[]:[{code:'BUSINESS_ALIGNMENT',severity:'error',message:'Content needs review.',pageIndex:0,blockIndex:0,recommendation:null}]});
export const qaIssue=(changes={})=>({code:'UX_OBSERVATION',severity:'warning',message:'Consider a clearer heading.',pageIndex:0,blockIndex:0,recommendation:null,...changes});
export const qaOptions=(primary='openai',failure,wire=qaWire())=>developerOptions(primary,failure,wire);
