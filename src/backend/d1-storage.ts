// src/backend/d1-storage.ts
// Stage 3B: Cloudflare D1-backed Storage Adapter with Owner Management, Customer Tokens & Audit

import type { BackendStorage } from './storage';
import type { D1Database } from './d1-types';
import type {
  InquiryRecord,
  InquiryItemRecord,
  InquiryNoteRecord,
  ShippingQuoteRecord,
  OrderRecord,
  OrderItemRecord,
  InventorySnapshotRecord,
  PaymentAttemptRecord,
  IdempotencyRecord,
  CustomerTokenRecord,
  AuditLogRecord,
  InquiryStatus,
  ShippingQuoteStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaginationOptions,
  PaginatedResult,
  WebhookEventRecord
} from './types';

export class D1BackendStorage implements BackendStorage {
  constructor(private readonly db: D1Database) {}

  // ==========================================
  // CUSTOMER TOKENS
  // ==========================================

  public async saveCustomerToken(tokenRec: CustomerTokenRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO customer_tokens (
          id, token, resource_type, resource_id, customer_email, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        tokenRec.id,
        tokenRec.token,
        tokenRec.resourceType,
        tokenRec.resourceId,
        tokenRec.customerEmail,
        tokenRec.expiresAt,
        tokenRec.createdAt
      )
      .run();
  }

  public async getCustomerToken(token: string): Promise<CustomerTokenRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM customer_tokens WHERE token = ?')
      .bind(token)
      .first<Record<string, unknown>>();

    if (!row) return null;

    return {
      id: row.id as string,
      token: row.token as string,
      resourceType: row.resource_type as 'INQUIRY' | 'QUOTE' | 'ORDER',
      resourceId: row.resource_id as string,
      customerEmail: row.customer_email as string,
      expiresAt: Number(row.expires_at),
      createdAt: Number(row.created_at)
    };
  }

  // ==========================================
  // INQUIRIES & NOTES
  // ==========================================

  public async saveInquiry(inquiry: InquiryRecord): Promise<void> {
    const inquiryStmt = this.db
      .prepare(
        `INSERT INTO inquiries (
          id, customer_name, customer_email, customer_phone,
          destination_country, status, notes, idempotency_key,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        inquiry.id,
        inquiry.customerName,
        inquiry.customerEmail,
        inquiry.customerPhone || null,
        inquiry.destinationCountry,
        inquiry.status,
        inquiry.notes || null,
        inquiry.idempotencyKey,
        inquiry.createdAt,
        inquiry.updatedAt
      );

    const itemStmts = inquiry.items.map(item =>
      this.db
        .prepare(
          `INSERT INTO inquiry_items (
            id, inquiry_id, product_id, quantity,
            provisional_min_unit, provisional_max_unit, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id,
          item.inquiryId,
          item.productId,
          item.quantity,
          item.provisionalMinUnit,
          item.provisionalMaxUnit,
          item.createdAt
        )
    );

    // Atomic transaction: batch executes all statements or rolls back completely
    await this.db.batch([inquiryStmt, ...itemStmts]);
  }

  public async getInquiryById(id: string): Promise<InquiryRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM inquiries WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateInquiry(row);
  }

  public async getInquiryByIdempotencyKey(key: string): Promise<InquiryRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM inquiries WHERE idempotency_key = ?')
      .bind(key)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateInquiry(row);
  }

  public async updateInquiryStatus(id: string, status: InquiryStatus, updatedAt: number): Promise<void> {
    await this.db
      .prepare('UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, updatedAt, id)
      .run();
  }

  public async listInquiries(options: PaginationOptions = {}): Promise<PaginatedResult<InquiryRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM inquiries';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.query) {
      conditions.push('(customer_name LIKE ? OR customer_email LIKE ? OR id LIKE ?)');
      const q = `%${options.query.trim()}%`;
      params.push(q, q, q);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Get total count
    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countRes = await this.db.prepare(countSql).bind(...params).first<{ count: number }>();
    const total = countRes ? Number(countRes.count) : 0;

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rowsRes = await this.db.prepare(query).bind(...params).all<Record<string, unknown>>();
    const items: InquiryRecord[] = [];
    for (const row of rowsRes.results || []) {
      items.push(await this.hydrateInquiry(row));
    }

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  public async saveInquiryNote(note: InquiryNoteRecord): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO inquiry_notes (id, inquiry_id, author, note, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(note.id, note.inquiryId, note.author, note.note, note.createdAt)
      .run();
  }

  public async getInquiryNotes(inquiryId: string): Promise<readonly InquiryNoteRecord[]> {
    const res = await this.db
      .prepare('SELECT * FROM inquiry_notes WHERE inquiry_id = ? ORDER BY created_at ASC')
      .bind(inquiryId)
      .all<Record<string, unknown>>();

    return (res.results || []).map(r => ({
      id: r.id as string,
      inquiryId: r.inquiry_id as string,
      author: r.author as string,
      note: r.note as string,
      createdAt: Number(r.created_at)
    }));
  }

  private async hydrateInquiry(row: Record<string, unknown>): Promise<InquiryRecord> {
    const itemsRes = await this.db
      .prepare('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY created_at ASC')
      .bind(row.id as string)
      .all<Record<string, unknown>>();

    const items: InquiryItemRecord[] = (itemsRes.results || []).map(r => ({
      id: r.id as string,
      inquiryId: r.inquiry_id as string,
      productId: r.product_id as string,
      quantity: Number(r.quantity),
      provisionalMinUnit: Number(r.provisional_min_unit),
      provisionalMaxUnit: Number(r.provisional_max_unit),
      createdAt: Number(r.created_at)
    }));

    const notes = await this.getInquiryNotes(row.id as string);

    return {
      id: row.id as string,
      customerName: row.customer_name as string,
      customerEmail: row.customer_email as string,
      customerPhone: (row.customer_phone as string) || undefined,
      destinationCountry: (row.destination_country as string) || 'IN',
      status: row.status as InquiryStatus,
      notes: (row.notes as string) || undefined,
      internalNotes: notes,
      items,
      idempotencyKey: row.idempotency_key as string,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // ==========================================
  // SHIPPING QUOTES
  // ==========================================

  public async saveShippingQuote(quote: ShippingQuoteRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO shipping_quotes (
          id, customer_email, destination_country, destination_postal_code,
          destination_address, status, quoted_amount, quoted_currency,
          rejection_reason, expires_at, accepted_at, cancelled_at,
          idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        quote.id,
        quote.customerEmail,
        quote.destinationCountry,
        quote.destinationPostalCode || null,
        quote.destinationAddress || null,
        quote.status,
        quote.quotedAmount ?? null,
        quote.quotedCurrency || 'INR',
        quote.rejectionReason || null,
        quote.expiresAt ?? null,
        quote.acceptedAt ?? null,
        quote.cancelledAt ?? null,
        quote.idempotencyKey,
        quote.createdAt,
        quote.updatedAt
      )
      .run();
  }

  public async getShippingQuoteById(id: string): Promise<ShippingQuoteRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM shipping_quotes WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateShippingQuote(row);
  }

  public async getShippingQuoteByIdempotencyKey(key: string): Promise<ShippingQuoteRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM shipping_quotes WHERE idempotency_key = ?')
      .bind(key)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateShippingQuote(row);
  }

  public async updateShippingQuote(quote: ShippingQuoteRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE shipping_quotes SET
          status = ?,
          quoted_amount = ?,
          quoted_currency = ?,
          rejection_reason = ?,
          expires_at = ?,
          accepted_at = ?,
          cancelled_at = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .bind(
        quote.status,
        quote.quotedAmount ?? null,
        quote.quotedCurrency || 'INR',
        quote.rejectionReason || null,
        quote.expiresAt ?? null,
        quote.acceptedAt ?? null,
        quote.cancelledAt ?? null,
        quote.updatedAt,
        quote.id
      )
      .run();
  }

  public async listShippingQuotes(options: PaginationOptions = {}): Promise<PaginatedResult<ShippingQuoteRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM shipping_quotes';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.query) {
      conditions.push('(customer_email LIKE ? OR destination_country LIKE ? OR id LIKE ?)');
      const q = `%${options.query.trim()}%`;
      params.push(q, q, q);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countRes = await this.db.prepare(countSql).bind(...params).first<{ count: number }>();
    const total = countRes ? Number(countRes.count) : 0;

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rowsRes = await this.db.prepare(query).bind(...params).all<Record<string, unknown>>();
    const items = (rowsRes.results || []).map(r => this.hydrateShippingQuote(r));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  private hydrateShippingQuote(row: Record<string, unknown>): ShippingQuoteRecord {
    return {
      id: row.id as string,
      customerEmail: row.customer_email as string,
      destinationCountry: row.destination_country as string,
      destinationPostalCode: (row.destination_postal_code as string) || undefined,
      destinationAddress: (row.destination_address as string) || undefined,
      status: row.status as ShippingQuoteStatus,
      quotedAmount: row.quoted_amount !== null && row.quoted_amount !== undefined ? Number(row.quoted_amount) : undefined,
      quotedCurrency: (row.quoted_currency as string) || 'INR',
      rejectionReason: (row.rejection_reason as string) || undefined,
      expiresAt: row.expires_at !== null && row.expires_at !== undefined ? Number(row.expires_at) : undefined,
      acceptedAt: row.accepted_at !== null && row.accepted_at !== undefined ? Number(row.accepted_at) : undefined,
      cancelledAt: row.cancelled_at !== null && row.cancelled_at !== undefined ? Number(row.cancelled_at) : undefined,
      idempotencyKey: row.idempotency_key as string,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // ==========================================
  // ORDERS
  // ==========================================

  public async saveOrder(order: OrderRecord): Promise<void> {
    const orderStmt = this.db
      .prepare(
        `INSERT INTO orders (
          id, customer_name, customer_email, customer_phone,
          shipping_address_line1, shipping_city, shipping_state,
          shipping_postal_code, shipping_country,
          shipping_fee, subtotal, total, currency, status,
          shipping_quote_id, idempotency_key,
          razorpay_order_id, razorpay_payment_id, payment_confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        order.id,
        order.customer.name,
        order.customer.email,
        order.customer.phone || null,
        order.customer.addressLine1 || '',
        order.customer.city || '',
        order.customer.state || '',
        order.customer.postalCode || '',
        order.customer.country,
        order.shippingFee,
        order.subtotal,
        order.total,
        order.currency,
        order.status,
        order.shippingQuoteId || null,
        order.idempotencyKey,
        order.razorpayOrderId || null,
        order.razorpayPaymentId || null,
        order.paymentConfirmedAt ?? null,
        order.createdAt,
        order.updatedAt
      );

    const itemStmts = order.items.map(item =>
      this.db
        .prepare(
          `INSERT INTO order_items (
            id, order_id, product_id, inventory_sku,
            unit_price, quantity, line_total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          item.id,
          item.orderId,
          item.productId,
          item.inventorySku,
          item.unitPrice,
          item.quantity,
          item.lineTotal,
          item.createdAt
        )
    );

    await this.db.batch([orderStmt, ...itemStmts]);
  }

  public async getOrderById(id: string): Promise<OrderRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateOrder(row);
  }

  public async getOrderByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM orders WHERE idempotency_key = ?')
      .bind(key)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateOrder(row);
  }

  public async getOrderByRazorpayOrderId(razorpayOrderId: string): Promise<OrderRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM orders WHERE razorpay_order_id = ?')
      .bind(razorpayOrderId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateOrder(row);
  }

  public async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    meta?: { razorpayOrderId?: string; razorpayPaymentId?: string; paymentConfirmedAt?: number }
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE orders SET
          status = ?,
          razorpay_order_id = COALESCE(?, razorpay_order_id),
          razorpay_payment_id = COALESCE(?, razorpay_payment_id),
          payment_confirmed_at = COALESCE(?, payment_confirmed_at),
          updated_at = ?
        WHERE id = ?`
      )
      .bind(
        status,
        meta?.razorpayOrderId ?? null,
        meta?.razorpayPaymentId ?? null,
        meta?.paymentConfirmedAt ?? null,
        Date.now(),
        orderId
      )
      .run();
  }

  private async hydrateOrder(row: Record<string, unknown>): Promise<OrderRecord> {
    const itemsRes = await this.db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC')
      .bind(row.id as string)
      .all<Record<string, unknown>>();

    const items: OrderItemRecord[] = (itemsRes.results || []).map(r => ({
      id: r.id as string,
      orderId: r.order_id as string,
      productId: r.product_id as string,
      inventorySku: r.inventory_sku as string,
      unitPrice: Number(r.unit_price),
      quantity: Number(r.quantity),
      lineTotal: Number(r.line_total),
      createdAt: Number(r.created_at)
    }));

    return {
      id: row.id as string,
      customer: {
        name: row.customer_name as string,
        email: row.customer_email as string,
        phone: (row.customer_phone as string) || undefined,
        country: (row.shipping_country as string) || 'IN',
        addressLine1: (row.shipping_address_line1 as string) || undefined,
        city: (row.shipping_city as string) || undefined,
        state: (row.shipping_state as string) || undefined,
        postalCode: (row.shipping_postal_code as string) || undefined
      },
      items,
      shippingFee: Number(row.shipping_fee),
      subtotal: Number(row.subtotal),
      total: Number(row.total),
      currency: (row.currency as 'INR') || 'INR',
      status: row.status as OrderStatus,
      shippingQuoteId: (row.shipping_quote_id as string) || undefined,
      idempotencyKey: row.idempotency_key as string,
      razorpayOrderId: (row.razorpay_order_id as string) || undefined,
      razorpayPaymentId: (row.razorpay_payment_id as string) || undefined,
      paymentConfirmedAt: row.payment_confirmed_at !== null && row.payment_confirmed_at !== undefined ? Number(row.payment_confirmed_at) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // ==========================================
  // INVENTORY SNAPSHOTS
  // ==========================================

  public async saveInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO inventory_snapshots (
          sku, product_id, approved_selling_price, currency, in_stock, reserved_order_id,
          carat_weight, ratti_weight, cert_number, cert_status, cert_lab, origin, notes,
          approved_by, approved_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sku) DO UPDATE SET
          product_id = excluded.product_id,
          approved_selling_price = excluded.approved_selling_price,
          currency = excluded.currency,
          in_stock = excluded.in_stock,
          reserved_order_id = excluded.reserved_order_id,
          carat_weight = excluded.carat_weight,
          ratti_weight = excluded.ratti_weight,
          cert_number = excluded.cert_number,
          cert_status = excluded.cert_status,
          cert_lab = excluded.cert_lab,
          origin = excluded.origin,
          notes = excluded.notes,
          approved_by = excluded.approved_by,
          approved_at = excluded.approved_at,
          updated_at = excluded.updated_at`
      )
      .bind(
        snapshot.sku,
        snapshot.productId,
        snapshot.approvedSellingPrice,
        snapshot.currency || 'INR',
        snapshot.inStock ? 1 : 0,
        snapshot.reservedOrderId || null,
        snapshot.caratWeight ?? null,
        snapshot.rattiWeight ?? null,
        snapshot.certNumber || null,
        snapshot.certStatus || 'CERTIFIED',
        snapshot.certLab || null,
        snapshot.origin || null,
        snapshot.notes || null,
        snapshot.approvedBy,
        snapshot.approvedAt,
        snapshot.updatedAt
      )
      .run();
  }

  public async getInventorySnapshotBySku(sku: string): Promise<InventorySnapshotRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM inventory_snapshots WHERE sku = ?')
      .bind(sku)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydrateInventory(row);
  }

  public async updateInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void> {
    await this.db
      .prepare(
        `UPDATE inventory_snapshots SET
          approved_selling_price = ?,
          in_stock = ?,
          reserved_order_id = ?,
          carat_weight = ?,
          ratti_weight = ?,
          cert_number = ?,
          cert_status = ?,
          cert_lab = ?,
          origin = ?,
          notes = ?,
          updated_at = ?
        WHERE sku = ?`
      )
      .bind(
        snapshot.approvedSellingPrice,
        snapshot.inStock ? 1 : 0,
        snapshot.reservedOrderId || null,
        snapshot.caratWeight ?? null,
        snapshot.rattiWeight ?? null,
        snapshot.certNumber || null,
        snapshot.certStatus || 'CERTIFIED',
        snapshot.certLab || null,
        snapshot.origin || null,
        snapshot.notes || null,
        snapshot.updatedAt,
        snapshot.sku
      )
      .run();
  }

  public async reserveInventoryForOrder(orderId: string, skus: string[]): Promise<boolean> {
    if (!skus.length) return true;
    for (const sku of skus) {
      const snap = await this.getInventorySnapshotBySku(sku);
      if (!snap || !snap.inStock || (snap.reservedOrderId && snap.reservedOrderId !== orderId)) {
        return false;
      }
    }
    const stmts = skus.map(sku =>
      this.db
        .prepare('UPDATE inventory_snapshots SET reserved_order_id = ?, updated_at = ? WHERE sku = ?')
        .bind(orderId, Date.now(), sku)
    );
    await this.db.batch(stmts);
    return true;
  }

  public async releaseInventoryForOrder(orderId: string): Promise<void> {
    await this.db
      .prepare('UPDATE inventory_snapshots SET reserved_order_id = NULL, updated_at = ? WHERE reserved_order_id = ?')
      .bind(Date.now(), orderId)
      .run();
  }

  public async finalizeInventoryForOrder(orderId: string): Promise<void> {
    await this.db
      .prepare('UPDATE inventory_snapshots SET in_stock = 0, reserved_order_id = NULL, updated_at = ? WHERE reserved_order_id = ?')
      .bind(Date.now(), orderId)
      .run();
  }

  public async listInventorySnapshots(options: PaginationOptions = {}): Promise<PaginatedResult<InventorySnapshotRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM inventory_snapshots';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.status === 'IN_STOCK') {
      conditions.push('in_stock = 1');
    } else if (options.status === 'OUT_OF_STOCK') {
      conditions.push('in_stock = 0');
    }

    if (options.query) {
      conditions.push('(sku LIKE ? OR product_id LIKE ? OR cert_number LIKE ?)');
      const q = `%${options.query.trim()}%`;
      params.push(q, q, q);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countRes = await this.db.prepare(countSql).bind(...params).first<{ count: number }>();
    const total = countRes ? Number(countRes.count) : 0;

    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rowsRes = await this.db.prepare(query).bind(...params).all<Record<string, unknown>>();
    const items = (rowsRes.results || []).map(r => this.hydrateInventory(r));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  public async checkPendingOrdersForSku(sku: string): Promise<number> {
    const res = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.inventory_sku = ? AND o.status = 'PENDING_PAYMENT'`
      )
      .bind(sku)
      .first<{ count: number }>();

    return res ? Number(res.count) : 0;
  }

  private hydrateInventory(row: Record<string, unknown>): InventorySnapshotRecord {
    return {
      sku: row.sku as string,
      productId: row.product_id as string,
      approvedSellingPrice: Number(row.approved_selling_price),
      currency: (row.currency as 'INR') || 'INR',
      inStock: Boolean(row.in_stock),
      reservedOrderId: (row.reserved_order_id as string) || undefined,
      caratWeight: row.carat_weight !== null && row.carat_weight !== undefined ? Number(row.carat_weight) : undefined,
      rattiWeight: row.ratti_weight !== null && row.ratti_weight !== undefined ? Number(row.ratti_weight) : undefined,
      certNumber: (row.cert_number as string) || undefined,
      certStatus: (row.cert_status as any) || 'CERTIFIED',
      certLab: (row.cert_lab as string) || undefined,
      origin: (row.origin as string) || undefined,
      notes: (row.notes as string) || undefined,
      approvedBy: row.approved_by as string,
      approvedAt: Number(row.approved_at),
      updatedAt: Number(row.updated_at)
    };
  }

  // ==========================================
  // PAYMENT ATTEMPTS
  // ==========================================

  public async savePaymentAttempt(attempt: PaymentAttemptRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO payment_attempts (
          id, order_id, gateway, gateway_order_id, gateway_payment_id,
          status, amount, amount_subunits, currency, signature, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        attempt.id,
        attempt.orderId,
        attempt.gateway,
        attempt.gatewayOrderId || null,
        attempt.gatewayPaymentId || null,
        attempt.status,
        attempt.amount,
        attempt.amountSubunits ?? null,
        attempt.currency,
        attempt.signature || null,
        attempt.errorMessage || null,
        attempt.createdAt,
        attempt.updatedAt
      )
      .run();
  }

  public async getPaymentAttemptsByOrderId(orderId: string): Promise<readonly PaymentAttemptRecord[]> {
    const res = await this.db
      .prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY created_at ASC')
      .bind(orderId)
      .all<Record<string, unknown>>();

    return (res.results || []).map(r => this.hydratePaymentAttempt(r));
  }

  public async getPaymentAttemptByGatewayOrderId(gatewayOrderId: string): Promise<PaymentAttemptRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM payment_attempts WHERE gateway_order_id = ? ORDER BY created_at DESC')
      .bind(gatewayOrderId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return this.hydratePaymentAttempt(row);
  }

  public async updatePaymentAttempt(id: string, updates: Partial<PaymentAttemptRecord>): Promise<void> {
    await this.db
      .prepare(
        `UPDATE payment_attempts SET
          status = COALESCE(?, status),
          gateway_payment_id = COALESCE(?, gateway_payment_id),
          signature = COALESCE(?, signature),
          error_message = COALESCE(?, error_message),
          updated_at = ?
        WHERE id = ?`
      )
      .bind(
        updates.status ?? null,
        updates.gatewayPaymentId ?? null,
        updates.signature ?? null,
        updates.errorMessage ?? null,
        Date.now(),
        id
      )
      .run();
  }

  private hydratePaymentAttempt(r: Record<string, unknown>): PaymentAttemptRecord {
    return {
      id: r.id as string,
      orderId: r.order_id as string,
      gateway: r.gateway as 'RAZORPAY',
      gatewayOrderId: (r.gateway_order_id as string) || undefined,
      gatewayPaymentId: (r.gateway_payment_id as string) || undefined,
      status: r.status as PaymentAttemptStatus,
      amount: Number(r.amount),
      amountSubunits: r.amount_subunits !== null && r.amount_subunits !== undefined ? Number(r.amount_subunits) : undefined,
      currency: (r.currency as 'INR') || 'INR',
      signature: (r.signature as string) || undefined,
      errorMessage: (r.error_message as string) || undefined,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    };
  }

  // ==========================================
  // WEBHOOK EVENTS
  // ==========================================

  public async saveWebhookEvent(record: WebhookEventRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhook_events (
          id, event_id, event_type, status, payload_json, error_message, processed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.id,
        record.eventId,
        record.eventType,
        record.status,
        record.payloadJson || null,
        record.errorMessage || null,
        record.processedAt ?? null,
        record.createdAt
      )
      .run();
  }

  public async getWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM webhook_events WHERE event_id = ?')
      .bind(eventId)
      .first<Record<string, unknown>>();

    if (!row) return null;
    return {
      id: row.id as string,
      eventId: row.event_id as string,
      eventType: row.event_type as string,
      status: row.status as any,
      payloadJson: (row.payload_json as string) || undefined,
      errorMessage: (row.error_message as string) || undefined,
      processedAt: Number(row.processed_at),
      createdAt: Number(row.created_at)
    };
  }

  public async updateWebhookEventStatus(
    eventId: string,
    status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED',
    errorMessage?: string
  ): Promise<void> {
    await this.db
      .prepare('UPDATE webhook_events SET status = ?, error_message = ?, processed_at = ? WHERE event_id = ?')
      .bind(status, errorMessage || null, Date.now(), eventId)
      .run();
  }

  // ==========================================
  // IDEMPOTENCY RECORDS
  // ==========================================

  public async saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO idempotency_records (
          key, resource_type, resource_id, response_status, response_body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        record.key,
        record.resourceType,
        record.resourceId,
        record.responseStatus,
        record.responseBody,
        record.createdAt
      )
      .run();
  }

  public async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM idempotency_records WHERE key = ?')
      .bind(key)
      .first<Record<string, unknown>>();

    if (!row) return null;

    return {
      key: row.key as string,
      resourceType: row.resource_type as 'INQUIRY' | 'QUOTE' | 'ORDER',
      resourceId: row.resource_id as string,
      responseStatus: Number(row.response_status),
      responseBody: row.response_body as string,
      createdAt: Number(row.created_at)
    };
  }

  // ==========================================
  // AUDIT LOGS
  // ==========================================

  public async saveAuditLog(log: AuditLogRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, entity_type, entity_id, action, actor, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        log.id,
        log.entityType,
        log.entityId,
        log.action,
        log.actor,
        log.detailsJson || null,
        log.createdAt
      )
      .run();
  }

  public async listAuditLogs(options: PaginationOptions = {}): Promise<PaginatedResult<AuditLogRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 50));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM audit_logs';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (options.status) {
      conditions.push('entity_type = ?');
      params.push(options.status);
    }
    if (options.query) {
      conditions.push('(entity_id LIKE ? OR action LIKE ? OR actor LIKE ?)');
      const q = `%${options.query.trim()}%`;
      params.push(q, q, q);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countRes = await this.db.prepare(countSql).bind(...params).first<{ count: number }>();
    const total = countRes ? Number(countRes.count) : 0;

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rowsRes = await this.db.prepare(query).bind(...params).all<Record<string, unknown>>();
    const items: AuditLogRecord[] = (rowsRes.results || []).map(r => ({
      id: r.id as string,
      entityType: r.entity_type as any,
      entityId: r.entity_id as string,
      action: r.action as string,
      actor: r.actor as string,
      detailsJson: (r.details_json as string) || undefined,
      createdAt: Number(r.created_at)
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  // ==========================================
  // CLEANUP HELPER (FOR TESTS)
  // ==========================================

  public async clear(): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM customer_tokens'),
      this.db.prepare('DELETE FROM inquiry_notes'),
      this.db.prepare('DELETE FROM inquiry_items'),
      this.db.prepare('DELETE FROM inquiries'),
      this.db.prepare('DELETE FROM order_items'),
      this.db.prepare('DELETE FROM orders'),
      this.db.prepare('DELETE FROM shipping_quotes'),
      this.db.prepare('DELETE FROM inventory_snapshots'),
      this.db.prepare('DELETE FROM payment_attempts'),
      this.db.prepare('DELETE FROM idempotency_records'),
      this.db.prepare('DELETE FROM audit_logs')
    ]);
  }
}
