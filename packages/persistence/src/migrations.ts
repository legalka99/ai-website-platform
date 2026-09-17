import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PersistenceError } from './contracts.js';
export interface Migration {name:string;sql:string}
/** SQL is trusted, version-controlled application code, never user input. */
export async function migrate(pool:Pool,migrations:readonly Migration[]):Promise<void> {
 let client;
 try {
  client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(71442001)');
  await client.query('CREATE SCHEMA IF NOT EXISTS kleo');
  await client.query('CREATE TABLE IF NOT EXISTS kleo.schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied=await client.query('SELECT name,checksum FROM kleo.schema_migrations ORDER BY name');
  const names=migrations.map(m=>m.name);
  if(new Set(names).size!==names.length||names.some((n,i)=>!/^\d{3}_[a-z_]+\.sql$/.test(n)||i>0&&n<=names[i-1])||applied.rows.some((r,i)=>r.name!==names[i]))throw new PersistenceError('MIGRATION_MISMATCH');
  for(const m of migrations){const sum=createHash('sha256').update(m.sql).digest('hex'),existing=applied.rows.find(r=>r.name===m.name);
   if(existing){if(existing.checksum!==sum)throw new PersistenceError('MIGRATION_MISMATCH');continue;}
   await client.query(m.sql);await client.query('INSERT INTO kleo.schema_migrations(name,checksum) VALUES($1,$2)',[m.name,sum]);
  }
  await client.query('COMMIT');
 }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});throw e instanceof PersistenceError?e:new PersistenceError('DATABASE_FAILURE');}
 finally{client?.release();}
}
