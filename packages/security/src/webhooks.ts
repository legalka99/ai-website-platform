import { createHmac, timingSafeEqual } from 'node:crypto';
export interface WebhookEnvelope { rawBody: Uint8Array; timestamp: string; eventId: string; signature: string }
export interface WebhookVerifier { verify(envelope: WebhookEnvelope): Promise<boolean> }
export interface ReplayStore { claim(key: string, expiresAt: number, now: number): boolean }
/** Process-local test store; production must use atomic, durable, shared replay storage. */
export class InMemoryReplayStore implements ReplayStore {
  #seen = new Map<string, number>();
  claim(key: string, expiresAt: number, now: number): boolean {
    for (const [id, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(id);
    if (this.#seen.has(key) || this.#seen.size >= 10000 || expiresAt <= now) return false;
    this.#seen.set(key, expiresAt); return true;
  }
}
/** TEST protocol only. Provider adapters must implement their exact documented raw-body signature format. */
export class TestWebhookSigner {
  #secret: string;
  constructor(secret: string) { if (secret.length < 16) throw new Error('Invalid test signing configuration'); this.#secret = secret; }
  sign(rawBody: Uint8Array, timestamp: string, eventId: string): string {
    return createHmac('sha256', this.#secret).update(`${timestamp}.${eventId}.`).update(rawBody).digest('hex');
  }
}
export class TestWebhookVerifier implements WebhookVerifier {
  #signer: TestWebhookSigner;
  constructor(secret: string, private readonly scope: string, private readonly replay: ReplayStore,
    private readonly now = () => Date.now(), private readonly windowMs = 300000) {
    this.#signer = new TestWebhookSigner(secret);
    if (!scope || !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 600000) throw new Error('Invalid test webhook configuration');
  }
  async verify(envelope: WebhookEnvelope): Promise<boolean> {
    try {
      const { rawBody, timestamp, eventId, signature } = envelope;
      if (!(rawBody instanceof Uint8Array) || rawBody.byteLength > 1048576 || !/^\d{13}$/.test(timestamp) ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(eventId) || !/^[a-f0-9]{64}$/.test(signature)) return false;
      const time = Number(timestamp), now = this.now();
      if (time <= now - this.windowMs || time > now + 30000) return false;
      const expected = Buffer.from(this.#signer.sign(rawBody, timestamp, eventId), 'hex');
      if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return false;
      return this.replay.claim(JSON.stringify([this.scope, eventId]), time + this.windowMs, now);
    } catch { return false; }
  }
}
