CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per AI interaction. parent_id links a refinement / re-ask to the
-- extraction it was derived from.
CREATE TABLE extractions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id      uuid REFERENCES extractions(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  input_text     text NOT NULL,           -- PII-masked before storage
  input_hash     text NOT NULL,           -- sha256 of normalized input (cache / dedupe)
  instruction    text,                    -- optional user refinement
  result         jsonb,                   -- validated structured output
  error          text,
  prompt_version text,
  model          text,
  tokens_in      integer,
  tokens_out     integer,
  cost_usd       numeric(10,6),
  latency_ms     integer,
  feedback       smallint CHECK (feedback IN (-1, 1)),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '30 days'  -- retention
);
CREATE INDEX extractions_user_created_idx ON extractions (user_id, created_at DESC);
CREATE INDEX extractions_hash_idx ON extractions (user_id, input_hash, prompt_version);
CREATE INDEX extractions_expires_idx ON extractions (expires_at);

-- Append-only audit trail: metadata only, never content.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid,
  action     text NOT NULL,
  entity_id  uuid,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_mutation BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
