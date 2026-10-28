// src/backend/service.ts
// Stage 3C: Domain business logic for inquiries, quotes, inventory, owner management, secure customer tokens, and Razorpay payments

import { getProductById } from '../core/products';
import { BackendValidator } from './validator';
import type { BackendStorage } from './storage';
import { MockRazorpayClient } from './razorpay-client';
import {
  parseInventoryCsv,
  validateInventoryBatch,
  BatchValidationResult,
  generateInventoryCsvTemplate
} from '../inventory/csv-importer';
import type {
  InquiryRecord,
  InquiryItemRecord,
  InquiryNoteRecord,
  InquiryStatus,
  ShippingQuoteRecord,
  ApproveShippingQuoteInput,
  RejectShippingQuoteInput,
  OrderRecord,
  OrderItemRecord,
  InventorySnapshotRecord,
  CustomerTokenRecord,
  AuditLogRecord,
  PaginationOptions,
  PaginatedResult,
  PaymentAttemptRecord,
  WebhookEventRecord,
  CreatePaymentOrderResult,
  VerifyCheckoutPaymentResult,
  WebhookProcessingResult,
  IRazorpayClient
} from './types';
import { timingSafeEqual } from './crypto-utils';

export class BackendService {
  public static readonly DOMESTIC_SHIPPING_FEE = 200; // Flat ₹200 for domestic orders
  public static readonly CUSTOMER_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days token validity

  private readonly razorpayClient: IRazorpayClient;

  constructor(
    private readonly storage: BackendStorage,
    private readonly ownerSecret: string = 'test-owner-secret-stage3a',
    razorpayClient?: IRazorpayClient
  ) {
    this.razorpayClient = razorpayClient || new MockRazorpayClient();
  }

  public getRazorpayClient(): IRazorpayClient {
    return this.razorpayClient;
  }

  // ==========================================
  // CUSTOMER TOKEN HELPER
  // ==========================================

  private async generateCustomerToken(
    resourceType: 'INQUIRY' | 'QUOTE' | 'ORDER',
    resourceId: string,
    customerEmail: string
  ): Promise<{ token: string; expiresAt: number }> {
    const raw = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const token = `cat_${raw}`;
    const now = Date.now();
    const expiresAt = now + BackendService.CUSTOMER_TOKEN_TTL_MS;

    const tokenRec: CustomerTokenRecord = {
      id: `tok_${crypto.randomUUID()}`,
      token,
      resourceType,
      resourceId,
      customerEmail: customerEmail.toLowerCase(),
      expiresAt,
      createdAt: now
    };

    await this.storage.saveCustomerToken(tokenRec);
    return { token, expiresAt };
  }

  /**
   * Verifies that the provided token or owner secret grants access to the specified resource.
   */
  public async verifyAccess(
    resourceType: 'INQUIRY' | 'QUOTE' | 'ORDER',
    resourceId: string,
    providedToken: string | null,
    providedOwnerKey: string | null
  ): Promise<{ authorized: boolean; isOwner: boolean }> {
    // 1. Owner authorization check
    if (providedOwnerKey && timingSafeEqual(providedOwnerKey, this.ownerSecret)) {
      return { authorized: true, isOwner: true };
    }

    // 2. Customer access token check
    if (!providedToken) {
      return { authorized: false, isOwner: false };
    }

    const tokenRec = await this.storage.getCustomerToken(providedToken.trim());
    if (!tokenRec) {
      return { authorized: false, isOwner: false };
    }

    if (tokenRec.resourceType !== resourceType || tokenRec.resourceId !== resourceId) {
      return { authorized: false, isOwner: false };
    }

    if (tokenRec.expiresAt <= Date.now()) {
      return { authorized: false, isOwner: false };
    }

    return { authorized: true, isOwner: false };
  }

  // ==========================================
  // AUDIT LOG HELPER
  // ==========================================

  private async logAudit(
    entityType: 'INQUIRY' | 'QUOTE' | 'INVENTORY' | 'ORDER',
    entityId: string,
    action: string,
    actor: string,
    details?: unknown
  ): Promise<void> {
    const log: AuditLogRecord = {
      id: `aud_${crypto.randomUUID()}`,
      entityType,
      entityId,
      action,
      actor,
      detailsJson: details ? JSON.stringify(details) : undefined,
      createdAt: Date.now()
    };
    await this.storage.saveAuditLog(log);
  }

  // ==========================================
  // INQUIRIES (CUSTOMER & OWNER)
  // ==========================================

  public async createInquiry(rawRequest: unknown): Promise<InquiryRecord> {
    const validation = BackendValidator.validateCreateInquiry(rawRequest);
    if (!validation.valid || !validation.sanitized) {
      const err = new Error('Validation failed');
      (err as any).status = 400;
      (err as any).details = validation.errors;
      throw err;
    }

    const req = validation.sanitized;

    // Idempotency Check
    const existing = await this.storage.getInquiryByIdempotencyKey(req.idempotencyKey);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const inquiryId = `inq_${crypto.randomUUID()}`;

    const items: InquiryItemRecord[] = req.items.map((item) => {
      const prod = getProductById(item.productId)!;
      return {
        id: `inq_item_${crypto.randomUUID()}`,
        inquiryId,
        productId: prod.id,
        quantity: item.quantity,
        provisionalMinUnit: prod.price_min,
        provisionalMaxUnit: prod.price_max,
        createdAt: now
      };
    });

    const { token: customerAccessToken, expiresAt: tokenExpiresAt } =
      await this.generateCustomerToken('INQUIRY', inquiryId, req.customer.email);

    const inquiry: InquiryRecord = {
      id: inquiryId,
      customerName: req.customer.name,
      customerEmail: req.customer.email,
      customerPhone: req.customer.phone,
      destinationCountry: req.customer.country,
      status: 'PENDING_REVIEW',
      notes: req.notes,
      items,
      idempotencyKey: req.idempotencyKey,
      customerAccessToken,
      tokenExpiresAt,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.storage.saveInquiry(inquiry);
      await this.logAudit('INQUIRY', inquiryId, 'INQUIRY_CREATED', req.customer.email, {
        itemsCount: items.length
      });
      return inquiry;
    } catch (err: any) {
      if (err && String(err.message).includes('idempotency_key')) {
        const raceWinner = await this.storage.getInquiryByIdempotencyKey(req.idempotencyKey);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }

  public async getInquiry(id: string): Promise<InquiryRecord | null> {
    if (!id || typeof id !== 'string') return null;
    return this.storage.getInquiryById(id.trim());
  }

  public async listInquiries(ownerSecret: string, options?: PaginationOptions): Promise<PaginatedResult<InquiryRecord>> {
    this.assertOwner(ownerSecret);
    return this.storage.listInquiries(options);
  }

  public async addInquiryNote(inquiryId: string, rawBody: unknown, ownerSecret: string): Promise<InquiryNoteRecord> {
    this.assertOwner(ownerSecret);
    const inq = await this.storage.getInquiryById(inquiryId);
    if (!inq) {
      const err = new Error(`Inquiry '${inquiryId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    const val = BackendValidator.validateInquiryNote(rawBody);
    if (!val.valid || !val.sanitized) {
      const err = new Error('Invalid inquiry note.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const noteRecord: InquiryNoteRecord = {
      id: `inq_note_${crypto.randomUUID()}`,
      inquiryId,
      author: val.sanitized.author,
      note: val.sanitized.note,
      createdAt: Date.now()
    };

    await this.storage.saveInquiryNote(noteRecord);
    await this.logAudit('INQUIRY', inquiryId, 'INQUIRY_NOTE_ADDED', val.sanitized.author, {
      noteLength: val.sanitized.note.length
    });
    return noteRecord;
  }

  public async updateInquiryStatus(
    inquiryId: string,
    targetStatus: string,
    ownerSecret: string,
    actor = 'Owner Admin'
  ): Promise<InquiryRecord> {
    this.assertOwner(ownerSecret);
    const inq = await this.storage.getInquiryById(inquiryId);
    if (!inq) {
      const err = new Error(`Inquiry '${inquiryId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    const val = BackendValidator.validateInquiryStatusTransition(inq.status, targetStatus);
    if (!val.valid) {
      const err = new Error(val.error);
      (err as any).status = 422;
      (err as any).code = 'INVALID_STATUS_TRANSITION';
      throw err;
    }

    const now = Date.now();
    await this.storage.updateInquiryStatus(inquiryId, targetStatus as InquiryStatus, now);
    await this.logAudit('INQUIRY', inquiryId, 'STATUS_UPDATED', actor, {
      fromStatus: inq.status,
      toStatus: targetStatus
    });

    const updated = await this.storage.getInquiryById(inquiryId);
    return updated!;
  }

  // ==========================================
  // SHIPPING QUOTES (CUSTOMER & OWNER)
  // ==========================================

  public async createShippingQuote(rawRequest: unknown): Promise<ShippingQuoteRecord> {
    const validation = BackendValidator.validateCreateShippingQuote(rawRequest);
    if (!validation.valid || !validation.sanitized) {
      const err = new Error('Validation failed');
      (err as any).status = 400;
      (err as any).details = validation.errors;
      throw err;
    }

    const req = validation.sanitized;

    // Idempotency check
    const existing = await this.storage.getShippingQuoteByIdempotencyKey(req.idempotencyKey);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const quoteId = `quote_${crypto.randomUUID()}`;

    const { token: customerAccessToken, expiresAt: tokenExpiresAt } =
      await this.generateCustomerToken('QUOTE', quoteId, req.customerEmail);

    const quote: ShippingQuoteRecord = {
      id: quoteId,
      customerEmail: req.customerEmail,
      destinationCountry: req.destinationCountry,
      destinationPostalCode: req.destinationPostalCode,
      destinationAddress: req.destinationAddress,
      status: 'REQUESTED',
      idempotencyKey: req.idempotencyKey,
      customerAccessToken,
      tokenExpiresAt,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.storage.saveShippingQuote(quote);
      await this.logAudit('QUOTE', quoteId, 'QUOTE_REQUESTED', req.customerEmail, {
        destinationCountry: req.destinationCountry
      });
      return quote;
    } catch (err: any) {
      if (err && String(err.message).includes('idempotency_key')) {
        const raceWinner = await this.storage.getShippingQuoteByIdempotencyKey(req.idempotencyKey);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }

  public async getShippingQuote(id: string): Promise<ShippingQuoteRecord | null> {
    if (!id || typeof id !== 'string') return null;
    return this.storage.getShippingQuoteById(id.trim());
  }

  public async listShippingQuotes(ownerSecret: string, options?: PaginationOptions): Promise<PaginatedResult<ShippingQuoteRecord>> {
    this.assertOwner(ownerSecret);
    return this.storage.listShippingQuotes(options);
  }

  public async approveShippingQuote(input: ApproveShippingQuoteInput): Promise<ShippingQuoteRecord> {
    this.assertOwner(input.ownerSecret);

    const quote = await this.storage.getShippingQuoteById(input.quoteId);
    if (!quote) {
      const err = new Error(`Shipping quote '${input.quoteId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (quote.status !== 'REQUESTED') {
      const err = new Error(`Shipping quote cannot be approved from status '${quote.status}'.`);
      (err as any).status = 409;
      throw err;
    }

    if (typeof input.quotedAmount !== 'number' || input.quotedAmount <= 0 || !Number.isInteger(input.quotedAmount)) {
      const err = new Error('Quoted amount must be a positive integer in INR.');
      (err as any).status = 400;
      throw err;
    }

    const now = Date.now();
    const validityMs = Math.max(1, input.validityHours || 72) * 3600 * 1000;

    const updated: ShippingQuoteRecord = {
      ...quote,
      status: 'APPROVED_BY_OWNER',
      quotedAmount: input.quotedAmount,
      quotedCurrency: input.quotedCurrency || 'INR',
      expiresAt: now + validityMs,
      updatedAt: now
    };

    await this.storage.updateShippingQuote(updated);
    await this.logAudit('QUOTE', input.quoteId, 'QUOTE_APPROVED', 'Owner Admin', {
      quotedAmount: input.quotedAmount,
      validityHours: input.validityHours || 72
    });
    return updated;
  }

  public async rejectShippingQuote(input: RejectShippingQuoteInput): Promise<ShippingQuoteRecord> {
    this.assertOwner(input.ownerSecret);
    const val = BackendValidator.validateQuoteRejection({ reason: input.reason });
    if (!val.valid) {
      const err = new Error(val.errors[0]?.message || 'Invalid rejection reason.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const quote = await this.storage.getShippingQuoteById(input.quoteId);
    if (!quote) {
      const err = new Error(`Shipping quote '${input.quoteId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    if (quote.status !== 'REQUESTED' && quote.status !== 'APPROVED_BY_OWNER') {
      const err = new Error(`Cannot reject shipping quote in status '${quote.status}'.`);
      (err as any).status = 409;
      throw err;
    }

    const now = Date.now();
    const updated: ShippingQuoteRecord = {
      ...quote,
      status: 'REJECTED',
      rejectionReason: input.reason.trim(),
      updatedAt: now
    };

    await this.storage.updateShippingQuote(updated);
    await this.logAudit('QUOTE', input.quoteId, 'QUOTE_REJECTED', 'Owner Admin', {
      reason: input.reason
    });
    return updated;
  }

  /**
   * Customer accepts quote using their secure, expiring customer access token.
   */
  public async acceptShippingQuote(quoteId: string, customerToken: string): Promise<ShippingQuoteRecord> {
    const quote = await this.storage.getShippingQuoteById(quoteId);
    if (!quote) {
      const err = new Error(`Shipping quote '${quoteId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    // Verify Customer Token
    const access = await this.verifyAccess('QUOTE', quoteId, customerToken, null);
    if (!access.authorized) {
      const err = new Error('Invalid or expired customer token for quote acceptance.');
      (err as any).status = 403;
      (err as any).code = 'INVALID_CUSTOMER_TOKEN';
      throw err;
    }

    if (quote.status === 'ACCEPTED_BY_CUSTOMER') {
      return quote; // Idempotent return
    }

    if (quote.status !== 'APPROVED_BY_OWNER') {
      const err = new Error(`Quote cannot be accepted in status '${quote.status}'.`);
      (err as any).status = 409;
      throw err;
    }

    const now = Date.now();
    if (quote.expiresAt && quote.expiresAt < now) {
      const expiredQuote: ShippingQuoteRecord = {
        ...quote,
        status: 'EXPIRED',
        updatedAt: now
      };
      await this.storage.updateShippingQuote(expiredQuote);
      await this.logAudit('QUOTE', quoteId, 'QUOTE_EXPIRED', quote.customerEmail);
      const err = new Error('Shipping quote has expired. Please request a new quote.');
      (err as any).status = 410;
      (err as any).code = 'QUOTE_EXPIRED';
      throw err;
    }

    const acceptedQuote: ShippingQuoteRecord = {
      ...quote,
      status: 'ACCEPTED_BY_CUSTOMER',
      acceptedAt: now,
      updatedAt: now
    };

    await this.storage.updateShippingQuote(acceptedQuote);
    await this.logAudit('QUOTE', quoteId, 'QUOTE_ACCEPTED', quote.customerEmail);
    return acceptedQuote;
  }

  // ==========================================
  // PHYSICAL GEMSTONE INVENTORY (OWNER ONLY)
  // ==========================================

  public async registerInventory(rawInput: unknown, ownerSecret: string): Promise<InventorySnapshotRecord> {
    this.assertOwner(ownerSecret);

    const val = BackendValidator.validateRegisterInventory(rawInput);
    if (!val.valid || !val.sanitized) {
      const err = new Error('Inventory registration validation failed.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const input = val.sanitized;

    // Check SKU collision
    const existing = await this.storage.getInventorySnapshotBySku(input.sku);
    if (existing) {
      const err = new Error(`Inventory lot with SKU '${input.sku}' already exists.`);
      (err as any).status = 409;
      (err as any).code = 'SKU_ALREADY_EXISTS';
      throw err;
    }

    const now = Date.now();
    const snapshot: InventorySnapshotRecord = {
      sku: input.sku,
      productId: input.productId,
      approvedSellingPrice: input.approvedSellingPrice,
      currency: 'INR',
      inStock: input.inStock,
      caratWeight: input.caratWeight,
      rattiWeight: input.rattiWeight,
      certNumber: input.certNumber,
      certStatus: input.certStatus,
      certLab: input.certLab,
      origin: input.origin,
      notes: input.notes,
      approvedBy: input.approvedBy,
      approvedAt: now,
      updatedAt: now
    };

    await this.storage.saveInventorySnapshot(snapshot);
    await this.logAudit('INVENTORY', input.sku, 'INVENTORY_REGISTERED', input.approvedBy, {
      productId: input.productId,
      approvedPrice: input.approvedSellingPrice,
      inStock: input.inStock
    });
    return snapshot;
  }

  public async updateInventory(sku: string, rawInput: unknown, ownerSecret: string): Promise<InventorySnapshotRecord> {
    this.assertOwner(ownerSecret);

    const existing = await this.storage.getInventorySnapshotBySku(sku.trim().toUpperCase());
    if (!existing) {
      const err = new Error(`Inventory SKU '${sku}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    const val = BackendValidator.validateUpdateInventory(rawInput);
    if (!val.valid || !val.sanitized) {
      const err = new Error('Inventory update validation failed.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const input = val.sanitized;

    // Pending Order Protection
    if (input.approvedSellingPrice !== undefined && input.approvedSellingPrice !== existing.approvedSellingPrice) {
      const pendingOrdersCount = await this.storage.checkPendingOrdersForSku(existing.sku);
      if (pendingOrdersCount > 0) {
        const err = new Error(`Cannot change price of SKU '${existing.sku}': ${pendingOrdersCount} pending order(s) exist.`);
        (err as any).status = 409;
        (err as any).code = 'SKU_HAS_PENDING_ORDERS';
        throw err;
      }
    }

    const now = Date.now();
    const updated: InventorySnapshotRecord = {
      ...existing,
      approvedSellingPrice: input.approvedSellingPrice ?? existing.approvedSellingPrice,
      inStock: input.inStock ?? existing.inStock,
      caratWeight: input.caratWeight ?? existing.caratWeight,
      rattiWeight: input.rattiWeight ?? existing.rattiWeight,
      certNumber: input.certNumber ?? existing.certNumber,
      certStatus: input.certStatus ?? existing.certStatus,
      certLab: input.certLab ?? existing.certLab,
      origin: input.origin ?? existing.origin,
      notes: input.notes ?? existing.notes,
      updatedAt: now
    };

    await this.storage.updateInventorySnapshot(updated);
    await this.logAudit('INVENTORY', existing.sku, 'INVENTORY_UPDATED', input.updatedBy, {
      updatedPrice: input.approvedSellingPrice,
      updatedStock: input.inStock
    });
    return updated;
  }

  public async listInventory(ownerSecret: string, options?: PaginationOptions): Promise<PaginatedResult<InventorySnapshotRecord>> {
    this.assertOwner(ownerSecret);
    return this.storage.listInventorySnapshots(options);
  }

  public async getInventorySnapshot(sku: string): Promise<InventorySnapshotRecord | null> {
    if (!sku || typeof sku !== 'string') return null;
    return this.storage.getInventorySnapshotBySku(sku.trim().toUpperCase());
  }

  public async validateInventoryBatch(rawInput: unknown, ownerSecret: string): Promise<BatchValidationResult> {
    this.assertOwner(ownerSecret);
    let rawRows: { rowNumber: number; data: Record<string, string> }[] = [];

    if (typeof rawInput === 'string') {
      const parsed = parseInventoryCsv(rawInput);
      rawRows = [...parsed.rawRows];
    } else if (Array.isArray(rawInput)) {
      rawRows = rawInput.map((item, idx) => ({
        rowNumber: idx + 1,
        data: item && typeof item === 'object' ? (item as Record<string, string>) : {}
      }));
    } else if (rawInput && typeof rawInput === 'object' && 'csv' in (rawInput as any)) {
      const parsed = parseInventoryCsv(String((rawInput as any).csv));
      rawRows = [...parsed.rawRows];
    } else if (rawInput && typeof rawInput === 'object' && 'rows' in (rawInput as any) && Array.isArray((rawInput as any).rows)) {
      rawRows = (rawInput as any).rows.map((item: any, idx: number) => ({
        rowNumber: idx + 1,
        data: item && typeof item === 'object' ? item : {}
      }));
    } else {
      const err = new Error('Batch input must be a CSV string, an object with { csv }, or an array of rows.');
      (err as any).status = 400;
      throw err;
    }

    const existingResult = await this.storage.listInventorySnapshots({ limit: 1000 });
    const existingSkus = new Set(existingResult.items.map(it => it.sku));

    return validateInventoryBatch(rawRows, existingSkus);
  }

  public async importInventoryBatch(rawInput: unknown, ownerSecret: string): Promise<{
    importedCount: number;
    failedCount: number;
    totalRows: number;
    results: { sku: string; status: 'SUCCESS' | 'FAILED'; error?: string }[];
  }> {
    this.assertOwner(ownerSecret);
    const validation = await this.validateInventoryBatch(rawInput, ownerSecret);

    if (!validation.isValid && validation.validRows.length === 0) {
      const err = new Error(`Batch import failed: all ${validation.errors.length} row(s) contain validation errors.`);
      (err as any).status = 400;
      (err as any).details = validation.errors;
      throw err;
    }

    const results: { sku: string; status: 'SUCCESS' | 'FAILED'; error?: string }[] = [];
    let importedCount = 0;
    let failedCount = 0;

    for (const validRow of validation.validRows) {
      try {
        await this.registerInventory(validRow, ownerSecret);
        results.push({ sku: validRow.sku, status: 'SUCCESS' });
        importedCount++;
      } catch (err: any) {
        results.push({ sku: validRow.sku, status: 'FAILED', error: err.message });
        failedCount++;
      }
    }

    await this.logAudit('INVENTORY', 'BATCH', 'INVENTORY_BATCH_IMPORTED', 'Owner Admin', {
      totalRows: validation.totalRows,
      importedCount,
      failedCount
    });

    return {
      importedCount,
      failedCount,
      totalRows: validation.totalRows,
      results
    };
  }

  public getInventoryCsvTemplate(): string {
    return generateInventoryCsvTemplate();
  }

  // ==========================================
  // AUDIT LOGS (OWNER ONLY)
  // ==========================================

  public async listAuditLogs(ownerSecret: string, options?: PaginationOptions): Promise<PaginatedResult<AuditLogRecord>> {
    this.assertOwner(ownerSecret);
    return this.storage.listAuditLogs(options);
  }

  // ==========================================
  // ORDERS (STRICT PAYMENT GATING)
  // ==========================================

  public async createOrder(rawRequest: unknown): Promise<OrderRecord> {
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
      const err = new Error('Request body must be a JSON object.');
      (err as any).status = 400;
      throw err;
    }

    const b = rawRequest as Record<string, unknown>;

    // 1. Validate Customer Contact with full address
    const custRes = BackendValidator.validateCustomer(b.customer, true);
    if (!custRes.valid || !custRes.sanitized) {
      const err = new Error('Customer address validation failed.');
      (err as any).status = 400;
      (err as any).details = custRes.errors;
      throw err;
    }

    // 2. Validate Idempotency
    const keyRes = BackendValidator.validateIdempotencyKey(b.idempotencyKey);
    if (!keyRes.valid || !keyRes.sanitized) {
      const err = new Error('Idempotency key validation failed.');
      (err as any).status = 400;
      (err as any).details = [keyRes.error];
      throw err;
    }

    const existing = await this.storage.getOrderByIdempotencyKey(keyRes.sanitized);
    if (existing) {
      return existing;
    }

    // 3. Validate Items
    const rawItems = b.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      const err = new Error('Items list must be a non-empty array.');
      (err as any).status = 400;
      throw err;
    }

    const now = Date.now();
    const orderId = `ord_${crypto.randomUUID()}`;
    const orderItems: OrderItemRecord[] = [];
    let subtotal = 0;

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      if (!it || typeof it !== 'object') {
        const err = new Error(`Item ${i} is invalid.`);
        (err as any).status = 400;
        throw err;
      }

      const pId = String(it.productId || '').trim();
      const sku = String(it.inventorySku || '').trim();
      const qty = Number(it.quantity);

      if (BackendValidator.METADATA_ONLY_IDS.includes(pId)) {
        const err = new Error(`Product '${pId}' is an unpurchasable metadata item.`);
        (err as any).status = 400;
        throw err;
      }

      const prod = getProductById(pId);
      if (!prod) {
        const err = new Error(`Product '${pId}' not found.`);
        (err as any).status = 400;
        throw err;
      }

      if (!Number.isInteger(qty) || qty < 1 || qty > BackendValidator.MAX_QUANTITY_PER_ITEM) {
        const err = new Error(`Invalid quantity for item ${pId}.`);
        (err as any).status = 400;
        throw err;
      }

      if (!sku) {
        const err = new Error(`Item '${pId}' requires an owner-approved inventory SKU to order.`);
        (err as any).status = 422;
        (err as any).code = 'PROVISIONAL_ITEM_NOT_ORDERABLE';
        throw err;
      }

      // Authoritative Price Snapshot Lookup
      const snapshot = await this.storage.getInventorySnapshotBySku(sku);
      if (!snapshot || !snapshot.inStock || snapshot.productId !== pId || snapshot.approvedSellingPrice <= 0) {
        const err = new Error(`SKU '${sku}' has no approved fixed selling price or is out of stock.`);
        (err as any).status = 422;
        (err as any).code = 'INVENTORY_NOT_AVAILABLE';
        throw err;
      }

      const lineTotal = snapshot.approvedSellingPrice * qty;
      subtotal += lineTotal;

      orderItems.push({
        id: `ord_item_${crypto.randomUUID()}`,
        orderId,
        productId: pId,
        inventorySku: sku,
        unitPrice: snapshot.approvedSellingPrice,
        quantity: qty,
        lineTotal,
        createdAt: now
      });
    }

    // 4. Shipping Calculation
    const customer = custRes.sanitized;
    const isDomestic = customer.country === 'IN' || customer.country === 'INDIA';
    let shippingFee = 0;
    let shippingQuoteId: string | undefined;

    if (isDomestic) {
      shippingFee = BackendService.DOMESTIC_SHIPPING_FEE;
    } else {
      shippingQuoteId = typeof b.shippingQuoteId === 'string' ? b.shippingQuoteId.trim() : undefined;
      if (!shippingQuoteId) {
        const err = new Error('International orders require an accepted shipping quote.');
        (err as any).status = 422;
        (err as any).code = 'SHIPPING_QUOTE_REQUIRED';
        throw err;
      }

      const quote = await this.storage.getShippingQuoteById(shippingQuoteId);
      if (!quote || quote.status !== 'ACCEPTED_BY_CUSTOMER') {
        const err = new Error('Shipping quote is not accepted or not found.');
        (err as any).status = 422;
        (err as any).code = 'INVALID_SHIPPING_QUOTE';
        throw err;
      }

      if (quote.customerEmail.toLowerCase() !== customer.email.toLowerCase()) {
        const err = new Error('Shipping quote customer email mismatch.');
        (err as any).status = 403;
        throw err;
      }

      shippingFee = quote.quotedAmount || 0;
    }

    const total = subtotal + shippingFee;

    const { token: customerAccessToken, expiresAt: tokenExpiresAt } =
      await this.generateCustomerToken('ORDER', orderId, customer.email);

    const order: OrderRecord = {
      id: orderId,
      customer,
      items: orderItems,
      shippingFee,
      subtotal,
      total,
      currency: 'INR',
      status: 'PENDING_PAYMENT',
      shippingQuoteId,
      idempotencyKey: keyRes.sanitized,
      customerAccessToken,
      tokenExpiresAt,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.storage.saveOrder(order);
      await this.logAudit('ORDER', orderId, 'ORDER_CREATED', customer.email, {
        subtotal,
        shippingFee,
        total
      });
      return order;
    } catch (err: any) {
      if (err && String(err.message).includes('idempotency_key')) {
        const raceWinner = await this.storage.getOrderByIdempotencyKey(keyRes.sanitized);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }

  public async getOrder(id: string): Promise<OrderRecord | null> {
    if (!id || typeof id !== 'string') return null;
    return this.storage.getOrderById(id.trim());
  }

  // ==========================================
  // PAYMENTS & CHECKOUT (STAGE 3C)
  // ==========================================

  public async createPaymentOrder(
    rawRequest: unknown,
    _customerToken?: string | null
  ): Promise<CreatePaymentOrderResult> {
    const val = BackendValidator.validateCreatePaymentOrder(rawRequest);
    if (!val.valid || !val.sanitized) {
      const err = new Error('Payment order creation validation failed.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const req = val.sanitized;
    const now = Date.now();

    // Check Idempotency Key
    const existingOrder = await this.storage.getOrderByIdempotencyKey(req.idempotencyKey);
    if (existingOrder && existingOrder.razorpayOrderId) {
      return {
        orderId: existingOrder.id,
        razorpayOrderId: existingOrder.razorpayOrderId,
        razorpayKeyId: (this.razorpayClient as any).keyId || 'rzp_test_mock_key_id',
        amountSubunits: Math.round(existingOrder.total * 100),
        amount: existingOrder.total,
        currency: existingOrder.currency,
        customerAccessToken: existingOrder.customerAccessToken || ''
      };
    }

    // Authoritative Price Snapshot & Inventory Check
    const orderItems: OrderItemRecord[] = [];
    const reservedSkus: string[] = [];
    let subtotal = 0;
    const orderId = existingOrder ? existingOrder.id : `ord_${crypto.randomUUID()}`;

    for (let i = 0; i < req.items.length; i++) {
      const it = req.items[i];
      if (!it) continue;
      const pId = it.productId;
      const sku = it.inventorySku;
      const qty = it.quantity;

      if (BackendValidator.METADATA_ONLY_IDS.includes(pId)) {
        const err = new Error(`Product '${pId}' is an unpurchasable metadata item.`);
        (err as any).status = 400;
        throw err;
      }

      const prod = getProductById(pId);
      if (!prod) {
        const err = new Error(`Product '${pId}' not found.`);
        (err as any).status = 400;
        throw err;
      }

      const snapshot = await this.storage.getInventorySnapshotBySku(sku);
      if (!snapshot || !snapshot.inStock || snapshot.productId !== pId || snapshot.approvedSellingPrice <= 0) {
        const err = new Error(`SKU '${sku}' has no approved fixed selling price or is out of stock.`);
        (err as any).status = 422;
        (err as any).code = 'INVENTORY_NOT_AVAILABLE';
        throw err;
      }

      if (snapshot.reservedOrderId && snapshot.reservedOrderId !== orderId) {
        const err = new Error(`SKU '${sku}' is already reserved for another order.`);
        (err as any).status = 409;
        (err as any).code = 'INVENTORY_ALREADY_RESERVED';
        throw err;
      }

      const lineTotal = snapshot.approvedSellingPrice * qty;
      subtotal += lineTotal;
      reservedSkus.push(sku);

      orderItems.push({
        id: `ord_item_${crypto.randomUUID()}`,
        orderId,
        productId: pId,
        inventorySku: sku,
        unitPrice: snapshot.approvedSellingPrice,
        quantity: qty,
        lineTotal,
        createdAt: now
      });
    }

    // Shipping calculation
    const customer = req.customer;
    const isDomestic = customer.country === 'IN' || customer.country === 'INDIA';
    let shippingFee = 0;
    let shippingQuoteId: string | undefined;

    if (isDomestic) {
      shippingFee = BackendService.DOMESTIC_SHIPPING_FEE;
    } else {
      shippingQuoteId = req.shippingQuoteId;
      if (!shippingQuoteId) {
        const err = new Error('International orders require an accepted shipping quote.');
        (err as any).status = 422;
        (err as any).code = 'SHIPPING_QUOTE_REQUIRED';
        throw err;
      }

      const quote = await this.storage.getShippingQuoteById(shippingQuoteId);
      if (!quote || quote.status !== 'ACCEPTED_BY_CUSTOMER') {
        const err = new Error('Shipping quote is not accepted or not found.');
        (err as any).status = 422;
        (err as any).code = 'INVALID_SHIPPING_QUOTE';
        throw err;
      }

      if (quote.customerEmail.toLowerCase() !== customer.email.toLowerCase()) {
        const err = new Error('Shipping quote customer email mismatch.');
        (err as any).status = 403;
        throw err;
      }

      shippingFee = quote.quotedAmount || 0;
    }

    const total = subtotal + shippingFee;
    const amountSubunits = Math.round(total * 100);

    // Atomic Inventory Reservation (prevent overselling 1-of-1 physical gemstones)
    const reserved = await this.storage.reserveInventoryForOrder(orderId, reservedSkus);
    if (!reserved) {
      const err = new Error('One or more physical gemstone items in your cart were just reserved or purchased by another customer.');
      (err as any).status = 409;
      (err as any).code = 'INVENTORY_CONCURRENT_RESERVATION_CONFLICT';
      throw err;
    }

    // Razorpay Order Creation via Gateway
    let razorpayOrder;
    try {
      razorpayOrder = await this.razorpayClient.createOrder({
        amount: amountSubunits,
        currency: 'INR',
        receipt: orderId,
        notes: {
          orderId,
          customerEmail: customer.email
        }
      });
    } catch (rzpErr: any) {
      // Rollback reservation on failure
      await this.storage.releaseInventoryForOrder(orderId);
      throw rzpErr;
    }

    // Customer Token Generation
    const { token: customerAccessToken, expiresAt: tokenExpiresAt } =
      await this.generateCustomerToken('ORDER', orderId, customer.email);

    // Save internal order
    const order: OrderRecord = {
      id: orderId,
      customer,
      items: orderItems,
      shippingFee,
      subtotal,
      total,
      currency: 'INR',
      status: 'PENDING_PAYMENT',
      shippingQuoteId,
      razorpayOrderId: razorpayOrder.id,
      idempotencyKey: req.idempotencyKey,
      customerAccessToken,
      tokenExpiresAt,
      createdAt: existingOrder ? existingOrder.createdAt : now,
      updatedAt: now
    };

    if (existingOrder) {
      await this.storage.updateOrderStatus(orderId, 'PENDING_PAYMENT', {
        razorpayOrderId: razorpayOrder.id
      });
    } else {
      await this.storage.saveOrder(order);
    }

    // Persist Payment Attempt
    const attempt: PaymentAttemptRecord = {
      id: `pay_att_${crypto.randomUUID()}`,
      orderId,
      gateway: 'RAZORPAY',
      gatewayOrderId: razorpayOrder.id,
      amountSubunits,
      amount: total,
      currency: 'INR',
      status: 'CREATED',
      createdAt: now,
      updatedAt: now
    };
    await this.storage.savePaymentAttempt(attempt);

    await this.logAudit('ORDER', orderId, 'PAYMENT_ORDER_CREATED', customer.email, {
      razorpayOrderId: razorpayOrder.id,
      amountSubunits,
      itemsCount: orderItems.length
    });

    return {
      orderId,
      razorpayOrderId: razorpayOrder.id,
      razorpayKeyId: (this.razorpayClient as any).keyId || 'rzp_test_mock_key_id',
      amountSubunits,
      amount: total,
      currency: 'INR',
      customerAccessToken
    };
  }

  public async verifyCheckoutPayment(
    rawRequest: unknown,
    customerToken?: string | null
  ): Promise<VerifyCheckoutPaymentResult> {
    const val = BackendValidator.validateVerifyCheckoutPayment(rawRequest);
    if (!val.valid || !val.sanitized) {
      const err = new Error('Checkout payment verification validation failed.');
      (err as any).status = 400;
      (err as any).details = val.errors;
      throw err;
    }

    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = val.sanitized;

    const order = await this.storage.getOrderById(orderId);
    if (!order) {
      const err = new Error(`Order '${orderId}' not found.`);
      (err as any).status = 404;
      throw err;
    }

    // Customer Token / Owner verification
    const access = await this.verifyAccess('ORDER', order.id, customerToken || null, null);
    if (!access.authorized) {
      const err = new Error('Invalid or expired customer token for order verification.');
      (err as any).status = 403;
      (err as any).code = 'INVALID_CUSTOMER_TOKEN';
      throw err;
    }

    // Idempotent return if already confirmed
    if (order.status === 'PAYMENT_CONFIRMED') {
      return {
        success: true,
        orderId: order.id,
        status: 'PAYMENT_CONFIRMED',
        paymentId: order.razorpayPaymentId || razorpayPaymentId,
        captureStatus: 'captured',
        verifiedAt: order.paymentConfirmedAt || Date.now(),
        message: 'Payment already verified and confirmed.'
      };
    }

    if (order.status !== 'PENDING_PAYMENT') {
      const err = new Error(`Cannot verify payment for order in status '${order.status}'.`);
      (err as any).status = 409;
      (err as any).code = 'INVALID_ORDER_STATUS';
      throw err;
    }

    if (order.razorpayOrderId && order.razorpayOrderId !== razorpayOrderId) {
      const err = new Error('Razorpay order ID mismatch with internal order.');
      (err as any).status = 400;
      (err as any).code = 'RAZORPAY_ORDER_MISMATCH';
      throw err;
    }

    // 1. Cryptographic signature check (orderId|paymentId)
    const validSignature = await this.razorpayClient.verifyCheckoutSignature(
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature
    );

    const now = Date.now();
    const attempt = await this.storage.getPaymentAttemptByGatewayOrderId(razorpayOrderId);

    if (!validSignature) {
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'FAILED',
          errorMessage: 'Signature verification failed',
          signature: razorpaySignature,
          gatewayPaymentId: razorpayPaymentId
        });
      }
      await this.logAudit('ORDER', order.id, 'PAYMENT_SIGNATURE_FAILED', order.customer.email, {
        razorpayOrderId,
        razorpayPaymentId
      });
      const err = new Error('Cryptographic signature verification failed.');
      (err as any).status = 400;
      (err as any).code = 'INVALID_PAYMENT_SIGNATURE';
      throw err;
    }

    // 2. Query server-side Razorpay API for official payment details and capture status
    let paymentDetails;
    try {
      paymentDetails = await this.razorpayClient.fetchPayment(razorpayPaymentId);
    } catch (fetchErr: any) {
      // Gateway API timeout or network error: record authorization but keep order in pending state!
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'AUTHORIZED',
          signature: razorpaySignature,
          gatewayPaymentId: razorpayPaymentId,
          errorMessage: `Gateway verification pending: ${fetchErr.message}`
        });
      }
      await this.logAudit('ORDER', order.id, 'PAYMENT_GATEWAY_LOOKUP_DEFERRED', order.customer.email, {
        razorpayOrderId,
        razorpayPaymentId,
        reason: fetchErr.message
      });
      return {
        success: true,
        orderId: order.id,
        status: 'PENDING_PAYMENT',
        paymentId: razorpayPaymentId,
        captureStatus: 'pending',
        verifiedAt: now,
        message: 'Signature verified, but gateway capture lookup timed out. Awaiting webhook reconciliation.'
      };
    }

    // 3. Verify payment details match internal order records
    if (paymentDetails.order_id && paymentDetails.order_id !== razorpayOrderId) {
      const err = new Error(`Payment belongs to order '${paymentDetails.order_id}', expected '${razorpayOrderId}'.`);
      (err as any).status = 400;
      (err as any).code = 'RAZORPAY_ORDER_MISMATCH';
      throw err;
    }

    if (paymentDetails.currency && paymentDetails.currency !== 'INR') {
      const err = new Error(`Expected INR payment, received '${paymentDetails.currency}'.`);
      (err as any).status = 400;
      (err as any).code = 'INVALID_PAYMENT_CURRENCY';
      throw err;
    }

    const expectedSubunits = Math.round(order.total * 100);
    if (typeof paymentDetails.amount === 'number' && paymentDetails.amount !== expectedSubunits) {
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'FAILED',
          errorMessage: `Amount mismatch: expected ${expectedSubunits}, received ${paymentDetails.amount}`,
          gatewayPaymentId: razorpayPaymentId
        });
      }
      await this.logAudit('ORDER', order.id, 'PAYMENT_AMOUNT_MISMATCH_DETECTED', order.customer.email, {
        expectedSubunits,
        receivedSubunits: paymentDetails.amount
      });
      const err = new Error(
        `Payment amount (${paymentDetails.amount} paise) does not match required order total (${expectedSubunits} paise).`
      );
      (err as any).status = 400;
      (err as any).code = 'PAYMENT_AMOUNT_MISMATCH';
      throw err;
    }

    // 4. Branch on payment status: ONLY 'captured' triggers paid-order confirmation and final inventory allocation
    if (paymentDetails.status === 'captured') {
      await this.storage.updateOrderStatus(order.id, 'PAYMENT_CONFIRMED', {
        razorpayOrderId,
        razorpayPaymentId,
        paymentConfirmedAt: now
      });

      // Finalize inventory: permanently set in_stock = 0 and clear reservation
      await this.storage.finalizeInventoryForOrder(order.id);

      // Update payment attempt to CAPTURED
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'CAPTURED',
          signature: razorpaySignature,
          gatewayPaymentId: razorpayPaymentId,
          amountSubunits: paymentDetails.amount || expectedSubunits
        });
      }

      await this.logAudit('ORDER', order.id, 'PAYMENT_CONFIRMED', order.customer.email, {
        razorpayOrderId,
        razorpayPaymentId,
        total: order.total
      });

      return {
        success: true,
        orderId: order.id,
        status: 'PAYMENT_CONFIRMED',
        paymentId: razorpayPaymentId,
        captureStatus: 'captured',
        verifiedAt: now,
        message: 'Payment successfully captured and order confirmed.'
      };
    } else if (paymentDetails.status === 'authorized') {
      // Payment is AUTHORIZED but not yet captured!
      // Keep order in PENDING_PAYMENT. Do NOT finalize inventory. Keep inventory reserved.
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'AUTHORIZED',
          signature: razorpaySignature,
          gatewayPaymentId: razorpayPaymentId,
          amountSubunits: paymentDetails.amount || expectedSubunits
        });
      }

      await this.logAudit('ORDER', order.id, 'PAYMENT_AUTHORIZED_PENDING_CAPTURE', order.customer.email, {
        razorpayOrderId,
        razorpayPaymentId
      });

      return {
        success: true,
        orderId: order.id,
        status: 'PENDING_PAYMENT',
        paymentId: razorpayPaymentId,
        captureStatus: 'authorized',
        verifiedAt: now,
        message: 'Payment authorized; capture confirmation is pending. Order will be confirmed upon captured webhook.'
      };
    } else {
      // Payment failed or cancelled at gateway
      if (attempt) {
        await this.storage.updatePaymentAttempt(attempt.id, {
          status: 'FAILED',
          signature: razorpaySignature,
          gatewayPaymentId: razorpayPaymentId,
          errorMessage: paymentDetails.error_description || `Payment status is '${paymentDetails.status}'`
        });
      }

      // Release reserved inventory
      await this.storage.releaseInventoryForOrder(order.id);

      await this.logAudit('ORDER', order.id, 'PAYMENT_FAILED_AT_GATEWAY', order.customer.email, {
        razorpayOrderId,
        razorpayPaymentId,
        status: paymentDetails.status
      });

      const err = new Error(`Payment verification failed: payment status is '${paymentDetails.status}'.`);
      (err as any).status = 400;
      (err as any).code = 'PAYMENT_NOT_CAPTURED';
      throw err;
    }
  }

  public async processWebhook(
    rawBody: string,
    signature: string | null
  ): Promise<WebhookProcessingResult> {
    if (!signature) {
      const err = new Error('Missing Razorpay webhook signature header.');
      (err as any).status = 400;
      (err as any).code = 'MISSING_WEBHOOK_SIGNATURE';
      throw err;
    }

    // Verify raw body signature with webhook secret
    const isValid = await this.razorpayClient.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      const err = new Error('Razorpay webhook signature verification failed.');
      (err as any).status = 401;
      (err as any).code = 'INVALID_WEBHOOK_SIGNATURE';
      throw err;
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      const err = new Error('Malformed webhook JSON payload.');
      (err as any).status = 400;
      (err as any).code = 'MALFORMED_WEBHOOK_PAYLOAD';
      throw err;
    }

    const eventType = String(event.event || '');
    // Derive stable eventId from payload
    const eventId = String(
      event.event_id ||
      event.id ||
      (event.payload?.payment?.entity?.id ? `${eventType}_${event.payload.payment.entity.id}` : '') ||
      (event.payload?.order?.entity?.id ? `${eventType}_${event.payload.order.entity.id}` : '') ||
      `evt_${crypto.randomUUID()}`
    );

    // Deduplication check
    const existing = await this.storage.getWebhookEventByEventId(eventId);
    if (existing) {
      return {
        success: true,
        eventId,
        eventType,
        status: existing.status,
        message: 'Duplicate webhook event already processed.'
      };
    }

    const now = Date.now();
    const webhookRecord: WebhookEventRecord = {
      id: `whk_${crypto.randomUUID()}`,
      eventId,
      eventType,
      payloadJson: rawBody,
      status: 'RECEIVED',
      createdAt: now
    };
    await this.storage.saveWebhookEvent(webhookRecord);

    try {
      if (eventType === 'payment.captured' || eventType === 'order.paid') {
        const paymentEntity = event.payload?.payment?.entity;
        const razorpayOrderId = paymentEntity?.order_id || event.payload?.order?.entity?.id;
        const razorpayPaymentId = paymentEntity?.id;
        const capturedAmountSubunits = paymentEntity?.amount;

        if (razorpayOrderId) {
          const order = await this.storage.getOrderByRazorpayOrderId(razorpayOrderId);
          if (order) {
            const expectedSubunits = Math.round(order.total * 100);
            const capturedCurrency = paymentEntity?.currency || 'INR';

            if (capturedCurrency !== 'INR') {
              await this.storage.updateWebhookEventStatus(
                eventId,
                'FAILED',
                `Payment currency mismatch: received ${capturedCurrency}, expected INR`
              );
              await this.logAudit('ORDER', order.id, 'WEBHOOK_CURRENCY_MISMATCH_DETECTED', 'Razorpay Webhook', {
                capturedCurrency,
                expectedCurrency: 'INR'
              });
              return { success: false, eventId, eventType, status: 'FAILED', message: 'Currency mismatch' };
            }

            if (typeof capturedAmountSubunits === 'number' && capturedAmountSubunits !== expectedSubunits) {
              // Tampering or amount mismatch detected!
              await this.storage.updateWebhookEventStatus(
                eventId,
                'FAILED',
                `Payment amount mismatch: received ${capturedAmountSubunits}, expected ${expectedSubunits}`
              );
              await this.logAudit('ORDER', order.id, 'WEBHOOK_AMOUNT_TAMPERING_DETECTED', 'Razorpay Webhook', {
                capturedAmountSubunits,
                expectedSubunits
              });
              return { success: false, eventId, eventType, status: 'FAILED', message: 'Amount tampering or mismatch detected' };
            }

            if (order.status !== 'PAYMENT_CONFIRMED') {
              await this.storage.updateOrderStatus(order.id, 'PAYMENT_CONFIRMED', {
                razorpayOrderId,
                razorpayPaymentId: razorpayPaymentId || order.razorpayPaymentId,
                paymentConfirmedAt: now
              });
              await this.storage.finalizeInventoryForOrder(order.id);

              const attempt = await this.storage.getPaymentAttemptByGatewayOrderId(razorpayOrderId);
              if (attempt) {
                await this.storage.updatePaymentAttempt(attempt.id, {
                  status: 'CAPTURED',
                  gatewayPaymentId: razorpayPaymentId || attempt.gatewayPaymentId
                });
              }

              await this.logAudit('ORDER', order.id, 'PAYMENT_CONFIRMED_VIA_WEBHOOK', 'Razorpay Webhook', {
                eventId,
                razorpayOrderId,
                razorpayPaymentId
              });
            }
          }
        }
      } else if (eventType === 'payment.failed') {
        const paymentEntity = event.payload?.payment?.entity;
        const razorpayOrderId = paymentEntity?.order_id;
        const failureReason = paymentEntity?.error_description || 'Payment failed';

        if (razorpayOrderId) {
          const order = await this.storage.getOrderByRazorpayOrderId(razorpayOrderId);
          // Crucial safety rule: Never revert an already PAYMENT_CONFIRMED order!
          if (order && order.status !== 'PAYMENT_CONFIRMED') {
            await this.storage.releaseInventoryForOrder(order.id);
            const attempt = await this.storage.getPaymentAttemptByGatewayOrderId(razorpayOrderId);
            if (attempt) {
              await this.storage.updatePaymentAttempt(attempt.id, {
                status: 'FAILED',
                errorMessage: failureReason
              });
            }
            await this.logAudit('ORDER', order.id, 'PAYMENT_FAILED_VIA_WEBHOOK', 'Razorpay Webhook', {
              eventId,
              failureReason
            });
          }
        }
      }

      await this.storage.updateWebhookEventStatus(eventId, 'PROCESSED');
      return {
        success: true,
        eventId,
        eventType,
        status: 'PROCESSED'
      };
    } catch (err: any) {
      await this.storage.updateWebhookEventStatus(eventId, 'FAILED', err.message);
      throw err;
    }
  }

  // ==========================================
  // OWNER AUTHENTICATION ASSERTION
  // ==========================================

  private assertOwner(secret: string): void {
    if (!secret || !timingSafeEqual(secret, this.ownerSecret)) {
      const err = new Error('Unauthorized');
      (err as any).status = 401;
      (err as any).code = 'OWNER_AUTH_REQUIRED';
      throw err;
    }
  }
}
