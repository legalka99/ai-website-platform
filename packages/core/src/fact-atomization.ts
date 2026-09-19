/** Closed whole-list grammar, not a general comma/sentence parser.
 * Every item must be independently meaningful without a shared subject or qualifier.
 * Unknown tokens, conditions, polarity, quantities and scope keep the entire field intact.
 * Keep original bytes in each trimmed fragment; normalization is for recognition only. */
const commercial=new Set([
 'собственное производство','качественная фурнитура','качественные материалы','прозрачные цены',
 'фурнитура высокого качества','материалы высокого качества','прозрачное ценообразование',
 'own production','quality hardware','quality materials','transparent pricing',
]);
const offerings=new Set([
 'монтаж окон','монтаж дверей','монтаж стеклянных перегородок','монтаж душевых ограждений',
 'стеклянные перегородки','душевые ограждения','окна','двери',
]);
export function atomicBriefValues(field:string,original:string):string[] {
 if(field!=='advantages'&&field!=='productsOrServices')return [original];
 const items=original.split(/[,;\n]/u).map(s=>s.trim());
 const allowed=field==='advantages'?commercial:offerings;
 if(items.length<2||items.length>8||items.some(s=>!allowed.has(s.toLowerCase())))return [original];
 // Duplicate entries are not additional authority; preserve legacy input without inventing IDs.
 if(new Set(items.map(s=>s.toLowerCase())).size!==items.length)return [original];
 return items;
}
