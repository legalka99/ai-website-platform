import type { PoolClient } from "pg";
import type {
  AdminKind,
  AdminRow,
  AdminIssue,
  AdminDashboard,
  AdminDetail,
} from "../../core/src/admin-api.js";
import {
  AuthError,
  authUuid,
  type AuthActor,
  type AuthRepository,
  type Page,
} from "./auth.js";
import { containsSecret } from "../../security/src/redaction.js";
import { validateQAReport } from "../../ai/src/validation/qa-report-validator.js";
import type { QAReport } from "../../ai/src/contracts/qa-report.js";

export interface AdminFilter {
  organizationId?: string;
  projectId?: string;
  websiteId?: string;
  workflowId?: string;
}
const specs = {
  organizations: {
    table: "kleo.organizations r",
    fields: "r.id,r.name,r.status,r.created_at,r.updated_at",
    order: "r.created_at",
  },
  users: {
    table:
      "kleo.users r LEFT JOIN kleo.auth_accounts a ON a.user_id=r.id LEFT JOIN kleo.platform_roles p ON p.user_id=r.id",
    fields:
      "r.id,a.email,r.status,coalesce(p.role,'user') AS role,r.created_at",
    order: "r.created_at",
  },
  projects: {
    table: "kleo.projects r",
    fields: "r.id,r.organization_id,r.name,r.status,r.created_at,r.updated_at",
    order: "r.created_at",
  },
  workflows: {
    table: "kleo.workflow_runs r",
    fields:
      "r.id,r.organization_id,r.project_id,r.status,r.started_at,r.completed_at",
    order: "r.started_at",
  },
  websites: {
    table: "kleo.websites r",
    fields: "r.id,r.organization_id,r.project_id,r.status,r.created_at",
    order: "r.created_at",
  },
  versions: {
    table: "kleo.website_versions r",
    fields:
      "r.id,r.organization_id,r.project_id,r.website_id,r.workflow_run_id,r.version_number,r.status,r.created_at",
    order: "r.created_at",
  },
  qa: {
    table: "kleo.qa_reports r",
    fields:
      "r.id,r.organization_id,r.project_id,r.website_version_id,r.workflow_run_id,r.passed,r.score,r.created_at,r.document",
    order: "r.created_at",
  },
  usage: {
    table:
      "kleo.ai_usage r JOIN kleo.agent_executions e ON e.id=r.execution_id AND e.organization_id=r.organization_id AND e.project_id=r.project_id AND e.workflow_run_id=r.workflow_run_id",
    fields:
      "r.id,r.organization_id,r.project_id,r.workflow_run_id,e.agent_type,r.provider,r.model,r.attempt,r.outcome,r.input_tokens,r.output_tokens,r.cached_input_tokens,r.total_tokens,r.duration_ms,r.recorded_at",
    order: "r.recorded_at",
  },
  "audit-events": {
    table: "kleo.security_audit_events r",
    fields:
      "r.id,r.actor_id,r.request_id,r.event_type,r.resource_type,r.resource_id,r.created_at",
    order: "r.created_at",
  },
} as const;
// Projected keys remain independent of database rows/documents.
const fields = [
  "id",
  "name",
  "email",
  "status",
  "role",
  "organization_id",
  "project_id",
  "website_id",
  "website_version_id",
  "workflow_run_id",
  "created_at",
  "updated_at",
  "started_at",
  "completed_at",
  "recorded_at",
  "version_number",
  "passed",
  "score",
  "provider",
  "model",
  "agent_type",
  "outcome",
  "attempt",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "total_tokens",
  "duration_ms",
  "actor_id",
  "request_id",
  "event_type",
  "resource_type",
  "resource_id",
] as const;
function project(row: Record<string, unknown>): AdminRow {
  const out: Record<string, unknown> = {};
  for (const key of fields)
    if (key in row) {
      const value = row[key];
      out[key] =
        value instanceof Date
          ? value.toISOString()
          : typeof value === "string" && containsSecret(value)
            ? "[redacted]"
            : value;
    }
  if ("document" in row) {
    if (
      !validateQAReport(row.document).valid ||
      containsSecret(JSON.stringify(row.document))
    )
      throw new AuthError("UNAVAILABLE");
    const report = row.document as QAReport;
    out.issues = report.issues.map((i): AdminIssue => ({
      code: i.code,
      severity: i.severity,
      message: i.message,
      ...(i.recommendation ? { recommendation: i.recommendation } : {}),
    }));
  }
  return out as unknown as AdminRow;
}
function allowed(actor: AuthActor) {
  if (!["platform_owner", "platform_admin"].includes(actor.platformRole))
    throw new AuthError("FORBIDDEN");
}
async function rows(
  db: PoolClient,
  kind: AdminKind,
  page: Page,
  filter: AdminFilter = {},
  id?: string,
): Promise<AdminRow[]> {
  const spec = specs[kind],
    conditions: string[] = [],
    values: unknown[] = [];
  const add = (column: string, value: string) => {
    authUuid(value);
    values.push(value);
    conditions.push(`r.${column}=$${values.length}`);
  };
  if (id) add("id", id);
  const accepted: Partial<Record<AdminKind, readonly (keyof AdminFilter)[]>> = {
    projects: ["organizationId"],
    workflows: ["organizationId", "projectId"],
    websites: ["projectId"],
    versions: ["projectId", "websiteId"],
    qa: ["projectId", "workflowId"],
    usage: ["projectId", "workflowId"],
  };
  const columns = {
    organizationId: "organization_id",
    projectId: "project_id",
    websiteId: "website_id",
    workflowId: "workflow_run_id",
  };
  for (const key of Object.keys(filter) as (keyof AdminFilter)[]) {
    if (!accepted[kind]?.includes(key)) throw new AuthError("INVALID_INPUT");
    if (filter[key]) add(columns[key], filter[key]);
  }
  values.push(page.limit, page.offset);
  const result = await db.query(
    `SELECT ${spec.fields} FROM ${spec.table}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${spec.order} DESC,r.id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows.map(project);
}
/** Explicit cross-tenant read path. Caller holds the authenticated transaction. */
export async function adminList(
  auth: AuthRepository,
  db: PoolClient,
  actor: AuthActor,
  kind: AdminKind,
  page: Page,
  requestId: string,
  filter: AdminFilter = {},
) {
  allowed(actor);
  const data = await rows(db, kind, page, filter);
  await auth.audit(
    db,
    requestId,
    "platform_read",
    actor.userId,
    ["users", "organizations", "projects", "workflows"].includes(kind)
      ? kind
      : "identity",
  );
  return { data, pagination: page };
}
export async function adminDetail(
  auth: AuthRepository,
  db: PoolClient,
  actor: AuthActor,
  kind: "organizations" | "users" | "projects" | "workflows",
  id: string,
  requestId: string,
): Promise<AdminDetail> {
  allowed(actor);
  const [item] = await rows(db, kind, { limit: 1, offset: 0 }, {}, id);
  if (!item) throw new AuthError("NOT_FOUND");
  let executions: AdminRow[] | undefined;
  if (kind === "workflows")
    executions = (
      await db.query(
        "SELECT id,agent_type,status,created_at FROM kleo.agent_executions WHERE organization_id=$1 AND project_id=$2 AND workflow_run_id=$3 ORDER BY CASE agent_type WHEN 'business' THEN 1 WHEN 'design' THEN 2 WHEN 'content' THEN 3 WHEN 'developer' THEN 4 ELSE 5 END LIMIT 5",
        [item.organization_id, item.project_id, id],
      )
    ).rows.map(project);
  await auth.audit(db, requestId, "platform_read", actor.userId, kind, id);
  return { item, ...(executions ? { executions } : {}) };
}
export async function adminDashboard(
  auth: AuthRepository,
  db: PoolClient,
  actor: AuthActor,
  requestId: string,
): Promise<AdminDashboard> {
  allowed(actor);
  // Fixed aggregate queries, protected by the existing transaction statement timeout.
  const counts = (
    await db.query<{
      organizations: string;
      users: string;
      projects: string;
      workflows: string;
    }>(
      "SELECT (SELECT count(*) FROM kleo.organizations) AS organizations,(SELECT count(*) FROM kleo.users) AS users,(SELECT count(*) FROM kleo.projects) AS projects,(SELECT count(*) FROM kleo.workflow_runs) AS workflows",
    )
  ).rows[0];
  const page = { limit: 5, offset: 0 },
    workflows = await rows(db, "workflows", page),
    qa = await rows(db, "qa", page),
    audit = await rows(db, "audit-events", page);
  await auth.audit(db, requestId, "platform_read", actor.userId, "identity");
  return { counts, workflows, qa, audit };
}
