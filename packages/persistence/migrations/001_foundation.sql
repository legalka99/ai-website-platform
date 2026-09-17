-- Forward-only migration. Do not edit after deployment.
CREATE SCHEMA IF NOT EXISTS kleo;
REVOKE CREATE ON SCHEMA kleo FROM PUBLIC;
CREATE TABLE kleo.users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kleo.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kleo.memberships (
 organization_id uuid NOT NULL REFERENCES kleo.organizations(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES kleo.users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE kleo.projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES kleo.organizations(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE kleo.workflow_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, actor_id uuid NOT NULL,
 invocation_id uuid NOT NULL, UNIQUE(organization_id,project_id,invocation_id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','qa_failed','failed','cancelled')),
 result_digest text CHECK(result_digest ~ '^[a-f0-9]{64}$'), failure_code text CHECK(failure_code IN ('WORKFLOW_FAILED','CANCELLED')),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES kleo.projects(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_id) REFERENCES kleo.memberships(organization_id,user_id) ON DELETE RESTRICT,
 CHECK((status='running' AND completed_at IS NULL AND result_digest IS NULL) OR (status<>'running' AND completed_at IS NOT NULL AND result_digest IS NOT NULL)),
 CHECK(completed_at IS NULL OR completed_at>=started_at)
);
CREATE TABLE kleo.websites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','archived')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES kleo.projects(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE kleo.website_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, website_id uuid NOT NULL, workflow_run_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0), status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=100000),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(website_id,version_number), UNIQUE(workflow_run_id),
 UNIQUE(organization_id,project_id,workflow_run_id,id), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,website_id) REFERENCES kleo.websites(organization_id,project_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,project_id,workflow_run_id) REFERENCES kleo.workflow_runs(organization_id,project_id,id) ON DELETE RESTRICT,
 CHECK((document->>'projectId'=project_id::text AND document->>'id'=website_id::text AND document->>'status'='draft') IS TRUE),
 CHECK(document ?& ARRAY['projectId','id','status'])
);
CREATE TABLE kleo.qa_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workflow_run_id uuid NOT NULL, website_version_id uuid NOT NULL,
 passed boolean NOT NULL, score numeric NOT NULL CHECK(score BETWEEN 0 AND 100), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=40000),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(website_version_id), UNIQUE(workflow_run_id),
 FOREIGN KEY(organization_id,project_id,workflow_run_id,website_version_id) REFERENCES kleo.website_versions(organization_id,project_id,workflow_run_id,id) ON DELETE RESTRICT,
 CHECK(document ?& ARRAY['passed','score']), CHECK(document->'passed'=to_jsonb(passed) AND document->'score'=to_jsonb(score))
);
CREATE TABLE kleo.domain_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workflow_run_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('business','design','content')), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=64000),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workflow_run_id,kind),
 FOREIGN KEY(organization_id,project_id,workflow_run_id) REFERENCES kleo.workflow_runs(organization_id,project_id,id) ON DELETE RESTRICT
);
CREATE TABLE kleo.agent_executions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workflow_run_id uuid NOT NULL,
 agent_type text NOT NULL CHECK(agent_type IN ('business','design','content','developer','qa')),
 status text NOT NULL CHECK(status IN ('completed','failed','cancelled')), error_code text CHECK(error_code IN ('STAGE_FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workflow_run_id,agent_type), UNIQUE(organization_id,project_id,workflow_run_id,id),
 FOREIGN KEY(organization_id,project_id,workflow_run_id) REFERENCES kleo.workflow_runs(organization_id,project_id,id) ON DELETE RESTRICT
);
CREATE TABLE kleo.ai_usage (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, workflow_run_id uuid NOT NULL, execution_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 2), provider text NOT NULL CHECK(provider IN ('openai','yandex')),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200), outcome text NOT NULL CHECK(outcome IN ('success','failure','unknown')),
 request_id text CHECK(length(request_id)<=200), input_tokens bigint CHECK(input_tokens>=0), output_tokens bigint CHECK(output_tokens>=0),
 total_tokens bigint CHECK(total_tokens>=0), cached_input_tokens bigint CHECK(cached_input_tokens>=0), duration_ms numeric CHECK(duration_ms>=0),
 recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(execution_id,attempt),
 FOREIGN KEY(organization_id,project_id,workflow_run_id,execution_id) REFERENCES kleo.agent_executions(organization_id,project_id,workflow_run_id,id) ON DELETE RESTRICT
);
CREATE TABLE kleo.approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, website_version_id uuid NOT NULL, actor_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,website_version_id) REFERENCES kleo.website_versions(organization_id,project_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_id) REFERENCES kleo.memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE kleo.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, actor_id uuid NOT NULL,
 workflow_run_id uuid NOT NULL, event_type text NOT NULL CHECK(event_type IN ('workflow_started','workflow_completed','workflow_qa_failed','workflow_failed','workflow_cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workflow_run_id,event_type),
 FOREIGN KEY(organization_id,project_id,workflow_run_id) REFERENCES kleo.workflow_runs(organization_id,project_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_id) REFERENCES kleo.memberships(organization_id,user_id) ON DELETE RESTRICT
);
CREATE FUNCTION kleo.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.website_versions FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.qa_reports FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.domain_snapshots FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.agent_executions FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.ai_usage FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.audit_events FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TRIGGER immutable_record BEFORE UPDATE OR DELETE ON kleo.approvals FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE INDEX workflow_runs_scope ON kleo.workflow_runs(organization_id,project_id);
CREATE INDEX websites_scope ON kleo.websites(organization_id,project_id);
CREATE INDEX website_versions_scope ON kleo.website_versions(organization_id,project_id);
CREATE INDEX qa_reports_scope ON kleo.qa_reports(organization_id,project_id);
CREATE INDEX domain_snapshots_scope ON kleo.domain_snapshots(organization_id,project_id);
CREATE INDEX agent_executions_scope ON kleo.agent_executions(organization_id,project_id);
CREATE INDEX ai_usage_scope ON kleo.ai_usage(organization_id,project_id);
CREATE INDEX audit_events_scope ON kleo.audit_events(organization_id,project_id);
CREATE INDEX approvals_scope ON kleo.approvals(organization_id,project_id);
CREATE FUNCTION kleo.check_run_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'running' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.actor_id<>OLD.actor_id OR NEW.started_at<>OLD.started_at OR NEW.invocation_id<>OLD.invocation_id THEN
  RAISE EXCEPTION 'Invalid workflow transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_transition BEFORE UPDATE ON kleo.workflow_runs FOR EACH ROW EXECUTE FUNCTION kleo.check_run_transition();
