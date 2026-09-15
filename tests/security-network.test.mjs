import test from 'node:test';
import assert from 'node:assert/strict';
import { validateURL, validateDestination, isPublicAddress, TestWebhookSigner, TestWebhookVerifier, InMemoryReplayStore } from '../.test-build/packages/security/src/index.js';
for (const value of ['https://localhost/', 'https://localhost./', 'https://a.local/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://10.2.3.4/', 'https://172.31.1.2/', 'https://192.168.1.2/', 'https://100.64.0.1/', 'https://169.254.169.254/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fe80::1]/', 'https://[fc00::1]/', 'https://metadata.google.internal/', 'file:///etc/passwd', 'ftp://example.com/a', 'unix:///tmp/socket', 'http://example.com/', 'https://name:pass@example.com/', 'https://example.com/?token=value', 'https://example.com:444/', 'https://example.com\\@localhost/']) test(`SSRF blocks ${value}`, () => assert.throws(() => validateURL(value)));
test('public https accepted; http requires explicit policy without private-network bypass', () => {
  assert.equal(validateURL('https://example.com/path').hostname, 'example.com');
  assert.equal(validateURL('http://example.com', { allowHttp: true }).protocol, 'http:');
  assert.throws(() => validateURL('http://localhost', { allowHttp: true }));
  assert.throws(() => validateURL('https://example.com', { allowedHosts: ['approved.com'] }));
  assert.equal(isPublicAddress('8.8.8.8'), true); assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('DNS checks every A/AAAA result and rejects mixed private responses and empty DNS', async () => {
  for (const addresses of [[], ['8.8.8.8', '10.0.0.1'], ['8.8.8.8', '::1']]) await assert.rejects(validateDestination('https://example.com', async () => addresses));
  const result = await validateDestination('https://example.com', async () => ['8.8.8.8']);
  assert.deepEqual(result.addresses, ['8.8.8.8']); assert.ok(Object.isFrozen(result.addresses));
});
test('redirect destinations, DNS rebinding, redirect count and HTTPS downgrade checked', async () => {
  let calls = 0; const dns = async () => ++calls === 1 ? ['8.8.8.8'] : ['127.0.0.1'];
  const initial = await validateDestination('https://example.com', dns);
  await assert.rejects(validateDestination('/next', dns, {}, initial));
  await assert.rejects(validateDestination('https://169.254.169.254/', async () => ['8.8.8.8'], {}, initial));
  await assert.rejects(validateDestination('/next', async () => ['8.8.8.8'], { maxRedirects: 0 }, initial));
  await assert.rejects(validateDestination('http://example.com', async () => ['8.8.8.8'], { allowHttp: true }, initial));
  const next = await validateDestination('/next', async () => ['8.8.8.8'], {}, initial); assert.equal(next.redirectCount, 1);
});
const key = 'TEST_ONLY_WEBHOOK_SIGNING_VALUE'; const now = 1800000000000;
const signer = new TestWebhookSigner(key);
function envelope(id='evt1') { const rawBody = Buffer.from('{"message":"test"}'); const timestamp = String(now); return { rawBody, timestamp, eventId:id, signature: signer.sign(rawBody, timestamp, id) }; }
const verifier = () => new TestWebhookVerifier(key, 'project-1/provider', new InMemoryReplayStore(), () => now);
test('webhook accepts signed raw body once and rejects replay', async () => { const verify = verifier(); assert.equal(await verify.verify(envelope()), true); assert.equal(await verify.verify(envelope()), false); });
test('webhook rejects absent/invalid signature and body mutation', async () => {
  for (const replacement of [{ signature: '' }, { signature: '0'.repeat(64) }, { rawBody: Buffer.from('{ "message": "test" }') }, { eventId: 'changed' }]) assert.equal(await verifier().verify({ ...envelope(), ...replacement }), false);
});
test('webhook rejects expired/future timestamp even if correctly signed', async () => {
  for (const timestamp of [String(now-300001), String(now+30001)]) { const e = { ...envelope(), timestamp }; e.signature = signer.sign(e.rawBody,e.timestamp,e.eventId); assert.equal(await verifier().verify(e), false); }
});
test('invalid signature does not poison replay store; scope isolates events', async () => {
  const store = new InMemoryReplayStore(); const v = new TestWebhookVerifier(key,'p1',store,()=>now);
  assert.equal(await v.verify({...envelope(),signature:'0'.repeat(64)}),false); assert.equal(await v.verify(envelope()),true);
  assert.equal(await new TestWebhookVerifier(key,'p2',store,()=>now).verify(envelope()),true);
});
