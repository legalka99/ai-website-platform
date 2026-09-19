import type {LanguageCorrection,SemanticAssertion,SemanticQualifier,UnderstandingConfidence} from '../../../core/src/understanding.js';

const WORD_CORRECTIONS:Readonly<Record<string,{value:string;kind:'spelling'|'command_typo'}>>=Object.freeze({
 'зделай':{value:'сделай',kind:'command_typo'},'сдеалй':{value:'сделай',kind:'command_typo'},'сделаи':{value:'сделай',kind:'command_typo'},
 'преимущиств':{value:'преимуществ',kind:'command_typo'},'примущства':{value:'преимущества',kind:'command_typo'},'преимущства':{value:'преимущества',kind:'command_typo'},'преимущеста':{value:'преимущества',kind:'command_typo'},
 'загаловок':{value:'заголовок',kind:'command_typo'},'екран':{value:'экран',kind:'command_typo'},
 'сваё':{value:'своё',kind:'spelling'},'свае':{value:'своё',kind:'spelling'},'произвотство':{value:'производство',kind:'spelling'},
 'качественая':{value:'качественная',kind:'spelling'},'ачественная':{value:'качественная',kind:'spelling'},'пад':{value:'под',kind:'spelling'},
});
const protectedPatterns={
 negation:/(?:^|[^\p{L}])(?:не|нет|без|not|no|without)(?:$|[^\p{L}])/giu,
 numbers:/[-+]?\d+(?:[.,]\d+)?/gu,
 currency:/(?:₽|руб(?:\.|л(?:ь|я|ей))?|\$|€|usd|eur)/giu,
 dateDuration:/(?:\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?|(?:день|дня|дней|час|часа|часов|месяц|месяца|месяцев|год|года|лет|day|days|hours?|months?|years?))/giu,
 geography:/(?:москв\p{L}*|росси\p{L}*|санкт[- ]петербург\p{L}*|регион\p{L}*|город\p{L}*|страна\p{L}*|moscow|russia|region|city|country)/giu,
 comparison:/(?:лучш\p{L}*|дешев\p{L}*|выгодн\p{L}*|низк\p{L}*|ниже|выше|better|best|cheaper|lowest|higher)/giu,
 superlative:/(?:сам\p{L}*|наиболее|максимальн\p{L}*|минимальн\p{L}*|most|least)/giu,
 conditions:/(?:если|при|только при|кроме|unless|if|when|only if|except)/giu,
 exclusivity:/(?:только|исключительно|единственн\p{L}*|only|exclusive\p{L}*|sole)/giu,
 modality:/(?:вроде|возможно|может быть|примерно|обычно|probably|possibly|maybe|approximately)/giu,
 service:/(?:монтаж\p{L}*|установ\p{L}*|достав\p{L}*|замер\p{L}*|консультаци\p{L}*|install\p{L}*|deliver\p{L}*|consult\p{L}*)/giu,
 product:/(?:товар\p{L}*|издели\p{L}*|стекл\p{L}*|окн\p{L}*|двер\p{L}*|product\p{L}*|glass|windows?|doors?)/giu,
 guarantee:/(?:гаранти\p{L}*|гарантийн\p{L}*|warrant\p{L}*|guarantee\p{L}*)/giu,
};
const matches=(pattern:RegExp,value:string)=>(value.normalize('NFKC').toLocaleLowerCase('ru-RU').match(pattern)??[]).map(v=>v.trim()).sort();
export function protectedSemanticFeatures(value:string):Record<keyof typeof protectedPatterns,readonly string[]> {
 return Object.fromEntries(Object.entries(protectedPatterns).map(([key,pattern])=>[key,matches(pattern,value)])) as unknown as Record<keyof typeof protectedPatterns,readonly string[]>;
}
export function meaningPreserved(original:string,normalized:string):boolean {
 const before=protectedSemanticFeatures(original),after=protectedSemanticFeatures(normalized);
 return (Object.keys(before) as (keyof typeof before)[]).every(key=>JSON.stringify(before[key])===JSON.stringify(after[key]));
}
export interface NormalizedLanguage {text:string;corrections:LanguageCorrection[];meaningPreserved:boolean;language:'ru'|'en'|'und'}
export function normalizeNaturalLanguage(raw:string):NormalizedLanguage {
 let text=raw.normalize('NFKC').replace(/\r\n?/g,'\n');const corrections:LanguageCorrection[]=[];
 text=text.replace(/[\t\f\v ]+/g,' ').replace(/ *\n */g,'\n').trim();
 text=text.replace(/[\p{L}]+/gu,word=>{
  const found=WORD_CORRECTIONS[word.toLocaleLowerCase('ru-RU')];if(!found)return word;
  const corrected=found.value;corrections.push({original:word,corrected,kind:found.kind,confidence:'high'});return corrected;
 });
 const language=/[А-Яа-яЁё]/u.test(text)?'ru':/[A-Za-z]/u.test(text)?'en':'und';
 return {text,corrections,meaningPreserved:meaningPreserved(raw,text),language};
}
const uncertainty=/(?:^|[^\p{L}])(?:вроде|возможно|может быть|примерно|probably|possibly|maybe)(?:$|[^\p{L}])/iu;
const conditional=/(?:^|[^\p{L}])(?:если|при|только|кроме|unless|if|when|only|except)(?:$|[^\p{L}])/iu;
const negative=/(?:^|[^\p{L}])(?:не|нет|без|not|no|without)(?:$|[^\p{L}])/iu;
function assertionCategory(value:string):SemanticAssertion['category'] {
 if(/(?:гаранти\p{L}*|warrant\p{L}*|guarantee\p{L}*)/iu.test(value))return 'guarantee';
 if(/(?:монтаж\p{L}*|установ\p{L}*|достав\p{L}*|замер\p{L}*|консультаци\p{L}*|install\p{L}*|deliver\p{L}*|consult\p{L}*)/iu.test(value))return 'service';
 if(/(?:москв\p{L}*|росси\p{L}*|регион\p{L}*|город\p{L}*|moscow|russia|region|city)/iu.test(value))return 'geography';
 if(/(?:цен\p{L}*|стоимост\p{L}*|дешев\p{L}*|price|cost)/iu.test(value))return 'price';
 if(/(?:производств\p{L}*|фурнитур\p{L}*|преимущ\p{L}*|quality|production)/iu.test(value))return 'advantage';
 return 'other';
}
function qualifiers(value:string):SemanticQualifier[] {
 const result:SemanticQualifier[]=[];
 if(conditional.test(value))result.push({kind:'condition',value});
 const number=value.match(/[-+]?\d(?:[\d ]*\d)?(?:[.,]\d+)?(?:\s*(?:₽|руб\p{L}*|€|\$))?/u)?.[0];if(number)result.push({kind:'quantity',value:number});
 const location=value.match(/(?:Москва|Москве|Москвы|Россия|России|Moscow|Russia)/iu)?.[0];if(location)result.push({kind:'location',value:location});
 return result;
}
/** Bounded extraction for the first MVP. It preserves complete clauses and never assigns authority. */
export function extractSemanticAssertions(original:string,normalized:string,confidence:UnderstandingConfidence='high'):SemanticAssertion[] {
 const clauses=normalized.split(/[;\n]+/u).flatMap(part=>part.split(/\s+и\s+(?=(?:качественн|собственн|прозрачн|не\s|монтаж|гаранти|цен))/iu)).map(v=>v.trim()).filter(Boolean);
 if(!clauses.length)return [];
 const originalClauses=original.split(/[;\n]+/u).flatMap(part=>part.split(/\s+и\s+(?=(?:качественн|собственн|прозрачн|не\s|монтаж|гаранти|цен))/iu)).map(v=>v.trim()).filter(Boolean);
 return clauses.filter(value=>/(?:производств|фурнитур|цен|дешев|монтаж|гаранти|географ|москв|росси|услуг|товар|издел|glass|price|install|warrant)/iu.test(value)).map((value,index)=>({
  originalSpan:originalClauses[index]??original,normalizedClaim:value.replace(/^(?:у нас|мы)\s+/iu,''),category:assertionCategory(value),polarity:negative.test(value)?'negative':'positive',
  modality:uncertainty.test(value)?'uncertain':conditional.test(value)?'conditional':'certain',qualifiers:qualifiers(value),confidence:confidence==='high'?1:confidence==='medium'?0.7:0.4,
 }));
}
