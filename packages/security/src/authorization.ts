export type { User } from '../../core/src/entities.js';
export interface Organization { id: string; name: string }
/** Must come from a verified server session, never a request body or LLM. */
export interface Actor { id: string; authenticated: boolean }
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Permission = 'read' | 'write' | 'generate' | 'publish' | 'delete' | 'manage_credentials' | 'manage_members';
export interface ProjectResource { projectId: string; organizationId: string }
export interface ProjectMembership extends ProjectResource { actorId: string; role: Role }
const permissions: Record<Role, readonly Permission[]> = {
  owner: ['read', 'write', 'generate', 'publish', 'delete', 'manage_credentials', 'manage_members'],
  admin: ['read', 'write', 'generate', 'publish', 'manage_credentials', 'manage_members'],
  editor: ['read', 'write', 'generate'], viewer: ['read'],
};
/** Memberships are loaded from trusted server storage, not provided by the actor. */
export class AuthorizationPolicy {
  #memberships: readonly ProjectMembership[];
  constructor(memberships: readonly ProjectMembership[]) { this.#memberships = memberships.map(x => ({ ...x })); }
  authorize(actor: Actor, action: Permission, resource: ProjectResource): boolean {
    if (!actor?.authenticated || !actor.id || !resource?.projectId || !resource.organizationId) return false;
    return this.#memberships.some(m => m.actorId === actor.id && m.projectId === resource.projectId &&
      m.organizationId === resource.organizationId && Object.hasOwn(permissions, m.role) && permissions[m.role].includes(action));
  }
}
export interface ProjectBound { projectId: string }
export interface ProjectUsage extends ProjectBound { workflowId: string; provider: string; totalTokens?: number }
export interface ProjectWorkflow extends ProjectBound { id: string; organizationId: string }
