// src/backend/storage.ts
// Stage 3B: Storage interface and in-memory persistence adapter with owner management & customer tokens

import type {
  InquiryRecord,
  ShippingQuoteRecord,
  OrderRecord,
  OrderStatus,
  InventorySnapshotRecord,
  PaymentAttemptRecord,
  IdempotencyRecord,
  CustomerTokenRecord,
  InquiryNoteRecord,
  AuditLogRecord,
  InquiryStatus,
  PaginationOptions,
  PaginatedResult,
  WebhookEventRecord
} from './types';

export interface BackendStorage {
  // Customer Tokens (Expiring high-entropy access tokens)
  saveCustomerToken(tokenRec: CustomerTokenRecord): Promise<void>;
  getCustomerToken(token: string): Promise<CustomerTokenRecord | null>;

  // Inquiries
  saveInquiry(inquiry: InquiryRecord): Promise<void>;
  getInquiryById(id: string): Promise<InquiryRecord | null>;
  getInquiryByIdempotencyKey(key: string): Promise<InquiryRecord | null>;
  updateInquiryStatus(id: string, status: InquiryStatus, updatedAt: number): Promise<void>;
  listInquiries(options?: PaginationOptions): Promise<PaginatedResult<InquiryRecord>>;

  // Inquiry Notes
  saveInquiryNote(note: InquiryNoteRecord): Promise<void>;
  getInquiryNotes(inquiryId: string): Promise<readonly InquiryNoteRecord[]>;

  // Shipping Quotes
  saveShippingQuote(quote: ShippingQuoteRecord): Promise<void>;
  getShippingQuoteById(id: string): Promise<ShippingQuoteRecord | null>;
  getShippingQuoteByIdempotencyKey(key: string): Promise<ShippingQuoteRecord | null>;
  updateShippingQuote(quote: ShippingQuoteRecord): Promise<void>;
  listShippingQuotes(options?: PaginationOptions): Promise<PaginatedResult<ShippingQuoteRecord>>;

  // Orders
  saveOrder(order: OrderRecord): Promise<void>;
  getOrderById(id: string): Promise<OrderRecord | null>;
  getOrderByIdempotencyKey(key: string): Promise<OrderRecord | null>;
  getOrderByRazorpayOrderId(razorpayOrderId: string): Promise<OrderRecord | null>;
  updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    meta?: { razorpayOrderId?: string; razorpayPaymentId?: string; paymentConfirmedAt?: number }
  ): Promise<void>;

  // Inventory Snapshots (Physical gemstone lots)
  saveInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void>;
  getInventorySnapshotBySku(sku: string): Promise<InventorySnapshotRecord | null>;
  updateInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void>;
  listInventorySnapshots(options?: PaginationOptions): Promise<PaginatedResult<InventorySnapshotRecord>>;
  checkPendingOrdersForSku(sku: string): Promise<number>;
  reserveInventoryForOrder(orderId: string, skus: string[]): Promise<boolean>;
  releaseInventoryForOrder(orderId: string): Promise<void>;
  finalizeInventoryForOrder(orderId: string): Promise<void>;

  // Payment Attempts
  savePaymentAttempt(attempt: PaymentAttemptRecord): Promise<void>;
  getPaymentAttemptsByOrderId(orderId: string): Promise<readonly PaymentAttemptRecord[]>;
  getPaymentAttemptByGatewayOrderId(gatewayOrderId: string): Promise<PaymentAttemptRecord | null>;
  updatePaymentAttempt(id: string, updates: Partial<PaymentAttemptRecord>): Promise<void>;

  // Webhook Events
  saveWebhookEvent(record: WebhookEventRecord): Promise<void>;
  getWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null>;
  updateWebhookEventStatus(
    eventId: string,
    status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED',
    errorMessage?: string
  ): Promise<void>;

  // Idempotency cache
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<void>;
  getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null>;

  // Audit Logs
  saveAuditLog(log: AuditLogRecord): Promise<void>;
  listAuditLogs(options?: PaginationOptions): Promise<PaginatedResult<AuditLogRecord>>;

  // Reset helper for testing
  clear(): Promise<void>;
}

/**
 * In-memory storage adapter for local development, CI testing, and non-Cloudflare environments.
 * Enforces uniqueness constraints, deep clones on read/write to prevent external mutation.
 */
export class MemoryBackendStorage implements BackendStorage {
  private readonly tokens = new Map<string, CustomerTokenRecord>();
  private readonly inquiries = new Map<string, InquiryRecord>();
  private readonly inquiriesByIdempotency = new Map<string, string>(); // key -> id
  private readonly inquiryNotes = new Map<string, InquiryNoteRecord[]>(); // inquiryId -> notes

  private readonly quotes = new Map<string, ShippingQuoteRecord>();
  private readonly quotesByIdempotency = new Map<string, string>();

  private readonly orders = new Map<string, OrderRecord>();
  private readonly ordersByIdempotency = new Map<string, string>();
  private readonly ordersByRazorpayId = new Map<string, string>();

  private readonly inventory = new Map<string, InventorySnapshotRecord>();
  private readonly paymentAttempts = new Map<string, PaymentAttemptRecord[]>();
  private readonly paymentAttemptsById = new Map<string, PaymentAttemptRecord>();
  private readonly idempotencyCache = new Map<string, IdempotencyRecord>();
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();

  private clone<T>(val: T): T {
    return JSON.parse(JSON.stringify(val));
  }

  // ==========================================
  // CUSTOMER TOKENS
  // ==========================================

  public async saveCustomerToken(tokenRec: CustomerTokenRecord): Promise<void> {
    this.tokens.set(tokenRec.token, this.clone(tokenRec));
  }

  public async getCustomerToken(token: string): Promise<CustomerTokenRecord | null> {
    const item = this.tokens.get(token);
    return item ? this.clone(item) : null;
  }

  // ==========================================
  // INQUIRIES & NOTES
  // ==========================================

  public async saveInquiry(inquiry: InquiryRecord): Promise<void> {
    if (this.inquiries.has(inquiry.id)) {
      throw new Error(`Inquiry with id ${inquiry.id} already exists`);
    }
    if (this.inquiriesByIdempotency.has(inquiry.idempotencyKey)) {
      throw new Error(`Idempotency key collision for inquiry: ${inquiry.idempotencyKey}`);
    }
    this.inquiries.set(inquiry.id, this.clone(inquiry));
    this.inquiriesByIdempotency.set(inquiry.idempotencyKey, inquiry.id);
  }

  public async getInquiryById(id: string): Promise<InquiryRecord | null> {
    const item = this.inquiries.get(id);
    if (!item) return null;
    const cloned = this.clone(item);
    return {
      ...cloned,
      internalNotes: this.clone(this.inquiryNotes.get(id) || [])
    };
  }

  public async getInquiryByIdempotencyKey(key: string): Promise<InquiryRecord | null> {
    const id = this.inquiriesByIdempotency.get(key);
    if (!id) return null;
    return this.getInquiryById(id);
  }

  public async updateInquiryStatus(id: string, status: InquiryStatus, updatedAt: number): Promise<void> {
    const existing = this.inquiries.get(id);
    if (!existing) {
      throw new Error(`Inquiry ${id} not found`);
    }
    this.inquiries.set(id, {
      ...existing,
      status,
      updatedAt
    });
  }

  public async listInquiries(options: PaginationOptions = {}): Promise<PaginatedResult<InquiryRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));

    let items = Array.from(this.inquiries.values());

    if (options.status) {
      items = items.filter(i => i.status === options.status);
    }
    if (options.query) {
      const q = options.query.toLowerCase().trim();
      items = items.filter(i =>
        i.customerName.toLowerCase().includes(q) ||
        i.customerEmail.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => b.createdAt - a.createdAt);

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = items.slice((page - 1) * limit, page * limit).map(i => {
      const cloned = this.clone(i);
      return {
        ...cloned,
        internalNotes: this.clone(this.inquiryNotes.get(i.id) || [])
      };
    });

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages
    };
  }

  public async saveInquiryNote(note: InquiryNoteRecord): Promise<void> {
    const list = this.inquiryNotes.get(note.inquiryId) || [];
    list.push(this.clone(note));
    this.inquiryNotes.set(note.inquiryId, list);
  }

  public async getInquiryNotes(inquiryId: string): Promise<readonly InquiryNoteRecord[]> {
    const list = this.inquiryNotes.get(inquiryId) || [];
    return this.clone(list);
  }

  // ==========================================
  // SHIPPING QUOTES
  // ==========================================

  public async saveShippingQuote(quote: ShippingQuoteRecord): Promise<void> {
    if (this.quotes.has(quote.id)) {
      throw new Error(`Shipping quote with id ${quote.id} already exists`);
    }
    if (this.quotesByIdempotency.has(quote.idempotencyKey)) {
      throw new Error(`Idempotency key collision for quote: ${quote.idempotencyKey}`);
    }
    this.quotes.set(quote.id, this.clone(quote));
    this.quotesByIdempotency.set(quote.idempotencyKey, quote.id);
  }

  public async getShippingQuoteById(id: string): Promise<ShippingQuoteRecord | null> {
    const item = this.quotes.get(id);
    return item ? this.clone(item) : null;
  }

  public async getShippingQuoteByIdempotencyKey(key: string): Promise<ShippingQuoteRecord | null> {
    const id = this.quotesByIdempotency.get(key);
    if (!id) return null;
    return this.getShippingQuoteById(id);
  }

  public async updateShippingQuote(quote: ShippingQuoteRecord): Promise<void> {
    if (!this.quotes.has(quote.id)) {
      throw new Error(`Cannot update non-existent quote ${quote.id}`);
    }
    this.quotes.set(quote.id, this.clone(quote));
  }

  public async listShippingQuotes(options: PaginationOptions = {}): Promise<PaginatedResult<ShippingQuoteRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));

    let items = Array.from(this.quotes.values());

    if (options.status) {
      items = items.filter(q => q.status === options.status);
    }
    if (options.query) {
      const q = options.query.toLowerCase().trim();
      items = items.filter(item =>
        item.customerEmail.toLowerCase().includes(q) ||
        item.destinationCountry.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => b.createdAt - a.createdAt);

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = items.slice((page - 1) * limit, page * limit).map(q => this.clone(q));

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages
    };
  }

  // ==========================================
  // ORDERS
  // ==========================================

  public async saveOrder(order: OrderRecord): Promise<void> {
    if (this.orders.has(order.id)) {
      throw new Error(`Order with id ${order.id} already exists`);
    }
    if (this.ordersByIdempotency.has(order.idempotencyKey)) {
      throw new Error(`Idempotency key collision for order: ${order.idempotencyKey}`);
    }
    this.orders.set(order.id, this.clone(order));
    this.ordersByIdempotency.set(order.idempotencyKey, order.id);
  }

  public async getOrderById(id: string): Promise<OrderRecord | null> {
    const item = this.orders.get(id);
    return item ? this.clone(item) : null;
  }

  public async getOrderByIdempotencyKey(key: string): Promise<OrderRecord | null> {
    const id = this.ordersByIdempotency.get(key);
    if (!id) return null;
    return this.getOrderById(id);
  }

  public async getOrderByRazorpayOrderId(razorpayOrderId: string): Promise<OrderRecord | null> {
    const orderId = this.ordersByRazorpayId.get(razorpayOrderId);
    if (orderId) {
      return this.getOrderById(orderId);
    }
    for (const order of this.orders.values()) {
      if (order.razorpayOrderId === razorpayOrderId) {
        return this.clone(order);
      }
    }
    return null;
  }

  public async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    meta?: { razorpayOrderId?: string; razorpayPaymentId?: string; paymentConfirmedAt?: number }
  ): Promise<void> {
    const existing = this.orders.get(orderId);
    if (!existing) {
      throw new Error(`Order ${orderId} not found`);
    }

    const updated: OrderRecord = {
      ...existing,
      status,
      razorpayOrderId: meta?.razorpayOrderId !== undefined ? meta.razorpayOrderId : existing.razorpayOrderId,
      razorpayPaymentId: meta?.razorpayPaymentId !== undefined ? meta.razorpayPaymentId : existing.razorpayPaymentId,
      paymentConfirmedAt: meta?.paymentConfirmedAt !== undefined ? meta.paymentConfirmedAt : existing.paymentConfirmedAt,
      updatedAt: Date.now()
    };

    this.orders.set(orderId, updated);
    if (updated.razorpayOrderId) {
      this.ordersByRazorpayId.set(updated.razorpayOrderId, orderId);
    }
  }

  // ==========================================
  // INVENTORY SNAPSHOTS
  // ==========================================

  public async saveInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void> {
    this.inventory.set(snapshot.sku, this.clone(snapshot));
  }

  public async getInventorySnapshotBySku(sku: string): Promise<InventorySnapshotRecord | null> {
    const item = this.inventory.get(sku);
    return item ? this.clone(item) : null;
  }

  public async updateInventorySnapshot(snapshot: InventorySnapshotRecord): Promise<void> {
    if (!this.inventory.has(snapshot.sku)) {
      throw new Error(`Cannot update non-existent inventory SKU ${snapshot.sku}`);
    }
    this.inventory.set(snapshot.sku, this.clone(snapshot));
  }

  public async listInventorySnapshots(options: PaginationOptions = {}): Promise<PaginatedResult<InventorySnapshotRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));

    let items = Array.from(this.inventory.values());

    if (options.status === 'IN_STOCK') {
      items = items.filter(it => it.inStock === true);
    } else if (options.status === 'OUT_OF_STOCK') {
      items = items.filter(it => it.inStock === false);
    }

    if (options.query) {
      const q = options.query.toLowerCase().trim();
      items = items.filter(it =>
        it.sku.toLowerCase().includes(q) ||
        it.productId.toLowerCase().includes(q) ||
        (it.certNumber && it.certNumber.toLowerCase().includes(q))
      );
    }

    items.sort((a, b) => b.updatedAt - a.updatedAt);

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = items.slice((page - 1) * limit, page * limit).map(it => this.clone(it));

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages
    };
  }

  public async checkPendingOrdersForSku(sku: string): Promise<number> {
    let count = 0;
    for (const order of this.orders.values()) {
      if (order.status === 'PENDING_PAYMENT') {
        if (order.items.some(item => item.inventorySku === sku)) {
          count++;
        }
      }
    }
    return count;
  }

  public async reserveInventoryForOrder(orderId: string, skus: string[]): Promise<boolean> {
    // 1. Verify all SKUs are in stock and unreserved (or already reserved by this order)
    for (const sku of skus) {
      const item = this.inventory.get(sku);
      if (!item || !item.inStock) {
        return false;
      }
      if (item.reservedOrderId && item.reservedOrderId !== orderId) {
        return false;
      }
    }

    // 2. Atomically reserve all SKUs for this order
    for (const sku of skus) {
      const item = this.inventory.get(sku)!;
      this.inventory.set(sku, {
        ...item,
        reservedOrderId: orderId
      });
    }

    return true;
  }

  public async releaseInventoryForOrder(orderId: string): Promise<void> {
    for (const [sku, item] of this.inventory.entries()) {
      if (item.reservedOrderId === orderId) {
        this.inventory.set(sku, {
          ...item,
          reservedOrderId: undefined
        });
      }
    }
  }

  public async finalizeInventoryForOrder(orderId: string): Promise<void> {
    const now = Date.now();
    for (const [sku, item] of this.inventory.entries()) {
      if (item.reservedOrderId === orderId) {
        this.inventory.set(sku, {
          ...item,
          inStock: false,
          reservedOrderId: undefined,
          updatedAt: now
        });
      }
    }
  }

  // ==========================================
  // PAYMENT ATTEMPTS
  // ==========================================

  public async savePaymentAttempt(attempt: PaymentAttemptRecord): Promise<void> {
    const list = this.paymentAttempts.get(attempt.orderId) || [];
    list.push(this.clone(attempt));
    this.paymentAttempts.set(attempt.orderId, list);
    this.paymentAttemptsById.set(attempt.id, this.clone(attempt));
  }

  public async getPaymentAttemptsByOrderId(orderId: string): Promise<readonly PaymentAttemptRecord[]> {
    const list = this.paymentAttempts.get(orderId) || [];
    return this.clone(list);
  }

  public async getPaymentAttemptByGatewayOrderId(gatewayOrderId: string): Promise<PaymentAttemptRecord | null> {
    for (const attempt of this.paymentAttemptsById.values()) {
      if (attempt.gatewayOrderId === gatewayOrderId) {
        return this.clone(attempt);
      }
    }
    return null;
  }

  public async updatePaymentAttempt(id: string, updates: Partial<PaymentAttemptRecord>): Promise<void> {
    const existing = this.paymentAttemptsById.get(id);
    if (!existing) {
      throw new Error(`Payment attempt ${id} not found`);
    }
    const updated: PaymentAttemptRecord = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };
    this.paymentAttemptsById.set(id, updated);

    // Also update in order's list
    const list = this.paymentAttempts.get(updated.orderId) || [];
    const idx = list.findIndex(a => a.id === id);
    if (idx >= 0) {
      list[idx] = this.clone(updated);
    } else {
      list.push(this.clone(updated));
    }
    this.paymentAttempts.set(updated.orderId, list);
  }

  // ==========================================
  // WEBHOOK EVENTS
  // ==========================================

  public async saveWebhookEvent(record: WebhookEventRecord): Promise<void> {
    if (this.webhookEvents.has(record.eventId)) {
      throw new Error(`Webhook event with eventId ${record.eventId} already exists`);
    }
    this.webhookEvents.set(record.eventId, this.clone(record));
  }

  public async getWebhookEventByEventId(eventId: string): Promise<WebhookEventRecord | null> {
    const item = this.webhookEvents.get(eventId);
    return item ? this.clone(item) : null;
  }

  public async updateWebhookEventStatus(
    eventId: string,
    status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED',
    errorMessage?: string
  ): Promise<void> {
    const existing = this.webhookEvents.get(eventId);
    if (!existing) {
      throw new Error(`Webhook event with eventId ${eventId} not found`);
    }
    const updated: WebhookEventRecord = {
      ...existing,
      status,
      errorMessage,
      processedAt: Date.now()
    };
    this.webhookEvents.set(eventId, updated);
  }

  // ==========================================
  // IDEMPOTENCY CACHE
  // ==========================================

  public async saveIdempotencyRecord(record: IdempotencyRecord): Promise<void> {
    this.idempotencyCache.set(record.key, this.clone(record));
  }

  public async getIdempotencyRecord(key: string): Promise<IdempotencyRecord | null> {
    const item = this.idempotencyCache.get(key);
    return item ? this.clone(item) : null;
  }

  // ==========================================
  // AUDIT LOGS
  // ==========================================

  public async saveAuditLog(log: AuditLogRecord): Promise<void> {
    this.auditLogs.unshift(this.clone(log));
  }

  public async listAuditLogs(options: PaginationOptions = {}): Promise<PaginatedResult<AuditLogRecord>> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 50));

    let items = [...this.auditLogs];

    if (options.status) {
      items = items.filter(l => l.entityType === options.status);
    }
    if (options.query) {
      const q = options.query.toLowerCase().trim();
      items = items.filter(l =>
        l.entityId.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.actor.toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginated = items.slice((page - 1) * limit, page * limit).map(l => this.clone(l));

    return {
      items: paginated,
      total,
      page,
      limit,
      totalPages
    };
  }

  // ==========================================
  // CLEAR HELPER
  // ==========================================

  public async clear(): Promise<void> {
    this.tokens.clear();
    this.inquiries.clear();
    this.inquiriesByIdempotency.clear();
    this.inquiryNotes.clear();
    this.quotes.clear();
    this.quotesByIdempotency.clear();
    this.orders.clear();
    this.ordersByIdempotency.clear();
    this.ordersByRazorpayId.clear();
    this.inventory.clear();
    this.paymentAttempts.clear();
    this.paymentAttemptsById.clear();
    this.idempotencyCache.clear();
    this.auditLogs.length = 0;
    this.webhookEvents.clear();
  }
}
