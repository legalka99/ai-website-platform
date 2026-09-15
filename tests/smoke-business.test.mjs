import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Existing local .env cannot override these explicit test environment values.
function run(key) {
  return spawnSync(process.execPath, ['scripts/smoke-business.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, OPENAI_API_KEY: key, KLEO_AI_MODEL: 'test-model',
      KLEO_AI_TIMEOUT_MS: '100', KLEO_AI_MAX_OUTPUT_TOKENS: '1000' },
  });
}
test('manual smoke without a key fails with a local configuration message', () => {
  const result = run('');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /OPENAI_API_KEY/);
  assert.equal(result.stdout, '');
});
test('manual smoke with configuration still requires explicit paid-call opt-in', () => {
  const result = run('TEST_ONLY_NOT_A_REAL_KEY');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Запрос не отправлен/);
  assert.match(result.stderr, /--confirm-paid-request/);
  assert.ok(!result.stderr.includes('TEST_ONLY_NOT_A_REAL_KEY'));
  assert.equal(result.stdout, '');
});
