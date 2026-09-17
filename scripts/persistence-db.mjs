import { Pool } from 'pg';
import { readdir,readFile } from 'node:fs/promises';
import { migrate } from '../.test-build/packages/persistence/src/migrations.js';
// No dotenv loading. The server/operator supplies credentials through its secret mechanism.
export async function loadMigrations(){const dir=new URL('../packages/persistence/migrations/',import.meta.url);return Promise.all((await readdir(dir)).filter(n=>n.endsWith('.sql')).sort().map(async name=>({name,sql:await readFile(new URL(name,dir),'utf8')})));}
export async function migratePool(pool){await migrate(pool,await loadMigrations());}
if(process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]){
 if(process.argv.slice(2).join(' ')!=='--confirm-migration'){console.error('Migration requires --confirm-migration and explicit PGHOST/PGDATABASE/PGUSER configuration.');process.exitCode=1;}
 else if(!process.env.PGHOST||!process.env.PGDATABASE||!process.env.PGUSER){console.error('Explicit database configuration is required.');process.exitCode=1;}
 else {const pool=new Pool({max:1,connectionTimeoutMillis:5000});try{await migratePool(pool);console.log('Migrations applied.');}catch{console.error('Migration failed; database details omitted.');process.exitCode=1;}finally{await pool.end();}}
}
