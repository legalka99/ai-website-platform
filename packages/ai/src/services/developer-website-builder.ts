import {publicSectionCopy} from '../contracts/content-publication.js';
import { randomUUID } from 'node:crypto';
import type { DeveloperAgentInput } from '../contracts/developer-agent-input.js';
import type { DeveloperOutput } from '../contracts/developer-output.js';
import type { DeveloperLayoutProposal } from '../agents/developer-schema.js';
import type { WebsiteBlockType, DesignSystem } from '../../../website-model/src/index.js';

export const DEVELOPER_DEFAULTS=Object.freeze({baseFontSize:16,sectionSpacing:64,blockSpacing:24,borderRadius:8});
/** No executable/custom/media/contact contract exists yet. Preserve plain copy in text blocks. */
export function developerBlockType(sectionType:string):WebsiteBlockType {
  return ['hero','text','services','advantages','faq','cta'].includes(sectionType)?sectionType as WebsiteBlockType:'text';
}
const font=(style:string)=> /(?:sans|без засечек)/iu.test(style)?'Arial':/(?:serif|с засечками)/iu.test(style)?'Georgia':'Arial';
export function developerDesignSystem(input:DeveloperAgentInput):DesignSystem {
  return {colors:{...input.design.colors},typography:{headingFont:font(input.design.typography.headingStyle),bodyFont:font(input.design.typography.bodyStyle),baseFontSize:DEVELOPER_DEFAULTS.baseFontSize},
    spacing:{section:DEVELOPER_DEFAULTS.sectionSpacing,block:DEVELOPER_DEFAULTS.blockSpacing},borderRadius:DEVELOPER_DEFAULTS.borderRadius};
}
/** Trusted local assembly only, after proposal and input validation. No provider text is copied. */
export function buildDeveloperWebsite(input:DeveloperAgentInput,proposal:DeveloperLayoutProposal,projectId:string):DeveloperOutput {
  const websiteId=randomUUID(), pageId=`${websiteId}-page-0`,now=new Date().toISOString();
  return {generatedAt:now,website:{id:websiteId,projectId,name:input.content.pageTitle,status:'draft',createdAt:now,updatedAt:now,
    designSystem:developerDesignSystem(input),pages:[{id:pageId,slug:'/',title:input.content.pageTitle,status:'draft',order:0,
      seo:{title:input.content.pageTitle,...(input.content.sections[0]?.text?{description:input.content.sections[0].text}:{})},
      blocks:proposal.sections.map((layout,i)=>{
        const section=input.content.sections[i]!;
        return {id:`${pageId}-block-${i}`,type:developerBlockType(section.type),order:i,visible:true,
          settings:{alignment:layout.alignment},content:publicSectionCopy(section)};
      })}]}};
}
