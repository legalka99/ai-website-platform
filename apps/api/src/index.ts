import {configuredBlockFactory,BlockLaunchService,safeApiRuntimeIdentity} from './block-launch.js';
import {configuredWorkflowFactory,WorkflowLaunchService} from './workflow-launch.js';
import { readFile,stat } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { Pool } from 'pg';
import { AuthRepository } from '../../../packages/persistence/src/auth.js';
import { createApi } from './server.js';
import { readApiConfig } from './config.js';
let pool:Pool|undefined;
try{
 const config=readApiConfig(process.env);
 if(!process.env.PGHOST||!process.env.PGDATABASE||!process.env.PGUSER)throw Error();
 if(config.production&&(!process.env.KLEO_API_TLS_KEY_FILE||!process.env.KLEO_API_TLS_CERT_FILE))throw Error();
 const https=config.production?{key:await readFile(process.env.KLEO_API_TLS_KEY_FILE!),cert:await readFile(process.env.KLEO_API_TLS_CERT_FILE!)}:undefined;
 pool=new Pool({max:10,connectionTimeoutMillis:5000});pool.on('error',()=>console.error('Database connection unavailable.'));
 const auth=await AuthRepository.create(pool,config.sessionSeconds);
 const origin=new URL(config.apiOrigin),configuredApiPort=Number(origin.port||(config.production?443:80));
 const artifact=new URL(import.meta.url),artifactBytes=await readFile(artifact),artifactStat=await stat(artifact);
 const runtime=safeApiRuntimeIdentity({buildIdentifier:createHash('sha256').update(artifactBytes).digest('hex').slice(0,16),buildTimestamp:artifactStat.mtime.toISOString(),sourceArtifact:'.test-build/apps/api/src/index.js',processPid:process.pid,configuredApiPort});if(!runtime)throw Error();
 const factory=configuredWorkflowFactory(process.env);
 const workflows=factory?new WorkflowLaunchService(pool,factory,undefined,event=>console.log(JSON.stringify(event))):undefined;
 const blockFactory=configuredBlockFactory(process.env);const blocks=blockFactory?new BlockLaunchService(pool,blockFactory,event=>console.log(JSON.stringify(event)),runtime):undefined;
 const app=await createApi(auth,config,{blocks,workflows,https,log:entry=>console.log(JSON.stringify(entry))});
 await app.listen({host:'127.0.0.1',port:configuredApiPort});
 console.log(JSON.stringify({event:'api_runtime_started',...runtime}));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().then(()=>pool!.end()).then(()=>process.exit(0));});
}catch{console.error('API startup failed. Check explicit server configuration.');await pool?.end();process.exitCode=1;}
