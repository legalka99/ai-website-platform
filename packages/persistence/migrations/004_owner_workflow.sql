-- Owner launch without fabricated tenant membership. Previous migrations stay immutable.
ALTER TABLE kleo.workflow_runs ADD COLUMN source_brief_version_id uuid,
 ADD COLUMN request_id uuid,
 ADD COLUMN current_stage text CHECK(current_stage IN ('business','design','content','developer','qa')),
 ADD COLUMN deadline_at timestamptz,
 ADD FOREIGN KEY(organization_id,project_id,source_brief_version_id) REFERENCES kleo.project_briefs(organization_id,project_id,id),
 ADD UNIQUE(organization_id,project_id,id,actor_id),
 ADD CHECK((source_brief_version_id IS NULL AND request_id IS NULL AND deadline_at IS NULL) OR (source_brief_version_id IS NOT NULL AND request_id IS NOT NULL AND deadline_at IS NOT NULL AND deadline_at>started_at));
ALTER TABLE kleo.workflow_runs DROP CONSTRAINT workflow_runs_organization_id_actor_id_fkey;
ALTER TABLE kleo.workflow_runs ADD FOREIGN KEY(actor_id) REFERENCES kleo.users(id);
-- Preserve the legacy FK (including membership deletion restrictions) without invented memberships.
ALTER TABLE kleo.workflow_runs ADD COLUMN tenant_actor_id uuid GENERATED ALWAYS AS (CASE WHEN source_brief_version_id IS NULL THEN actor_id ELSE NULL END) STORED;
ALTER TABLE kleo.workflow_runs ADD FOREIGN KEY(organization_id,tenant_actor_id) REFERENCES kleo.memberships(organization_id,user_id);
-- Keep tenant membership enforcement for legacy starts; allow only explicit owner-bound starts.
CREATE FUNCTION kleo.check_run_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source_brief_version_id IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM kleo.memberships WHERE organization_id=NEW.organization_id AND user_id=NEW.actor_id) THEN
   RAISE EXCEPTION 'Invalid workflow actor' USING ERRCODE='23503';
  END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM kleo.platform_roles r JOIN kleo.users u ON u.id=r.user_id WHERE r.user_id=NEW.actor_id AND r.role='platform_owner' AND u.status='active') THEN
  RAISE EXCEPTION 'Invalid workflow actor' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_actor BEFORE INSERT ON kleo.workflow_runs FOR EACH ROW EXECUTE FUNCTION kleo.check_run_actor();
ALTER TABLE kleo.audit_events DROP CONSTRAINT audit_events_organization_id_actor_id_fkey;
ALTER TABLE kleo.audit_events ADD FOREIGN KEY(organization_id,project_id,workflow_run_id,actor_id) REFERENCES kleo.workflow_runs(organization_id,project_id,id,actor_id);
CREATE UNIQUE INDEX one_owner_active_run ON kleo.workflow_runs(project_id) WHERE status='running' AND source_brief_version_id IS NOT NULL;
CREATE OR REPLACE FUNCTION kleo.check_run_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'running' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.actor_id<>OLD.actor_id OR NEW.started_at<>OLD.started_at OR NEW.invocation_id<>OLD.invocation_id
 OR NEW.source_brief_version_id IS DISTINCT FROM OLD.source_brief_version_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
  RAISE EXCEPTION 'Invalid workflow transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
ALTER TABLE kleo.workflow_runs DROP CONSTRAINT workflow_runs_failure_code_check;
ALTER TABLE kleo.workflow_runs ADD CHECK(failure_code IN ('WORKFLOW_FAILED','CANCELLED','BUDGET_EXCEEDED','TIMEOUT'));
