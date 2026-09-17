-- Operator-run after migrations; role provisioning is not automatic application startup.
-- Create a separate login through the deployment secret manager and grant this group role.
CREATE ROLE kleo_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA kleo TO kleo_runtime;
GRANT SELECT ON kleo.users,kleo.organizations,kleo.memberships,kleo.projects,kleo.workflow_runs,
 kleo.websites,kleo.website_versions,kleo.domain_snapshots,kleo.qa_reports,kleo.agent_executions,
 kleo.ai_usage,kleo.audit_events TO kleo_runtime;
GRANT INSERT ON kleo.projects,kleo.workflow_runs,kleo.websites,kleo.website_versions,
 kleo.domain_snapshots,kleo.qa_reports,kleo.agent_executions,kleo.ai_usage,kleo.audit_events TO kleo_runtime;
GRANT UPDATE(status,result_digest,completed_at,failure_code) ON kleo.workflow_runs TO kleo_runtime;
-- SELECT FOR SHARE/UPDATE needs an UPDATE privilege, but no API mutates these keys.
GRANT UPDATE(id) ON kleo.users,kleo.organizations,kleo.projects,kleo.websites TO kleo_runtime;
GRANT UPDATE(user_id) ON kleo.memberships TO kleo_runtime;
-- No DELETE, DDL, membership writes, approvals or provisioning. No BYPASSRLS.
-- This role can still read multiple tenants through SQL: repository checks remain required.
