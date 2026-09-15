import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact, redactText, containsSecret, SafeLogger, LocalSecretProvider, CredentialService, AuthorizationPolicy, validateExternal, assertLocalEnvFile } from '../.test-build/packages/security/src/index.js';
const secret = 'TEST_ONLY_PRIVATE_VALUE';
const resource = { projectId: 'p1', organizationId: 'o1' };
const actor = { id: 'u1', authenticated: true };
const ref = { ...resource, id: 'cred1', provider: 'cms', secretRef: 'vault/p1/cms' };
const auth = new AuthorizationPolicy([{ ...resource, actorId: actor.id, role: 'owner' }]);
const store = () => new LocalSecretProvider([{ ...ref, value: secret }], 'test');

test('redacts OpenAI-like keys, bearer, private keys and string assignments', () => {
  const key = 'sk-' + 'a'.repeat(32);
  for (const input of [key, `Bearer ${secret}`, `Api-Key ${secret}`, `Authorization: Basic ${secret}`, `password=${secret}`, `token: ${secret}`, `{"password":"${secret}"}`, `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`]) {
    assert.ok(containsSecret(input)); assert.ok(!redactText(input).includes(secret)); assert.ok(!redactText(input).includes(key));
  }
});
test('redacts arbitrary known secrets and nested sensitive fields', () => {
  const result = JSON.stringify(redact({ authorization: secret, headers: { Authorization: secret }, apiKey: secret,
    data: { password: secret, accessToken: secret, cmsCredentials: secret }, message: secret }, [secret]));
  assert.ok(!result.includes(secret)); assert.match(result, /REDACTED/);
  assert.deepEqual(redact({totalTokens:42}).totalTokens,42); assert.equal(redact({totalTokens:secret}).totalTokens,'[REDACTED]');
});
test('upstream Error, cause and stack never escape redaction', () => {
  const error = new Error(secret, { cause: new Error(secret) }); error.debug = secret;
  assert.ok(!JSON.stringify(redact(error)).includes(secret));
});
test('redaction handles cycles and does not execute getters or toJSON', () => {
  const data = { safe: 'value', toJSON() { throw new Error(secret); } }; data.self = data;
  Object.defineProperty(data, 'other', { enumerable: true, get() { assert.fail('getter invoked'); } });
  assert.doesNotThrow(() => JSON.stringify(redact(data)));
  const list=[]; Object.defineProperty(list,'0',{get(){assert.fail('array getter invoked');}}); assert.deepEqual(redact(list),['[ACCESSOR]']);
});
test('safe structured logger omits bodies, prompts, env, headers and arbitrary fields', () => {
  const logs = []; const logger = new SafeLogger(x => logs.push(JSON.parse(x)), { knownSecrets: [secret] });
  logger.log('info', 'ai.completed', { projectId: 'p1', count: 1, body: secret, prompt: secret, env: secret, headers: { Authorization: secret }, error: new Error(secret) });
  assert.equal(logs.length, 1); assert.equal(logs[0].event, 'ai.completed'); assert.equal(logs[0].projectId, 'p1');
  assert.ok(!JSON.stringify(logs).includes(secret)); assert.equal(logs[0].headers, undefined);
});
test('production and default debug disabled, development debug explicit', () => {
  const logs = []; for (const options of [{}, { production: true, debug: true }, { production: false }]) new SafeLogger(x => logs.push(x), options).log('debug', 'test.debug');
  assert.equal(logs.length, 0); new SafeLogger(x => logs.push(x), { production: false, debug: true }).log('debug', 'test.debug'); assert.equal(logs.length, 1);
});
test('logger rejects free-form event text and contains sink failures', () => {
  const logs = []; new SafeLogger(x => logs.push(x)).log('error', `Error ${secret}`); assert.ok(!logs[0].includes(secret));
  assert.doesNotThrow(() => new SafeLogger(() => { throw new Error(secret); }).log('info', 'test.event'));
});
test('local secrets are not serializable and production local store is denied', async () => {
  assert.equal(JSON.stringify(store()), '{}'); assert.equal(await store().resolve(ref), secret);
  assert.throws(() => new LocalSecretProvider([{ ...ref, value: secret }], 'production'));
});
for (const replacement of [{ projectId: 'p2' }, { organizationId: 'o2' }, { provider: 'other' }, { secretRef: 'other' }]) test('secret lookup rejects mismatched tenant/provider/reference', async () => {
  await assert.rejects(store().resolve({ ...ref, ...replacement }), error => !String(error).includes(secret));
});
test('credential service authorizes reference and sanitizes adapter failures', async () => {
  const service = new CredentialService([ref], store(), auth);
  assert.equal(await service.use(actor, resource, 'cred1', 'cms', async value => value === secret), true);
  await assert.rejects(service.use(actor, { ...resource, projectId: 'p2' }, 'cred1', 'cms', async () => assert.fail('adapter reached')));
  await assert.rejects(service.use(actor, resource, 'cred1', 'cms', async () => { throw new Error(secret); }), error => !String(error.stack).includes(secret));
});
test('credential scope is checked again by store even with forged local reference', async () => {
  const other = { projectId: 'p2', organizationId: 'o1' };
  const policy = new AuthorizationPolicy([{ ...other, actorId: actor.id, role: 'owner' }]);
  const service = new CredentialService([{ ...ref, ...other }], store(), policy);
  await assert.rejects(service.use(actor, other, 'cred1', 'cms', async () => assert.fail('adapter reached')));
});
test('external boundary bounds strings, arrays, recursion, bytes, schema and unknown fields', () => {
  const limits = { maxBytes: 100, maxString: 20, maxArray: 2, maxDepth: 2, maxNodes: 10 };
  const schema = x => typeof x?.kind === 'string' && ['a', 'b'].includes(x.kind) && Object.keys(x).length === 1;
  assert.deepEqual(validateExternal({ kind: 'a' }, schema, limits), { kind: 'a' });
  for (const value of [{ kind: 'c' }, { kind: 'a', extra: true }, { kind: 'a'.repeat(21) }, [1,2,3], { a: { b: { c: true } } }, JSON.parse('{"__proto__":1}'), new Date()]) assert.throws(() => validateExternal(value, schema, limits));
  assert.throws(() => validateExternal('я'.repeat(10), () => true, { ...limits, maxBytes: 15 }));
});
test('input validator never invokes accessors or toJSON', () => {
  const obj = {}; Object.defineProperty(obj, 'kind', { get() { assert.fail('getter'); }, enumerable: true });
  assert.throws(() => validateExternal(obj, () => true)); assert.throws(() => validateExternal({ toJSON() { assert.fail('toJSON'); } }, () => true));
});
test('local env policy enforces owner permissions, no symlinks and no production dotenv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kleo-env-test-')); const file = join(dir, '.env');
  try {
    writeFileSync(file, '# TEST ONLY\n', { mode: 0o600 }); assert.doesNotThrow(() => assertLocalEnvFile(file, 'test'));
    assert.throws(() => assertLocalEnvFile(file, 'production'));
    chmodSync(file, 0o644); if (process.platform !== 'win32') assert.throws(() => assertLocalEnvFile(file, 'development'));
    const link = join(dir, 'link'); symlinkSync(file, link); assert.throws(() => assertLocalEnvFile(link, 'test'));
  } finally { rmSync(dir, { recursive: true }); }
});
