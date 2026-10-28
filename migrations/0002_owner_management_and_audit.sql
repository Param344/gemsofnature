-- migrations/0002_owner_management_and_audit.sql
-- Stage 3B: Customer Tokens, Inquiry Notes, Owner Management & Audit Logs

-- 1. Customer Access Tokens (High-entropy expiring bearer tokens)
CREATE TABLE IF NOT EXISTS customer_tokens (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('INQUIRY', 'QUOTE', 'ORDER')),
    resource_id TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_tokens_token ON customer_tokens(token);
CREATE INDEX IF NOT EXISTS idx_customer_tokens_lookup ON customer_tokens(token, resource_id);

-- 2. Internal Owner Inquiry Notes
CREATE TABLE IF NOT EXISTS inquiry_notes (
    id TEXT PRIMARY KEY,
    inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiry_notes_inquiry ON inquiry_notes(inquiry_id);

-- 3. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('INQUIRY', 'QUOTE', 'INVENTORY', 'ORDER')),
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    details_json TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 4. Schema enhancements to shipping_quotes and inventory_snapshots
ALTER TABLE shipping_quotes ADD COLUMN rejection_reason TEXT;
ALTER TABLE shipping_quotes ADD COLUMN cancelled_at INTEGER;

ALTER TABLE inventory_snapshots ADD COLUMN currency TEXT DEFAULT 'INR';
ALTER TABLE inventory_snapshots ADD COLUMN cert_status TEXT DEFAULT 'CERTIFIED';
ALTER TABLE inventory_snapshots ADD COLUMN cert_lab TEXT;
ALTER TABLE inventory_snapshots ADD COLUMN notes TEXT;
