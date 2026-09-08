-- Dokumen Database Initial Schema (PostgreSQL 16)
-- PRD §7, §8, §10

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  application_id VARCHAR(36) NOT NULL,
  requirement_type_code VARCHAR(50) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  sha256_hash VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'QUARANTINED',
  scan_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  is_bound BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_application ON documents(application_id);
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(status);

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_size INTEGER NOT NULL,
  sha256_hash VARCHAR(64) NOT NULL,
  scan_status VARCHAR(30) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docver_doc ON document_versions(document_id);

CREATE TABLE IF NOT EXISTS scan_results (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  engine VARCHAR(50) NOT NULL DEFAULT 'ClamAV',
  engine_version VARCHAR(100),
  is_clean BOOLEAN NOT NULL,
  threat_found VARCHAR(255) NULL,
  scan_duration_ms INTEGER NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_doc ON scan_results(document_id);

CREATE TABLE IF NOT EXISTS access_audit (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  actor_id VARCHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45),
  request_id VARCHAR(36),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_doc ON access_audit(document_id);
CREATE INDEX IF NOT EXISTS idx_access_actor ON access_audit(actor_id);
