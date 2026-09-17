/** Browser-safe HTTP DTOs only. No server imports or credentials. */
export type PlatformRole = "user" | "platform_owner" | "platform_admin";
export interface SessionView {
  user: { id: string; email: string; platformRole: PlatformRole };
  csrfToken: string;
}
export type AdminKind =
  | "organizations"
  | "users"
  | "projects"
  | "workflows"
  | "websites"
  | "versions"
  | "qa"
  | "usage"
  | "audit-events";
export interface AdminIssue {
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  recommendation?: string;
}
export interface AdminRow {
  id: string;
  name?: string;
  email?: string | null;
  status?: string;
  role?: string;
  organization_id?: string;
  project_id?: string;
  website_id?: string;
  website_version_id?: string;
  workflow_run_id?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  completed_at?: string | null;
  recorded_at?: string;
  version_number?: number;
  passed?: boolean;
  score?: string;
  issues?: AdminIssue[];
  provider?: string;
  model?: string;
  agent_type?: string;
  outcome?: string;
  attempt?: number;
  input_tokens?: string | null;
  output_tokens?: string | null;
  cached_input_tokens?: string | null;
  total_tokens?: string | null;
  duration_ms?: string | null;
  actor_id?: string | null;
  request_id?: string;
  event_type?: string;
  resource_type?: string | null;
  resource_id?: string | null;
}
export interface AdminList {
  data: AdminRow[];
  pagination: { limit: number; offset: number };
}
export interface AdminDashboard {
  counts: {
    organizations: string;
    users: string;
    projects: string;
    workflows: string;
  };
  workflows: AdminRow[];
  qa: AdminRow[];
  audit: AdminRow[];
}
export interface AdminDetail {
  item: AdminRow;
  executions?: AdminRow[];
}
