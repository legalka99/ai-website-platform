import { httpSecurityDefaults } from '../../../packages/security/src/http.js';
export interface ApiConfig {production:boolean;apiOrigin:string;origins:readonly string[];sessionSeconds:number;loginLimit:number}
export function validateConfig(config:ApiConfig):ApiConfig {
 if(typeof config.production!=='boolean'||!Array.isArray(config.origins)||!config.origins.length||config.origins.length>10)throw Error('Invalid API config');
 httpSecurityDefaults(config.production,[config.apiOrigin,...config.origins]);
 if(!config.production&&[config.apiOrigin,...config.origins].some(s=>!['localhost','127.0.0.1','[::1]'].includes(new URL(s).hostname)))throw Error('Development must use loopback origins');
 if(!Number.isInteger(config.sessionSeconds)||config.sessionSeconds<300||config.sessionSeconds>604800||!Number.isInteger(config.loginLimit)||config.loginLimit<1||config.loginLimit>20)throw Error('Invalid API bounds');
 return Object.freeze({...config,origins:Object.freeze([...config.origins])});
}
export function readApiConfig(env:NodeJS.ProcessEnv):ApiConfig {
 if(!['development','test','production'].includes(env.NODE_ENV??'development'))throw Error('Invalid API environment');
 return validateConfig({production:env.NODE_ENV==='production',apiOrigin:env.KLEO_API_ORIGIN??'http://localhost:3001',origins:(env.KLEO_API_ALLOWED_ORIGINS??'http://localhost:3000').split(','),sessionSeconds:Number(env.KLEO_SESSION_SECONDS??28800),loginLimit:10});
}
