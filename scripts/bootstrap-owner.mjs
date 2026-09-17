import { Pool } from 'pg';
import { AuthRepository } from '../.test-build/packages/persistence/src/auth.js';
// Password enters via bounded non-interactive stdin, never argv/env/logs.
let pool;
try{
 if(process.argv.slice(2).join(' ')!=='--confirm-bootstrap'||process.stdin.isTTY||!process.env.PGHOST||!process.env.PGDATABASE||!process.env.PGUSER)throw Error();
 let input='';for await(const chunk of process.stdin){input+=chunk.toString('utf8');if(Buffer.byteLength(input)>2048)throw Error();}
 const body=JSON.parse(input);if(!body||Object.keys(body).sort().join(',')!=='email,password'||typeof body.email!=='string'||typeof body.password!=='string')throw Error();
 pool=new Pool({max:1,connectionTimeoutMillis:5000});const auth=await AuthRepository.create(pool);await auth.bootstrapOwner(body.email,body.password);input='';body.password='';console.log('Platform owner created.');
}catch{console.error('Owner bootstrap failed; sensitive details omitted.');process.exitCode=1;}finally{await pool?.end();}
