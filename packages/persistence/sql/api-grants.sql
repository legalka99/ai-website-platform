-- Explicit operator action after migration 002. Login credential managed separately.
CREATE ROLE kleo_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT USAGE ON SCHEMA kleo TO kleo_api;
GRANT SELECT ON kleo.users,kleo.organizations,kleo.memberships,kleo.projects,
 kleo.workflow_runs,kleo.websites,kleo.auth_accounts,kleo.platform_roles,kleo.auth_sessions TO kleo_api;
GRANT SELECT(id,organization_id,project_id,website_id,workflow_run_id,version_number,status,created_at) ON kleo.website_versions TO kleo_api;
GRANT SELECT(id,organization_id,project_id,website_version_id,workflow_run_id,passed,score,created_at) ON kleo.qa_reports TO kleo_api;
GRANT SELECT(id,organization_id,project_id,workflow_run_id,execution_id,attempt,provider,model,outcome,input_tokens,output_tokens,total_tokens,cached_input_tokens,duration_ms,recorded_at) ON kleo.ai_usage TO kleo_api;
GRANT INSERT ON kleo.auth_sessions,kleo.projects,kleo.security_audit_events TO kleo_api;
GRANT UPDATE(revoked_at) ON kleo.auth_sessions TO kleo_api;
-- Column privileges for locking rows during authenticated transactions.
GRANT UPDATE(id) ON kleo.users,kleo.organizations,kleo.projects TO kleo_api;
GRANT UPDATE(user_id) ON kleo.memberships,kleo.auth_accounts TO kleo_api;
-- No passwords/role writes, DELETE, DDL, workflow generation or Website mutation.
