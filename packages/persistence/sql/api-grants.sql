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
-- Console read projection: QA is runtime validated and projected before HTTP output.
GRANT SELECT(document) ON kleo.qa_reports TO kleo_api;
GRANT SELECT(id,organization_id,project_id,workflow_run_id,agent_type,status,created_at) ON kleo.agent_executions TO kleo_api;
GRANT SELECT(id,actor_id,request_id,event_type,resource_type,resource_id,created_at) ON kleo.security_audit_events TO kleo_api;
-- Owner input MVP: specific inserts only; no UPDATE/DELETE on immutable input/receipts.
GRANT INSERT(id,name) ON kleo.organizations TO kleo_api;
GRANT SELECT,INSERT ON kleo.project_briefs,kleo.owner_commands TO kleo_api;

-- Owner workflow runner: scoped server composition; immutable outputs remain insert-only.
GRANT INSERT ON kleo.workflow_runs,kleo.websites,kleo.website_versions,kleo.qa_reports,kleo.domain_snapshots,kleo.agent_executions,kleo.ai_usage,kleo.audit_events TO kleo_api;
GRANT UPDATE(status,result_digest,completed_at,failure_code,current_stage) ON kleo.workflow_runs TO kleo_api;
GRANT SELECT ON kleo.audit_events TO kleo_api;
GRANT SELECT(error_code) ON kleo.agent_executions TO kleo_api;

-- Block generation uses scoped canonical page reads and insert-only block versions.
GRANT SELECT(document) ON kleo.website_versions TO kleo_api;
GRANT SELECT,INSERT ON kleo.block_pages,kleo.block_runs,kleo.blocks,kleo.block_versions,kleo.block_execution,kleo.block_audit TO kleo_api;
GRANT UPDATE(status,stage,error_code,completed_at) ON kleo.block_runs TO kleo_api;
GRANT UPDATE(status,usage) ON kleo.block_execution TO kleo_api;
