import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes,randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migratePool } from './persistence-db.mjs';
const exec=promisify(execFile),name=`kleo-persistence-test-${randomUUID()}`,password=randomBytes(32).toString('hex');
let started=false,pool;
try{
 // Separate ephemeral container, random loopback port, no host mounts or existing database URL.
 await exec('docker',['run','--detach','--rm','--name',name,'--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=kleo_test','postgres:17'],{env:{...process.env,POSTGRES_PASSWORD:password},timeout:180000,maxBuffer:1024*1024});started=true;
 const {stdout}=await exec('docker',['port',name,'5432/tcp']);const port=Number(stdout.trim().split(':').at(-1));if(!Number.isInteger(port))throw Error();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'kleo_test',max:4,connectionTimeoutMillis:1000});
 let ready=false;for(let i=0;i<60;i++){try{await pool.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!ready)throw Error();await migratePool(pool);await migratePool(pool);
 const child=spawn(process.execPath,['--test','tests/persistence/postgres.test.mjs'],{stdio:'inherit',env:{...process.env,KLEO_ISOLATED_DB_TEST:'1',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'postgres',PGPASSWORD:password,PGDATABASE:'kleo_test',PGSSLMODE:'disable'}});
 process.exitCode=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code??1));});
}catch{console.error('Isolated PostgreSQL check failed; credentials and upstream output omitted.');process.exitCode=1;}
finally{await pool?.end();if(started)await exec('docker',['rm','--force',name]).catch(()=>{});}
