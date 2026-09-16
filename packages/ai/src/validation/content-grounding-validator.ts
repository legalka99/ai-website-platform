import type { ContentAgentInput } from '../contracts/content-agent-input.js';
import type { ContentPlan } from '../contracts/content-plan.js';
import type { ContentValidationError } from '../contracts/content-validation-error.js';

/** Bounded RU/EN high-risk claim detection, not general natural-language entailment.
 * Call only after input and ContentPlan runtime validation. No model or tool calls. */
const normalize = (text:string) => text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const sentences = (text:string) => text.split(/(?<!\d)[.!?;\n]+|[.!?;\n]+(?!\d)|\s+(?:но|зато|однако|but|however)\s+/iu).map(s=>s.trim()).filter(Boolean);
// Only narrowly specified missing-information requests are exempt. Never exempt a
// whole field or an arbitrary sentence just because it contains “confirm” or “not”.
const topics = /^(?:(?:о|об|и|или|the|and|or|about|of|for)\s+|(?:качеств\p{L}*|гаранти\p{L}*|услови\p{L}*|срок\p{L}*|изготовлени\p{L}*|доставк\p{L}*|материал\p{L}*|вариант\p{L}*|отделк\p{L}*|замер\p{L}*|монтаж\p{L}*|способ\p{L}*|связ\p{L}*|цен\p{L}*|опыт\p{L}*|сертификат\p{L}*|консультаци\p{L}*|quality|guarantees?|warrant(?:y|ies)|terms|deadlines?|delivery|materials?|prices?|experience|certificates?|consultations?)\s*[, ]*)+$/iu;
function informationRequest(text:string):boolean {
  const value=text.trim().replace(/,?\s*если эти услуги предоставляются$/iu,'');
  const simple=value.match(/^(?:необходимо подтвердить|нужно подтвердить|требуется подтвердить|please confirm|need to confirm)\s+(.+)$/iu);
  if(simple) return topics.test(simple[1]!);
  const request=value.match(/^для (?:финальной страницы|публикации(?: информации)?|добавления информации)(?:\s+(.+?))?\s+(?:нужны|потребуются|требуются|требуется)\s+подтвержд[её]нн(?:ые|ый|ая)\s+(?:данные|условия|срок|информация)(?:\s+(.+))?$/iu);
  if(request) return [request[1],request[2]].every(part=>!part||topics.test(part));
  return /^(?:объяснить практическую ценность обращения без неподтвержд[её]нных обещаний|do not add unsupported promises)$/iu.test(value);
}
const uncertain = /(?:^|[^\p{L}])(?:не|нет|без|если|возможно|нужно|требуется|подтвердить|not|no|without|if|may|might|confirm|unconfirmed|unknown)(?:$|[^\p{L}])/iu;

/** Source authority is explicit business data, never design, goal, competitors or
 * missing-information notes. The caller must obtain user confirmation upstream. */
export function contentGroundingFacts(input:ContentAgentInput):string[] {
  const b=input.business;
  return [b.companyName,b.industry,b.description,...b.productsOrServices,...b.targetAudience,...(b.geography??[]),...(b.advantages??[]),...(input.businessFacts??[])]
    .flatMap(sentences).filter(s=>!informationRequest(s)&&!uncertain.test(s));
}

const detectors:readonly [string,RegExp][] = [
  ['QUALITY',/(?:высок\p{L}*|премиальн\p{L}*)\s+качеств\p{L}*|(?:^|[^\p{L}])(?:лучш\p{L}*|над[её]жн\p{L}*|профессиональн\p{L}*|экспертн\p{L}*|безупречн\p{L}*|проверенн\p{L}*)|\b(?:high quality|premium|best|reliable|professional|expert|flawless|proven)\b/iu],
  ['SPEED',/(?:^|[^\p{L}])(?:быстр\p{L}*|оперативн\p{L}*|мгновенн\p{L}*|срочн\p{L}*)|в срок|ближайшее время|\b(?:fast|quick\w*|prompt\w*|instant\w*|on time|soon)\b/iu],
  ['EXPERIENCE',/(?:многолетн\p{L}*|больш\p{L}*|богат\p{L}*)\s+опыт|опытн\p{L}*\s+(?:команд\p{L}*|специалист\p{L}*)|\b(?:experienced|years of experience)\b/iu],
  ['CAPABILITY',/(?:любой|любые|любых|любого)\s+(?:сложности|размер\p{L}*|задач\p{L}*|решени\p{L}*)|полный спектр|\b(?:any complexity|any size|any task|full range|all solutions)\b/iu],
  ['PRICE',/(?:выгодн\p{L}*|лучш\p{L}*|доступн\p{L}*|низк\p{L}*)\s+цен\p{L}*|экономи\p{L}*|дешевле|скидк\p{L}*|\b(?:affordable|low prices?|best prices?|save money|cheaper|discount\w*)\b/iu],
  ['GUARANTEE',/гаранти\p{L}*|безопасност\p{L}*|долговечн\p{L}*|герметичн\p{L}*|\b(?:guarantee\w*|warrant\w*|safety|durable|durability|watertight)\b/iu],
  ['SERVICE',/(?:индивидуальн\p{L}*|персональн\p{L}*)\s+подход|консультаци\p{L}*|бесплатн\p{L}*|сопровождени\p{L}*|под ключ|(?:специалист\p{L}*|мы)\s+помо\p{L}*|\b(?:personalized service|individual approach|consultation\w*|free|turnkey|our specialists|we will help)\b/iu],
  ['SOCIAL_PROOF',/тысяч\p{L}*\s+клиент\p{L}*|довольн\p{L}*\s+клиент\p{L}*|лидер\p{L}*\s+рынк\p{L}*|рекомендуют|высок\p{L}*\s+рейтинг|\b(?:market leader|happy customers|thousands of customers|top rated|number one)\b/iu],
  ['TECHNICAL',/\p{N}|сертификат\p{L}*|ГОСТ|технологи\p{L}*|закал[её]нн\p{L}*|триплекс|алюмини\p{L}*|нержавеющ\p{L}*|\b(?:certified|certificate\w*|ISO|tempered|laminated|aluminium|aluminum|stainless|technology|equipment)\b/iu],
];
// Style adjectives alone describe writing. Business subjects, promises and
// specifications cannot hide in toneOfVoice, pageGoal, purpose or notes.
const styleOnly = /^(?:(?:профессиональн\p{L}*|экспертн\p{L}*|спокойн\p{L}*|ясн\p{L}*|практичн\p{L}*|понятн\p{L}*|информативн\p{L}*|сдержанн\p{L}*|тон|стиль|текст\p{L}*|и|professional|expert|calm|clear|practical|informative|friendly|concise|tone|of|voice|and)\s*[,; .—-]*)+$/iu;

export function validateContentGrounding(plan:ContentPlan,input:ContentAgentInput):ContentValidationError|undefined {
  const sources=contentGroundingFacts(input).map(normalize);
  const fields:[string,string][]=[['pageTitle',plan.pageTitle],['pageGoal',plan.pageGoal],['toneOfVoice',plan.toneOfVoice],...plan.keyMessages.map((s,i):[string,string]=>[`keyMessages[${i}]`,s])];
  if(plan.notes) fields.push(['notes',plan.notes]);
  for(const [i,s] of plan.sections.entries()) {
    for(const key of ['purpose','heading','text'] as const) if(s[key]) fields.push([`sections[${i}].${key}`,s[key]!]);
    for(const [j,p] of (s.points??[]).entries()) fields.push([`sections[${i}].points[${j}]`,p]);
    // CTA has its own exact-match authority, not a new commercial fact source.
    if(s.callToAction&&!input.business.desiredActions.includes(s.callToAction)) return {stage:'content-semantic',path:`sections[${i}].callToAction`,rule:'CTA_NOT_ALLOWED'};
  }
  for(const [path,text] of fields) for(const sentence of sentences(text)) {
    if(informationRequest(sentence)||(path==='toneOfVoice'&&styleOnly.test(sentence))) continue;
    const detector=detectors.find(([,pattern])=>pattern.test(sentence));
    if(!detector) continue;
    // Exact normalized complete risky clause: no category-only
    // evidence, cross-fact token pooling or substring matches inside words.
    const claim=normalize(sentence);
    if(sources.includes(claim)) continue;
    return {stage:'content-grounding',path,rule:`UNGROUNDED_${detector[0]}_CLAIM`};
  }
  return undefined;
}
