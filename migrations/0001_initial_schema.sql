-- migrations/0001_initial_schema.sql
-- Cloudflare D1 Initial Migration for Gems of Nature V2

-- 1. Inquiries (Stone selection & price confirmation)
CREATE TABLE IF NOT EXISTS inquiries (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    destination_country TEXT NOT NULL DEFAULT 'IN',
    status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('DRAFT_PREPARED', 'PENDING_REVIEW', 'PRICE_QUOTED', 'CONVERTED_TO_ORDER', 'CLOSED')),
    notes TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(customer_email);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inquiries_idempotency ON inquiries(idempotency_key);

-- 2. Inquiry Items
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

-- 3. International Shipping Quotes
CREATE TABLE IF NOT EXISTS shipping_quotes (
    id TEXT PRIMARY KEY,
    customer_email TEXT NOT NULL,
    destination_country TEXT NOT NULL,
    destination_postal_code TEXT,
    destination_address TEXT,
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED', 'APPROVED_BY_OWNER', 'ACCEPTED_BY_CUSTOMER', 'EXPIRED', 'REJECTED')),
    quoted_amount INTEGER,
    quoted_currency TEXT DEFAULT 'INR',
    expires_at INTEGER,
    accepted_at INTEGER,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipping_quotes_email ON shipping_quotes(customer_email);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_status ON shipping_quotes(status);
CREATE INDEX IF NOT EXISTS idx_shipping_quotes_idempotency ON shipping_quotes(idempotency_key);

-- 4. Approved Inventory Snapshots (Owner-confirmed physical stones)
CREATE TABLE IF NOT EXISTS inventory_snapshots (
    sku TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    approved_selling_price INTEGER NOT NULL CHECK(approved_selling_price > 0),
    in_stock INTEGER NOT NULL DEFAULT 1 CHECK(in_stock IN (0, 1)),
    carat_weight REAL,
    cert_number TEXT,
    approved_by TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_snapshots(product_id);

-- 5. Orders
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
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_key);

-- 6. Order Items
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

-- 7. Payment Attempts (Audit trail for Razorpay integration)
CREATE TABLE IF NOT EXISTS payment_attempts (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
    gateway_order_id TEXT,
    gateway_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'CREATED' CHECK(status IN ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    currency TEXT NOT NULL DEFAULT 'INR',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_order ON payment_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_order ON payment_attempts(gateway_order_id);

-- 8. Idempotency Records
CREATE TABLE IF NOT EXISTS idempotency_records (
    key TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('INQUIRY', 'QUOTE', 'ORDER')),
    resource_id TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
