import type {ContentPlan,ContentSection} from './content-plan.js';
/** The only Content fields permitted to cross into canonical Website copy. */
export const PUBLIC_SECTION_FIELDS=['heading','text','points','callToAction'] as const;
export const INTERNAL_CONTENT_FIELDS=['pageGoal','toneOfVoice','keyMessages','notes','sections[].purpose'] as const;
export function publicSectionCopy(section:ContentSection):Pick<ContentSection,typeof PUBLIC_SECTION_FIELDS[number]> {
 return {...(section.heading!==undefined?{heading:section.heading}:{}),...(section.text!==undefined?{text:section.text}:{}),...(section.points!==undefined?{points:[...section.points]}:{}),...(section.callToAction!==undefined?{callToAction:section.callToAction}:{})};
}
export function publicFactualFields(plan:ContentPlan):[string,string][] {
 const fields:[string,string][]=[['pageTitle',plan.pageTitle]];
 for(const [i,s] of plan.sections.entries()){
  for(const key of ['heading','text'] as const)if(s[key]!==undefined)fields.push([`sections[${i}].${key}`,s[key]!]);
  for(const [j,p] of (s.points??[]).entries())fields.push([`sections[${i}].points[${j}]`,p]);
 }
 return fields; // CTA has its separate exact desiredActions authority.
}
