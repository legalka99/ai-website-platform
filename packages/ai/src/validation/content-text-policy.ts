import { designTextViolation } from './design-direction-validator.js';

// Match instruction phrases, not substrings in ordinary stylistic adjectives.
const injection = /\b(?:ignore|disregard|override|forget)\s+(?:(?:all|the|any|previous|prior|system|safety)\s+)*(?:instructions?|rules?|polic(?:y|ies)|restrictions?)\b|\b(?:reveal|show|print|expose|extract)\s+(?:(?:the|your|hidden|system|developer)\s+)*(?:prompt|instructions)\b|\b(?:switch|change)\s+(?:your\s+)?role\b|\b(?:bypass|disable|evade)\s+(?:(?:all|the|system|security|safety)\s+)*(?:checks?|filters?|rules?|restrictions?|limits?|guardrails?)\b|\b(?:jailbreak|DAN\s+mode|developer\s+mode)\b|(?:игнорируй|игнорировать|забудь|отмени|не\s+соблюдай)\s+(?:(?:все|предыдущие|системные|эти)\s+)*(?:инструкции|правила|ограничения)|(?:покажи|раскрой|выведи)\s+(?:(?:системный|скрытый|свой)\s+)*(?:промпт|инструкции)|(?:смени|измени)\s+(?:свою\s+)?роль|(?:обойди|отключи|обход)\s+(?:(?:все|системные|эти)\s+)*(?:ограничения|защиту|проверки)|режим\s+(?:разработчика|без\s+ограничений)/iu;
const shell = /(?:^|[;\n])\s*(?:id|whoami|uname|pwd|ls|cat|touch|mkdir|rmdir|cp|mv|sleep|sh|zsh|python\d*|node|npm|npx|git)\b|\b(?:run|execute)\s+(?:a\s+)?(?:shell|command|code)\b|(?:выполни|запусти)\s+(?:команду|код|shell)/iu;

/** Keep the shared markup/URL/code/credential policy. Only the ordinary semicolon
 * punctuation in tone descriptions is checked as a comma; the original output is unchanged.
 * This is a bounded heuristic, never authorization or proof against every jailbreak. */
export function contentTextViolation(value:string,allowTonePunctuation=false):string|undefined {
  if(injection.test(value)) return 'UNSAFE_PROMPT_INJECTION';
  if(shell.test(value)) return 'UNSAFE_SHELL';
  const prose=value.replace(/\r?\n/g,' ');
  return designTextViolation(allowTonePunctuation?prose.replace(/;/g,','):prose);
}
export function isSafeContentText(value:string,allowTonePunctuation=false):boolean {
  return contentTextViolation(value,allowTonePunctuation)===undefined;
}
