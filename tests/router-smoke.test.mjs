import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for(const mode of ['yandex','router']) test(`smoke ${mode} requires explicit opt-in, secrets absent from output`,()=>{
 const r=spawnSync(process.execPath,['scripts/smoke-business.mjs',`--provider=${mode}`],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:5000,env:{...process.env,NODE_ENV:'test',YANDEX_API_KEY:'TEST_ONLY_YANDEX_KEY',KLEO_YANDEX_FOLDER_ID:'test-folder',KLEO_YANDEX_MODEL:'yandexgpt/latest',KLEO_YANDEX_TIMEOUT_MS:'100',KLEO_YANDEX_MAX_OUTPUT_TOKENS:'1000',KLEO_AI_PRIMARY_PROVIDER:'yandex',KLEO_AI_FALLBACK_PROVIDER:''}});
 assert.equal(r.status,1);assert.match(r.stderr,/Запрос не отправлен/);assert.ok(!r.stderr.includes('TEST_ONLY_YANDEX_KEY'));assert.equal(r.stdout,'');
});
