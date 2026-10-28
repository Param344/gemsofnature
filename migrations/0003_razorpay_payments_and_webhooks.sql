-- migrations/0003_razorpay_payments_and_webhooks.sql
-- Stage 3C: Razorpay Payment Orders, Checkout Signatures & Webhook Reconciliation

-- 1. Webhook Events Table (Deduplication, Audit, and Safe Retries)
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
    payload_json TEXT,
    error_message TEXT,
    processed_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON webhook_events(created_at);

-- 2. Schema enhancements to orders
ALTER TABLE orders ADD COLUMN razorpay_order_id TEXT;
ALTER TABLE orders ADD COLUMN razorpay_payment_id TEXT;
ALTER TABLE orders ADD COLUMN payment_confirmed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);

-- 3. Schema enhancements to payment_attempts
ALTER TABLE payment_attempts ADD COLUMN signature TEXT;
ALTER TABLE payment_attempts ADD COLUMN amount_subunits INTEGER;

-- 4. Schema enhancements to inventory_snapshots (Atomic Reservations & Overselling Prevention)
ALTER TABLE inventory_snapshots ADD COLUMN reserved_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_inventory_reserved_order ON inventory_snapshots(reserved_order_id);
