import {prepareOwnerWorkflow,ownerWorkflowView} from '../../../packages/persistence/src/owner-workflow.js';
import {WORKFLOW_LIMITS} from '../../../packages/core/src/workflow-launch.js';
import type {WorkflowLaunchService} from './workflow-launch.js';
import { createOrganization, createOwnerProject, saveBusinessBrief, getBusinessBrief } from '../../../packages/persistence/src/owner-writes.js';
import { briefFields } from '../../../packages/core/src/business-brief.js';
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
import { adminList,adminDetail,adminDashboard,type AdminFilter } from '../../../packages/persistence/src/admin.js';
import type { AdminKind } from '../../../packages/core/src/admin-api.js';
const id={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const paging={limit:{type:'string',pattern:'^(?:[1-9]|[1-4][0-9]|50)$'},offset:{type:'string',pattern:'^(?:0|[1-9][0-9]{0,3}|10000)$'}};
const page=(query:any):Page=>({limit:Number(query.limit??20),offset:Number(query.offset??0)});
export interface SafeRequestLog {requestId:string;method:string;route:string;status:number}
export async function createApi(auth:AuthRepository,config:ApiConfig,options:{workflows?:WorkflowLaunchService;https?:ServerOptions;log?:(entry:SafeRequestLog)=>void}={}){
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
 const adminFilters:Record<AdminKind,readonly (keyof AdminFilter)[]>={users:[],organizations:[],projects:['organizationId'],workflows:['organizationId','projectId'],websites:['projectId'],versions:['projectId','websiteId'],qa:['projectId','workflowId'],usage:['projectId','workflowId'],'audit-events':[]};
 for(const kind of Object.keys(adminFilters) as AdminKind[]){
  const keys=adminFilters[kind],filters=Object.fromEntries(keys.map(key=>[key,id]));
  app.get(`/api/v1/admin/${kind}`,{schema:{querystring:object({...paging,...filters},[])}},req=>session(req,async(db,actor)=>{
   rate('actor',actor.userId,'admin',30);const query=req.query as Record<string,string>;
   return adminList(auth,db,actor,kind,page(query),req.id,Object.fromEntries(keys.filter(key=>query[key]!==undefined).map(key=>[key,query[key]])));
  }));
 }
 for(const kind of ['organizations','users','projects','workflows'] as const)app.get(`/api/v1/admin/${kind}/:id`,{schema:{querystring:emptyQuery,params:object({id})}},req=>session(req,async(db,actor)=>{
  rate('actor',actor.userId,'admin',30);return adminDetail(auth,db,actor,kind,(req.params as {id:string}).id,req.id);
 }));
 app.get('/api/v1/admin/dashboard',{schema:{querystring:emptyQuery}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'admin',30);return adminDashboard(auth,db,actor,req.id);}));
 const nameBody=object({operationId:id,name:{type:'string',minLength:1,maxLength:200}});
 app.post('/api/v1/admin/organizations',{schema:{querystring:emptyQuery,body:nameBody}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'owner-write',20);return createOrganization(db,actor,req.body,req.id);}));
 app.post('/api/v1/admin/organizations/:organizationId/projects',{schema:{querystring:emptyQuery,params:object({organizationId:id}),body:nameBody}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'owner-write',20);return createOwnerProject(db,actor,(req.params as {organizationId:string}).organizationId,req.body,req.id);}));
 app.get('/api/v1/admin/projects/:projectId/brief',{schema:{querystring:emptyQuery,params:object({projectId:id})}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'admin',30);return getBusinessBrief(auth,db,actor,(req.params as {projectId:string}).projectId,req.id);}));
 app.post('/api/v1/admin/projects/:projectId/brief',{bodyLimit:32768,schema:{querystring:emptyQuery,params:object({projectId:id}),body:object({operationId:id,organizationId:id,expectedVersion:{type:'integer',minimum:0,maximum:1000000},brief:object(Object.fromEntries(Object.entries(briefFields).map(([key,f])=>[key,{type:f.required?'string':['string','null'],maxLength:f.max}])))})}},req=>session(req,async(db,actor)=>{rate('actor',actor.userId,'owner-write',20);return saveBusinessBrief(db,actor,(req.params as {projectId:string}).projectId,req.body,req.id);}));
 app.post('/api/v1/admin/projects/:projectId/workflows',{schema:{querystring:emptyQuery,params:object({projectId:id}),body:object({briefVersionId:id,idempotencyKey:id})}},async(req,reply)=>{
  const projectId=(req.params as {projectId:string}).projectId;
  const launch=await session(req,async(db,actor)=>{rate('actor',actor.userId,'workflow-launch',5);return prepareOwnerWorkflow(db,actor,projectId,req.body,req.id,!!options.workflows);}) as Awaited<ReturnType<typeof prepareOwnerWorkflow>>;
  // Release authenticated DB transaction before awaiting any provider. Browser disconnect is not cancellation.
  if(launch.created){req.raw.socket.setTimeout?.(WORKFLOW_LIMITS.timeoutMs+30000);try{await options.workflows!.execute(launch);}catch{throw new AuthError('UNAVAILABLE');}}
  reply.code(launch.created?201:200);return {runId:launch.runId};
 });
 app.get('/api/v1/admin/projects/:projectId/workflow-state',{schema:{params:object({projectId:id}),querystring:object({workflowId:id},[])}},req=>session(req,async(db,actor)=>{
  rate('actor',actor.userId,'workflow-status',20);return {available:!!options.workflows,limits:WORKFLOW_LIMITS,run:await ownerWorkflowView(auth,db,actor,(req.params as {projectId:string}).projectId,req.id,(req.query as {workflowId?:string}).workflowId)};
 }));
 // Public registration, role mutation and publishing have no routes.
 await app.ready();return app;
}
