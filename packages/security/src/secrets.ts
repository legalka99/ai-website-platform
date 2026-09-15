import type { Actor, AuthorizationPolicy, ProjectResource } from './authorization.js';
import { SecurityError } from './errors.js';
export interface IntegrationCredentialRef extends ProjectResource { id: string; provider: string; secretRef: string }
export interface SecretRequest extends ProjectResource { secretRef: string; provider: string }
/** Server infrastructure only. Never inject this capability into an agent or expose it as a tool. */
export interface SecretProvider { resolve(request: SecretRequest): Promise<string> }
export interface LocalSecretEntry extends SecretRequest { value: string }
export class LocalSecretProvider implements SecretProvider {
  #entries: Map<string, LocalSecretEntry>;
  constructor(entries: readonly LocalSecretEntry[], environment: 'development' | 'test') {
    if (!['development', 'test'].includes(environment)) throw new SecurityError('SECRET_UNAVAILABLE');
    this.#entries = new Map();
    for (const entry of entries) {
      if (!entry.value || !entry.projectId || !entry.organizationId || !entry.provider || !entry.secretRef || this.#entries.has(entry.secretRef)) throw new SecurityError('SECRET_UNAVAILABLE');
      this.#entries.set(entry.secretRef, { ...entry });
    }
  }
  async resolve(request: SecretRequest): Promise<string> {
    const entry = this.#entries.get(request.secretRef);
    if (!entry || entry.projectId !== request.projectId || entry.organizationId !== request.organizationId || entry.provider !== request.provider) throw new SecurityError('SECRET_UNAVAILABLE');
    return entry.value;
  }
}
/** Resolves a server-owned reference after authorization; callback is trusted adapter code, NEVER LLM code. */
export class CredentialService {
  #refs: readonly IntegrationCredentialRef[];
  #store: SecretProvider;
  #auth: AuthorizationPolicy;
  constructor(refs: readonly IntegrationCredentialRef[], store: SecretProvider, auth: AuthorizationPolicy) {
    this.#refs = refs.map(x => ({ ...x })); this.#store = store; this.#auth = auth;
    if (new Set(refs.map(x => x.id)).size !== refs.length) throw new SecurityError('SECRET_UNAVAILABLE');
  }
  async use<T>(actor: Actor, resource: ProjectResource, id: string, provider: string, operation: (secret: string) => Promise<T>): Promise<T> {
    if (!this.#auth.authorize(actor, 'manage_credentials', resource)) throw new SecurityError('ACCESS_DENIED');
    const ref = this.#refs.find(x => x.id === id && x.provider === provider && x.projectId === resource.projectId && x.organizationId === resource.organizationId);
    if (!ref) throw new SecurityError('ACCESS_DENIED');
    try { return await operation(await this.#store.resolve(ref)); } catch { throw new SecurityError('SECRET_UNAVAILABLE'); }
  }
}
