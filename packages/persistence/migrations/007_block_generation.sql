CREATE TABLE kleo.block_pages (
 id text NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL, document jsonb NOT NULL, design_system jsonb NOT NULL,
 source_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,id), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES kleo.projects(organization_id,id),
 FOREIGN KEY(organization_id,project_id,source_version_id) REFERENCES kleo.website_versions(organization_id,project_id,id)
);
CREATE TABLE kleo.block_runs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, page_id text NOT NULL, block_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES kleo.users(id), request_id uuid NOT NULL, instruction text NOT NULL CHECK(length(instruction) BETWEEN 1 AND 2000),
 block_type text CHECK(block_type IN ('hero','advantages','services','process','faq','cta','text')), source_brief_id uuid,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')), stage text NOT NULL DEFAULT 'starting' CHECK(stage IN ('starting','design','content','developer','qa')),
 error_code text CHECK(error_code IN ('STAGE_FAILED','INVALID_RESPONSE','LIMIT_EXCEEDED','CANCELLED','TIMEOUT','QA_FAILED','PROVIDER_FAILURE','ACCESS_DENIED','INVALID_INPUT')),
 started_at timestamptz NOT NULL DEFAULT now(), deadline_at timestamptz NOT NULL, completed_at timestamptz,
 CHECK(deadline_at>started_at),
 CHECK((status='running' AND completed_at IS NULL AND error_code IS NULL) OR (status='completed' AND completed_at IS NOT NULL AND error_code IS NULL) OR (status='failed' AND completed_at IS NOT NULL AND error_code IS NOT NULL)),
 UNIQUE(organization_id,project_id,id), UNIQUE(organization_id,project_id,page_id,block_id,id),
 FOREIGN KEY(organization_id,project_id,page_id) REFERENCES kleo.block_pages(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,source_brief_id) REFERENCES kleo.project_briefs(organization_id,project_id,id)
);
CREATE UNIQUE INDEX one_block_run ON kleo.block_runs(project_id) WHERE status='running';
CREATE TABLE kleo.blocks (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,page_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,page_id,id),FOREIGN KEY(organization_id,project_id,page_id) REFERENCES kleo.block_pages(organization_id,project_id,id)
);
CREATE TABLE kleo.block_versions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,page_id text NOT NULL,block_id uuid NOT NULL,run_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),document jsonb NOT NULL,qa jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(block_id,version),UNIQUE(run_id),FOREIGN KEY(organization_id,project_id,page_id,block_id) REFERENCES kleo.blocks(organization_id,project_id,page_id,id),
 FOREIGN KEY(organization_id,project_id,page_id,block_id,run_id) REFERENCES kleo.block_runs(organization_id,project_id,page_id,block_id,id)
);
CREATE TABLE kleo.block_execution (
 run_id uuid NOT NULL REFERENCES kleo.block_runs(id),stage text NOT NULL CHECK(stage IN ('design','content','developer','qa')),status text NOT NULL CHECK(status IN ('started','completed','failed')),
 usage jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(run_id,stage)
);
CREATE TABLE kleo.block_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES kleo.block_runs(id),event text NOT NULL CHECK(event IN ('started','completed','failed')),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(run_id,event)
);
CREATE FUNCTION kleo.block_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable block record' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER block_versions_immutable BEFORE UPDATE OR DELETE ON kleo.block_versions FOR EACH ROW EXECUTE FUNCTION kleo.block_immutable();
CREATE TRIGGER block_pages_immutable BEFORE UPDATE OR DELETE ON kleo.block_pages FOR EACH ROW EXECUTE FUNCTION kleo.block_immutable();
CREATE TRIGGER blocks_immutable BEFORE UPDATE OR DELETE ON kleo.blocks FOR EACH ROW EXECUTE FUNCTION kleo.block_immutable();
CREATE FUNCTION kleo.block_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM kleo.platform_roles r JOIN kleo.users u ON u.id=r.user_id WHERE r.user_id=NEW.actor_id AND r.role='platform_owner' AND u.status='active') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='23503'; END IF;
 ELSE
  IF OLD.status<>'running' OR (to_jsonb(NEW)-ARRAY['status','stage','error_code','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stage','error_code','completed_at']) THEN RAISE EXCEPTION 'Immutable run binding' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;END; $$;
CREATE TRIGGER block_runs_guard BEFORE INSERT OR UPDATE ON kleo.block_runs FOR EACH ROW EXECUTE FUNCTION kleo.block_run_guard();

ALTER TABLE kleo.security_audit_events DROP CONSTRAINT security_audit_events_event_type_check;
ALTER TABLE kleo.security_audit_events ADD CHECK(event_type IN ('bootstrap_owner','login_success','login_failure','logout','access_denied','platform_read','project_created','organization_created','brief_saved','block_pages_prepared'));

CREATE TRIGGER block_audit_immutable BEFORE UPDATE OR DELETE ON kleo.block_audit FOR EACH ROW EXECUTE FUNCTION kleo.block_immutable();
