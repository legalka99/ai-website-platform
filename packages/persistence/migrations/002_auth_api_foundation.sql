-- Forward-only auth foundation. 001 remains unchanged.
CREATE TABLE kleo.auth_accounts (
 user_id uuid PRIMARY KEY REFERENCES kleo.users(id) ON DELETE RESTRICT,
 email text NOT NULL UNIQUE CHECK(length(email) BETWEEN 3 AND 254 AND email=lower(trim(email))),
 password_hash text NOT NULL CHECK(length(password_hash) BETWEEN 80 AND 512 AND password_hash LIKE '$argon2id$%'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kleo.platform_roles (
 user_id uuid PRIMARY KEY REFERENCES kleo.users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK(role IN ('platform_owner','platform_admin')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_platform_owner ON kleo.platform_roles(role) WHERE role='platform_owner';
CREATE TABLE kleo.auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES kleo.users(id) ON DELETE RESTRICT,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE INDEX auth_sessions_user ON kleo.auth_sessions(user_id,created_at DESC);
CREATE INDEX auth_sessions_expiry ON kleo.auth_sessions(expires_at);
CREATE TABLE kleo.security_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES kleo.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL, event_type text NOT NULL CHECK(event_type IN ('bootstrap_owner','login_success','login_failure','logout','access_denied','platform_read','project_created')),
 resource_type text CHECK(resource_type IN ('users','organizations','projects','workflows','identity')),
 resource_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_actor ON kleo.security_audit_events(actor_id,created_at DESC);
CREATE TRIGGER immutable_security_audit BEFORE UPDATE OR DELETE ON kleo.security_audit_events FOR EACH ROW EXECUTE FUNCTION kleo.reject_mutation();
