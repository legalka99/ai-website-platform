import { createHash, randomUUID } from 'node:crypto';
import type { Actor, AuthorizationPolicy, Permission, ProjectResource } from './authorization.js';
export const DANGEROUS_ACTIONS = Object.freeze(['publish', 'delete', 'external_cms_write', 'domain_change', 'credential_change', 'send_external_message', 'production_deploy'] as const);
export type DangerousAction = typeof DANGEROUS_ACTIONS[number];
export interface ToolDefinition { name: string; permission: Permission; action: 'read' | 'generate' | DangerousAction }
export interface ToolPermission { agentId: string; tools: readonly string[] }
export interface ToolExecutionContext extends ProjectResource { actor: Actor; agentId: string; planTools: readonly string[]; projectTools: readonly string[]; userAllowedTools: readonly string[]; previewId?: string; approvalId?: string; payloadHash: string }
export type ToolDecision = { allowed: true } | { allowed: false; reason: 'UNKNOWN_TOOL' | 'DENIED' | 'APPROVAL_REQUIRED' };
export function previewDigest(serializedAction: string): string { return createHash('sha256').update(serializedAction).digest('hex'); }
export type ApprovalState = 'draft' | 'preview' | 'approved' | 'executed';
interface ApprovalRecord extends ProjectResource { id: string; actorId: string; tool: string; payloadHash: string; state: ApprovalState; expiresAt: number }
/** Server-owned, process-local prototype. IDs bind approval to actor/project/tool/exact preview digest.
 * Do not expose transition methods to an LLM. Production needs durable records and atomic execution.
 */
export class ApprovalStore {
  #records = new Map<string, ApprovalRecord>();
  constructor(private readonly now = () => Date.now()) {}
  draft(context: ToolExecutionContext, tool: string): string {
    for (const [key, value] of this.#records) if (value.expiresAt <= this.now()) this.#records.delete(key);
    if (!context.actor.authenticated || this.#records.size >= 10000 || !/^[a-f0-9]{64}$/.test(context.payloadHash)) throw new Error('Invalid approval request');
    const id = randomUUID();
    this.#records.set(id, { id, actorId: context.actor.id, projectId: context.projectId, organizationId: context.organizationId,
      tool, payloadHash: context.payloadHash, state: 'draft', expiresAt: this.now() + 300000 }); return id;
  }
  #match(id: string, context: ToolExecutionContext, tool: string): ApprovalRecord | undefined {
    const r = this.#records.get(id);
    return r && r.expiresAt > this.now() && r.actorId === context.actor.id && r.projectId === context.projectId &&
      r.organizationId === context.organizationId && r.tool === tool && r.payloadHash === context.payloadHash ? r : undefined;
  }
  preview(id: string, context: ToolExecutionContext, tool: string): boolean {
    const r = this.#match(id, context, tool); if (!r || r.state !== 'draft') return false; r.state = 'preview'; return true;
  }
  approve(id: string, context: ToolExecutionContext, tool: string): boolean {
    const r = this.#match(id, context, tool); if (!r || r.state !== 'preview') return false; r.state = 'approved'; return true;
  }
  consume(context: ToolExecutionContext, tool: string): boolean {
    if (!context.approvalId || context.previewId !== context.approvalId) return false;
    const r = this.#match(context.approvalId, context, tool); if (!r || r.state !== 'approved') return false; r.state = 'executed'; return true;
  }
}
export class ToolPolicy {
  #tools: readonly ToolDefinition[]; #agents: readonly ToolPermission[];
  constructor(tools: readonly ToolDefinition[], agents: readonly ToolPermission[], private readonly authorization: AuthorizationPolicy, private readonly approvals: ApprovalStore) {
    this.#tools = tools.map(x => ({ ...x })); this.#agents = agents.map(x => ({ ...x, tools: [...x.tools] }));
    if (new Set(tools.map(t => t.name)).size !== tools.length) throw new Error('Duplicate tool definition');
  }
  /** Call immediately before execution, with server-derived context and digest. Successful dangerous decisions consume approval. */
  authorizeExecution(name: string, context: ToolExecutionContext): ToolDecision {
    const tool = this.#tools.find(t => t.name === name);
    if (!tool) return { allowed: false, reason: 'UNKNOWN_TOOL' };
    const required: Record<ToolDefinition['action'], Permission> = { read: 'read', generate: 'generate', publish: 'publish', delete: 'delete',
      external_cms_write: 'publish', domain_change: 'manage_credentials', credential_change: 'manage_credentials', send_external_message: 'publish', production_deploy: 'publish' };
    if (!Object.hasOwn(required, tool.action) || !this.authorization.authorize(context.actor, required[tool.action], context)) return { allowed: false, reason: 'DENIED' };
    if (!['read', 'generate', ...DANGEROUS_ACTIONS].includes(tool.action) ||
      !this.#agents.some(p => p.agentId === context.agentId && p.tools.includes(name)) ||
      !context.planTools.includes(name) || !context.projectTools.includes(name) || !context.userAllowedTools.includes(name) ||
      !this.authorization.authorize(context.actor, tool.permission, context)) return { allowed: false, reason: 'DENIED' };
    if ((DANGEROUS_ACTIONS as readonly string[]).includes(tool.action) && !this.approvals.consume(context, name)) return { allowed: false, reason: 'APPROVAL_REQUIRED' };
    return { allowed: true };
  }
}
