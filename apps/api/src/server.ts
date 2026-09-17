import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID,createHash } from 'node:crypto';
import type { ServerOptions } from 'node:https';
import { AuthRepository,AuthError,csrfToken,validCsrf,normalizeEmail,type Page,type AuthActor } from '../../../packages/persistence/src/auth.js';
import type { PoolClient } from 'pg';
import { httpSecurityDefaults } from '../../../packages/security/src/http.js';
import { InMemoryRateLimiter } from '../../../packages/security/src/rate-limit.js';
import { containsSecret } from '../../../packages/security/src/redaction.js';
import { validateConfig,type ApiConfig } from './config.js';
const id={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const paging={limit:{type:'string',pattern:'^(?:[1-9]|[1-4][0-9]|50)$'},offset:{type:'string',pattern:'^(?:0|[1-9][0-9]{0,3}|10000)$'}};
const page=(query:any):Page=>({limit:Number(query.limit??20),offset:Number(query.offset??0)});
export interface SafeRequestLog {requestId:string;method:string;route:string;status:number}
export async function createApi(auth:AuthRepository,config:ApiConfig,options:{https?:ServerOptions;log?:(entry:SafeRequestLog)=>void}={}){
 const c=validateConfig(config),security=httpSecurityDefaults(c.production,c.origins),limiter=new InMemoryRateLimiter();
 const app=Fastify({logger:false,trustProxy:false,requestIdHeader:false,genReqId:()=>randomUUID(),bodyLimit:8192,requestTimeout:15000,connectionTimeout:10000,keepAliveTimeout:5000,
  ajv:{customOptions:{removeAdditional:false,coerceTypes:false,useDefaults:false}},...(options.https?{https:options.https}:{})});
 await app.register(cookie);
 const cookieName=c.production?'__Host-kleo_session':'kleo_session';
 const cookieOptions={httpOnly:true,secure:c.production,sameSite:'strict' as const,path:'/',maxAge:c.sessionSeconds};
 const rate=(dimension:'ip'|'actor',subject:string,area:string,limit:number)=>{if(!limiter.consume({dimension,subject,projectId:area},limit,60000).allowed)throw new AuthError('RATE_LIMITED');};
 app.addHook('onRequest',async(req,reply)=>{
  for(const [name,value] of Object.entries(security.headers))reply.header(name,value);reply.header('X-Frame-Options','DENY').header('Cache-Control','no-store').header('X-Request-ID',req.id).header('Vary','Origin');
  if(req.headers.host!==new URL(c.apiOrigin).host)throw new AuthError('FORBIDDEN');
  if(c.production&&req.protocol!=='https')throw new AuthError('FORBIDDEN');
  const origin=req.headers.origin;
  if(origin!==undefined&&!c.origins.includes(origin))throw new AuthError('FORBIDDEN');
  if(origin){reply.header('Access-Control-Allow-Origin',origin).header('Access-Control-Allow-Credentials','true');}
  if(req.method==='OPTIONS'){
   if(!origin||!['GET','POST'].includes(String(req.headers['access-control-request-method']))||String(req.headers['access-control-request-headers']??'').split(',').some(h=>h.trim()&&!['content-type','x-csrf-token'].includes(h.trim().toLowerCase())))throw new AuthError('FORBIDDEN');
   reply.header('Access-Control-Allow-Methods','GET, POST').header('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token');return reply.code(204).send();
  }
  // Use the socket IP. X-Forwarded-* never affects limits or secure transport decisions.
  if(!limiter.consume({dimension:'ip',subject:req.ip,projectId:'http'},120,60000).allowed)return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Request limit reached.'},requestId:req.id});
  if(req.method==='POST'){
   if(!origin||!c.origins.includes(origin))throw new AuthError('FORBIDDEN');
   if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')return reply.code(415).send({error:{code:'UNSUPPORTED_MEDIA_TYPE',message:'JSON required.'},requestId:req.id});
  }
 });
 app.setErrorHandler((error,req,reply)=>{
  const e=error as any;let code='INTERNAL_ERROR',status=500;
  if(e.validation||['FST_ERR_CTP_INVALID_JSON_BODY','FST_ERR_CTP_EMPTY_JSON_BODY','FST_ERR_CTP_INVALID_CONTENT_LENGTH'].includes(e.code)){code='INVALID_INPUT';status=400;}
  else if(e.code==='FST_ERR_CTP_BODY_TOO_LARGE'){code='BODY_TOO_LARGE';status=413;}
  else if(e.code==='FST_ERR_CTP_INVALID_MEDIA_TYPE'){code='UNSUPPORTED_MEDIA_TYPE';status=415;}
  else if(e instanceof AuthError){code=e.code;status={INVALID_INPUT:400,INVALID_CREDENTIALS:401,UNAUTHENTICATED:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,UNAVAILABLE:503,RATE_LIMITED:429}[e.code];}
  reply.code(status).send({error:{code,message:code==='INVALID_CREDENTIALS'?'Invalid credentials.':'Request could not be completed.'},requestId:req.id});
 });
 app.setNotFoundHandler((req,reply)=>reply.code(404).send({error:{code:'NOT_FOUND',message:'Resource not found.'},requestId:req.id}));
 app.addHook('onResponse',async(req,reply)=>{try{options.log?.({requestId:req.id,method:req.method,route:req.routeOptions.url??'unmatched',status:reply.statusCode});}catch{/* Observability cannot alter authorization or response. */}});
 const session=async(req:any,work:(db:PoolClient,actor:AuthActor)=>Promise<unknown>)=>{
  const token=req.cookies[cookieName];return auth.withSession(token,req.id,async(db,actor)=>{
   rate('actor',actor.userId,'authenticated',100);
   if(req.method==='POST'&&!validCsrf(token,req.headers['x-csrf-token']))throw new AuthError('FORBIDDEN');
   return work(db,actor);
  });
 };
 const list=(data:unknown[],q:any)=>({data,pagination:{limit:page(q).limit,offset:page(q).offset}});
 const emptyQuery=object({},[]);
 app.get('/health',{schema:{querystring:emptyQuery}},async()=>({status:'ok'}));
 app.post('/api/v1/auth/login',{bodyLimit:2048,schema:{querystring:emptyQuery,body:object({email:{type:'string',minLength:3,maxLength:254},password:{type:'string',minLength:12,maxLength:128}})}},async(req,reply)=>{
  const {email,password}=req.body as {email:string;password:string};
  if(!limiter.consume({dimension:'ip',subject:req.ip,projectId:'login'},c.loginLimit,60000).allowed)return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Request limit reached.'},requestId:req.id});
  const normalized=normalizeEmail(email),key=createHash('sha256').update(normalized).digest('hex');
  if(!limiter.consume({dimension:'actor',subject:key,projectId:'login'},c.loginLimit,60000).allowed)return reply.code(429).send({error:{code:'RATE_LIMITED',message:'Request limit reached.'},requestId:req.id});
  const result=await auth.login(normalized,password,req.id);reply.setCookie(cookieName,result.token,cookieOptions);return {csrfToken:result.csrf};
 });
 app.get('/api/v1/auth/me',{schema:{querystring:emptyQuery}},req=>session(req,async(_db,actor)=>({user:{id:actor.userId,email:actor.email,platformRole:actor.platformRole},csrfToken:csrfToken(req.cookies[cookieName]!)})));
 app.post('/api/v1/auth/logout',{schema:{querystring:emptyQuery,body:object({},[])}},async(req,reply)=>{await session(req,(db,actor)=>auth.logout(db,actor,req.id));reply.clearCookie(cookieName,{...cookieOptions,maxAge:0});return {success:true};});
 app.get('/api/v1/organizations',{schema:{querystring:object(paging,[])}},req=>session(req,async(db,actor)=>list(await auth.organizations(db,actor,page(req.query)),req.query)));
 app.get('/api/v1/projects',{schema:{querystring:object({...paging,organizationId:id},[])}},req=>session(req,async(db,actor)=>list(await auth.projects(db,actor,page(req.query),(req.query as any).organizationId),req.query)));
 app.post('/api/v1/projects',{schema:{querystring:emptyQuery,body:object({organizationId:id,name:{type:'string',minLength:1,maxLength:200,pattern:'\\S'}})}},req=>session(req,async(db,actor)=>{
  const {organizationId,name}=req.body as {organizationId:string;name:string};if(containsSecret(name)||/[\u0000-\u001f\u007f]/.test(name))throw new AuthError('INVALID_INPUT');return auth.createProject(db,actor,organizationId,name,req.id);
 }));
 app.get('/api/v1/projects/:projectId',{schema:{params:object({projectId:id}),querystring:emptyQuery}},req=>session(req,(db,actor)=>auth.project(db,actor,(req.params as any).projectId)));
 const resources=[['workflows','/workflows'],['websites','/websites'],['versions','/websites/:websiteId/versions'],['qa','/versions/:versionId/qa'],['usage','/usage']] as const;
 for(const [kind,suffix] of resources){const params={projectId:id,...(kind==='versions'?{websiteId:id}:{}),...(kind==='qa'?{versionId:id}:{})};
  app.get(`/api/v1/projects/:projectId${suffix}`,{schema:{params:object(params),querystring:object(paging,[])}},req=>session(req,async(db,actor)=>{const p=req.params as any;return list(await auth.resources(db,actor,p.projectId,kind,page(req.query),p.websiteId,p.versionId),req.query);}));
 }
 for(const kind of ['users','organizations','projects','workflows'] as const)app.get(`/api/v1/admin/${kind}`,{schema:{querystring:object(paging,[])}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'admin',30);return list(await auth.admin(db,actor,kind,page(req.query),req.id),req.query);}));
 // Public registration, role mutation, publishing and AI execution have no routes.
 await app.ready();return app;
}
