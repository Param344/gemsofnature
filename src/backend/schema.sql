-- src/backend/schema.sql
-- Stage 3B: Cloudflare D1 / SQLite Relational Database Schema
-- Provides persistent, relational storage for inquiries, quotes, orders, customer tokens, owner management, and audit tracking.

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

-- 2. Inquiries (Stone selection & price confirmation)
CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    destination_country TEXT NOT NULL DEFAULT 'IN',
    status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('DRAFT_PREPARED', 'PENDING_REVIEW', 'PRICE_QUOTED', 'CUSTOMER_CONTACTED', 'CONVERTED_TO_ORDER', 'CLOSED', 'CANCELLED')),
    notes TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(customer_email);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_idempotency ON inquiries(idempotency_key);

-- 3. Inquiry Items
CREATE TABLE IF NOT EXISTS inquiry_items (
    id TEXT PRIMARY KEY,
    inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 1 AND quantity <= 20),
    provisional_min_unit INTEGER NOT NULL,
    provisional_max_unit INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_inquiry_items_product ON inquiry_items(product_id);

-- 4. Internal Owner Inquiry Notes
CREATE TABLE IF NOT EXISTS inquiry_notes (
    id TEXT PRIMARY KEY,
    inquiry_id TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiry_notes_inquiry ON inquiry_notes(inquiry_id);

-- 5. International Shipping Quotes
CREATE TABLE IF NOT EXISTS shipping_quotes (
    id TEXT PRIMARY KEY,
    customer_email TEXT NOT NULL,
    destination_country TEXT NOT NULL,
    destination_postal_code TEXT,
    destination_address TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'APPROVED_BY_OWNER', 'ACCEPTED_BY_CUSTOMER', 'EXPIRED', 'REJECTED', 'CANCELLED')),
    quoted_amount INTEGER,
    quoted_currency TEXT DEFAULT 'INR',
    rejection_reason TEXT,
    expires_at INTEGER,
    accepted_at INTEGER,
    cancelled_at INTEGER,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipping_quotes_email ON shipping_quotes(customer_email);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_status ON shipping_quotes(status);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_idempotency ON shipping_quotes(idempotency_key);

-- 6. Approved Inventory Snapshots (Owner-confirmed physical stones)
CREATE TABLE IF NOT EXISTS inventory_snapshots (
    sku TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    approved_selling_price INTEGER NOT NULL CHECK(approved_selling_price > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    in_stock INTEGER NOT NULL DEFAULT 1 CHECK(in_stock IN (0, 1)),
    reserved_order_id TEXT,
    carat_weight REAL,
    ratti_weight REAL,
    cert_number TEXT,
    cert_status TEXT NOT NULL DEFAULT 'CERTIFIED' CHECK(cert_status IN ('CERTIFIED', 'PENDING', 'UNCERTIFIED')),
    cert_lab TEXT,
    origin TEXT,
    notes TEXT,
    approved_by TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reserved_order ON inventory_snapshots(reserved_order_id);

-- 7. Orders
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    shipping_address_line1 TEXT NOT NULL,
    shipping_city TEXT NOT NULL,
    shipping_state TEXT NOT NULL,
    shipping_postal_code TEXT NOT NULL,
    shipping_country TEXT NOT NULL DEFAULT 'IN',
    shipping_fee INTEGER NOT NULL CHECK(shipping_fee >= 0),
    subtotal INTEGER NOT NULL CHECK(subtotal > 0),
    total INTEGER NOT NULL CHECK(total > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK(status IN ('PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')),
    shipping_quote_id TEXT REFERENCES shipping_quotes(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    payment_confirmed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_orders_razorpay_order_id ON orders(razorpay_order_id);

-- 8. Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    inventory_sku TEXT NOT NULL,
    unit_price INTEGER NOT NULL CHECK(unit_price > 0),
    quantity INTEGER NOT NULL CHECK(quantity >= 1 AND quantity <= 20),
    line_total INTEGER NOT NULL CHECK(line_total > 0),
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(inventory_sku);

-- 9. Payment Attempts (Audit trail for Razorpay integration)
CREATE TABLE IF NOT EXISTS payment_attempts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
    gateway_order_id TEXT,
    gateway_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    amount_subunits INTEGER,
    currency TEXT NOT NULL DEFAULT 'INR',
    signature TEXT,
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_order ON payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_order ON payment_attempts(gateway_order_id);

-- 10. Idempotency Records
CREATE TABLE IF NOT EXISTS idempotency_records (
    key TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('INQUIRY', 'QUOTE', 'ORDER')),
    resource_id TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 11. Audit Logs (Complete auditable trail of owner & customer actions)
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

-- 12. Webhook Events (Deduplication, Audit, and Safe Retries)
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
