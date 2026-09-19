/** Closed, full-clause semantic grammar. No substring evidence, token scoring or LLM judge.
 * Unknown constructions return undefined and retain the conservative exact fallback.
 * Only explicit company predicates are interchangeable; scope/conditions remain opaque slots.
 */
interface Proposition {subject:'business';predicate:string;negative:boolean;scope:string;qualifiers:string;value:string}
const text=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[—–:]/g,' ').replace(/\s+/gu,' ').trim().replace(/[.!?]+$/u,'').trim();
const qualifier='((?: (?:в|для|при|только|если|без|кроме|in|for|if|only|without|except) .+)?)';
const object='( стеклянных перегородок| стеклянные перегородки| душевых ограждений| душевые ограждения| окон| окна| дверей| двери)?';
const scope=(s:string)=>({ 'стеклянных перегородок':'glass-partitions','стеклянные перегородки':'glass-partitions','душевых ограждений':'shower-enclosures','душевые ограждения':'shower-enclosures','окон':'windows','окна':'windows','дверей':'doors','двери':'doors'}[s]??s);
const patterns:readonly [string,RegExp, 'scope'|'value'|'none'][]=[
 ['installation',new RegExp('^(?:выполняем монтаж|оказываем услуги монтажа|услуги монтажа|монтаж|устанавливаем)'+object+qualifier+'$','u'),'scope'],
 ['own-production',new RegExp('^(?:собственное производство|свое производство|располагаем собственным производством|own production|in-house production|own manufacturing|in-house manufacturing)'+qualifier+'$','u'),'none'],
 ['self-manufacture',new RegExp('^(?:производим сами|изготавливаем сами)'+qualifier+'$','u'),'none'],
 ['quality-hardware',new RegExp('^(?:качественная фурнитура|фурнитура высокого качества|quality hardware|high-quality hardware)'+qualifier+'$','u'),'none'],
 ['quality-materials',new RegExp('^(?:качественные материалы|материалы высокого качества|quality materials|high-quality materials)'+qualifier+'$','u'),'none'],
 ['transparent-pricing',new RegExp('^(?:прозрачные цены|прозрачное ценообразование|transparent prices|transparent pricing)'+qualifier+'$','u'),'none'],
 ['guarantee-duration',new RegExp('^(?:гарантия|гарантийный срок) (\\d+ (?:год|года|лет|месяц|месяца|месяцев))'+qualifier+'$','u'),'value'],
 ['price',new RegExp('^(?:цена|стоимость) (\\d+(?:[.,]\\d+)? (?:рублей|рубля|рубль))'+qualifier+'$','u'),'value'],
 ['delivery-duration',new RegExp('^(?:срок доставки|доставка занимает) (\\d+ (?:день|дня|дней))'+qualifier+'$','u'),'value'],
];
function proposition(value:string):Proposition|undefined {
 let s=text(value),negative=false;
 // Explicit first person and implicit company subject only. Never discard named third parties.
 s=s.replace(/^(?:мы|наша компания|we|our company) /u,'');
 if(s.startsWith('не ')){negative=true;s=s.slice(3);}else if(s.startsWith('do not ')){negative=true;s=s.slice(7);}
 for(const [predicate,pattern,slot] of patterns){const m=pattern.exec(s);if(!m)continue;
  return {subject:'business',predicate,negative,scope:slot==='scope'?scope((m[1]??'').trim()):'',value:slot==='value'?m[1]!:'',qualifiers:(m[slot==='none'?1:2]??'').trim()};
 }
 return undefined;
}
export function equivalentConfirmedClaim(claim:string,source:string):boolean {
 const a=proposition(claim),b=proposition(source);
 return !!a&&!!b&&JSON.stringify(a)===JSON.stringify(b);
}
/** Exact normalization must not accidentally erase numeric signs or decimal punctuation. */
export function sameNumericLiterals(a:string,b:string):boolean {
 const numbers=(s:string)=>s.normalize('NFKC').replace(/−/g,'-').match(/[-+]?\d+(?:[.,]\d+)?%?/g)??[];
 return JSON.stringify(numbers(a))===JSON.stringify(numbers(b));
}
