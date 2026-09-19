import {publicFactualFields} from '../contracts/content-publication.js';
import {equivalentConfirmedClaim,sameNumericLiterals} from './claim-equivalence.js';
import { validateConfirmedBusinessFacts, factualClauses, type ConfirmedBusinessFacts } from '../../../core/src/confirmed-business-facts.js';
import type { ContentAgentInput } from '../contracts/content-agent-input.js';
import type { ContentPlan } from '../contracts/content-plan.js';
import type { ContentValidationError } from '../contracts/content-validation-error.js';
import {normalizeNaturalLanguage} from '../services/language-normalization.js';

/** Bounded RU/EN high-risk claim detection, not general natural-language entailment.
 * Call only after input and ContentPlan runtime validation. No model or tool calls. */
const normalize = (text:string) => text.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
// Preserve contrast/condition clauses identically in evidence and output.
const sentences = factualClauses;
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
/** Only immutable Brief evidence; goals and CTA labels are never commercial authority. */
export function contentGroundingFacts(facts:ConfirmedBusinessFacts|undefined):string[] {
  if(!facts)return [];
  return [...new Set(validateConfirmedBusinessFacts(facts).facts
    .flatMap(f=>{
      const normalized=normalizeNaturalLanguage(f.value);
      const aliases=normalized.meaningPreserved&&normalized.corrections.length>0&&normalized.corrections.every(c=>c.kind==='spelling')?factualClauses(normalized.text):[];
      return [...factualClauses(f.value),...aliases,...(f.source.fragment?factualClauses(f.source.fragment.originalValue):[])];
    })
    .filter(s=>!informationRequest(s)))];
}

// Added commercial phrases use bounded adjective/noun forms and Unicode word edges.
// Bare production, quality and price topic words are not new claim detectors.
const detectors:readonly [string,RegExp][] = [
  ['QUALITY',/(?:высок\p{L}*|премиальн\p{L}*)\s+качеств\p{L}*|(?:^|[^\p{L}])(?:лучш\p{L}*|над[её]жн\p{L}*|профессиональн\p{L}*|экспертн\p{L}*|безупречн\p{L}*|проверенн\p{L}*)|\b(?:high quality|premium|best|reliable|professional|expert|flawless|proven)\b|(?:^|[^\p{L}\p{N}_])(?:качественн(?:ая|ую|ой|ою|ые|ых|ым|ыми|ое|ого|ому|ом|ый)\s+(?:фурнитур(?:а|ы|е|у|ой|ою)|материал(?:ы|ов|ам|ами|ах|а|у|ом|е)?|комплектующ(?:ие|их|им|ими)|ст[её]кл(?:о|а|у|ом|е))|(?:high[- ]quality|quality)\s+(?:hardware|materials?))(?![\p{L}\p{N}_])/iu],
  ['SPEED',/(?:^|[^\p{L}])(?:быстр\p{L}*|оперативн\p{L}*|мгновенн\p{L}*|срочн\p{L}*)|в срок|ближайшее время|\b(?:fast|quick\w*|prompt\w*|instant\w*|on time|soon)\b/iu],
  ['EXPERIENCE',/(?:многолетн\p{L}*|больш\p{L}*|богат\p{L}*)\s+опыт|опытн\p{L}*\s+(?:команд\p{L}*|специалист\p{L}*)|\b(?:experienced|years of experience)\b/iu],
  ['CAPABILITY',/(?:любой|любые|любых|любого)\s+(?:сложности|размер\p{L}*|задач\p{L}*|решени\p{L}*)|полный спектр|\b(?:any complexity|any size|any task|full range|all solutions)\b|(?:^|[^\p{L}\p{N}_])(?:(?:собственн(?:ое|ого|ому|ым|ом)|сво(?:[её]|его|ему|им|[её]м))\s+производств(?:о|а|у|ом|е)|собственн(?:ая|ой|ую|ою)\s+производственн(?:ая|ой|ую|ою)\s+баз(?:а|ы|е|у|ой|ою)|(?:производим|изготавливаем)\s+сами|(?:own|in[- ‐‑]house)\s+(?:production|manufacturing))(?![\p{L}\p{N}_])/iu],
  ['PRICE',/(?:выгодн\p{L}*|лучш\p{L}*|доступн\p{L}*|низк\p{L}*)\s+цен\p{L}*|экономи\p{L}*|дешевле|скидк\p{L}*|\b(?:affordable|low prices?|best prices?|save money|cheaper|discount\w*)\b|(?:^|[^\p{L}\p{N}_])(?:(?:прозрачн|честн|понятн)(?:ые|ых|ым|ыми|ая|ой|ую|ою)\s+цен(?:а|ы|е|у|ой|ою|ам|ами|ах)?|(?:прозрачн|честн|понятн)(?:ое|ого|ому|ым|ом)\s+ценообразовани(?:е|я|ю|ем|и)|(?:transparent|clear|honest)\s+(?:pricing|prices?))(?![\p{L}\p{N}_])/iu],
  ['GUARANTEE',/гаранти\p{L}*|безопасност\p{L}*|долговечн\p{L}*|герметичн\p{L}*|\b(?:guarantee\w*|warrant\w*|safety|durable|durability|watertight)\b/iu],
  ['SERVICE',/(?:^|[^\p{L}])(?:монтаж\p{L}*|монтир\p{L}*|смонтир\p{L}*|достав\p{L}*|замер\p{L}*|измер\p{L}*|консульт\p{L}*|проектир\p{L}*|спроектир\p{L}*|установ\p{L}*|устанавл\p{L}*|сопровожд\p{L}*|сопровод\p{L}*)|\b(?:install\w*|deliver\w*|measurement services?|consult\w*|engineering|support\w*)\b|(?:индивидуальн\p{L}*|персональн\p{L}*)\s+подход|консультаци\p{L}*|бесплатн\p{L}*|сопровождени\p{L}*|под ключ|(?:специалист\p{L}*|мы)\s+помо\p{L}*|\b(?:personalized service|individual approach|consultation\w*|free|turnkey|our specialists|we will help)\b/iu],
  ['SOCIAL_PROOF',/тысяч\p{L}*\s+клиент\p{L}*|довольн\p{L}*\s+клиент\p{L}*|лидер\p{L}*\s+рынк\p{L}*|рекомендуют|высок\p{L}*\s+рейтинг|\b(?:market leader|happy customers|thousands of customers|top rated|number one)\b/iu],
  ['TECHNICAL',/\p{N}|сертификат\p{L}*|ГОСТ|технологи\p{L}*|закал[её]нн\p{L}*|триплекс|алюмини\p{L}*|нержавеющ\p{L}*|\b(?:certified|certificate\w*|ISO|tempered|laminated|aluminium|aluminum|stainless|technology|equipment)\b/iu],
];
export function validateContentGrounding(plan:ContentPlan,input:ContentAgentInput):ContentValidationError|undefined {
  const sources=contentGroundingFacts(input.confirmedBusinessFacts);
  const fields=publicFactualFields(plan);
  for(const [i,s] of plan.sections.entries()) {
    // CTA has its own exact-match authority, not a new commercial fact source.
    if(s.callToAction&&!input.business.desiredActions.includes(s.callToAction)) return {stage:'content-semantic',path:`sections[${i}].callToAction`,rule:'CTA_NOT_ALLOWED'};
  }
  for(const [path,text] of fields) for(const sentence of sentences(text)) {
    if(informationRequest(sentence)) continue;
    const detector=detectors.find(([,pattern])=>pattern.test(sentence));
    if(!detector) continue;
    // Each proof uses one complete confirmed clause; strategy/internal fields never supply evidence.
    const claim=normalize(sentence);
    if(sources.some(source=>sameNumericLiterals(sentence,source)&&(normalize(source)===claim||equivalentConfirmedClaim(sentence,source)))) continue;
    return {stage:'content-grounding',path,rule:`UNGROUNDED_${detector[0]}_CLAIM`};
  }
  return undefined;
}
