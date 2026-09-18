-- User input is separate from immutable AI domain_snapshots, which require a workflow.
CREATE TABLE kleo.project_briefs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 1000001), actor_id uuid NOT NULL REFERENCES kleo.users(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=32768),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,version), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES kleo.projects(organization_id,id) ON DELETE RESTRICT
);
CREATE TRIGGER immutable_project_briefs BEFORE UPDATE OR DELETE ON kleo.project_briefs FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
CREATE TABLE kleo.owner_commands (
 actor_id uuid NOT NULL REFERENCES kleo.users(id), operation_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<2048),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation_id)
);
CREATE TRIGGER immutable_owner_commands BEFORE UPDATE OR DELETE ON kleo.owner_commands FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
ALTER TABLE kleo.security_audit_events DROP CONSTRAINT security_audit_events_event_type_check;
ALTER TABLE kleo.security_audit_events ADD CHECK(event_type IN ('bootstrap_owner','login_success','login_failure','logout','access_denied','platform_read','project_created','organization_created','brief_saved'));
ALTER TABLE kleo.security_audit_events ADD COLUMN organization_id uuid REFERENCES kleo.organizations(id), ADD COLUMN project_id uuid;
ALTER TABLE kleo.security_audit_events ADD FOREIGN KEY(organization_id,project_id) REFERENCES kleo.projects(organization_id,id);
ALTER TABLE kleo.security_audit_events ADD CHECK(project_id IS NULL OR organization_id IS NOT NULL);
