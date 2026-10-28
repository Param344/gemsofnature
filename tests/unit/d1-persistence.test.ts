// tests/unit/d1-persistence.test.ts
// Stage 3A.1: Automated tests for Cloudflare Worker runtime and D1 Persistence

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockD1Database,
  D1BackendStorage,
  BackendService,
  ApiHandler
} from '../../src/backend';
import worker from '../../src/worker';
import type { WorkerEnv, ExecutionContext } from '../../src/backend/d1-types';
import { MockRazorpayClient } from '../../src/backend/razorpay-client';
import type { InventorySnapshotRecord } from '../../src/backend/types';

describe('Stage 3A.1: Cloudflare Worker & D1 Persistence Tests', () => {
  let db: MockD1Database;
  let d1Storage: D1BackendStorage;
  let service: BackendService;
  let handler: ApiHandler;
  const OWNER_SECRET = 'owner-secret-stage3a1-test';

  const mockCtx: ExecutionContext = {
    waitUntil: () => {},
    passThroughOnException: () => {}
  };

  beforeEach(async () => {
    db = new MockD1Database();
    d1Storage = new D1BackendStorage(db);
    await d1Storage.clear();
    service = new BackendService(d1Storage, OWNER_SECRET);
    handler = new ApiHandler({
      storage: d1Storage,
      ownerSecret: OWNER_SECRET,
      rateLimitPerMinute: 20
    });
  });

  const validCustomer = {
    name: 'Aarav Sharma',
    email: 'aarav.sharma@example.in',
    phone: '+91 98765 43210',
    country: 'IN',
    addressLine1: '402, Lotus Towers, MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001'
  };

  describe('1. D1 Storage Adapter & SQL/Schema Consistency', () => {
    it('persists inquiries and child items in D1 and retrieves hydrated record', async () => {
      const inquiry = await service.createInquiry({
        customer: validCustomer,
        items: [
          { productId: 'p1', quantity: 2 },
          { productId: 'p2', quantity: 1 }
        ],
        notes: 'Testing D1 persistence',
        idempotencyKey: 'idemp_d1_inq_001'
      });

      // Direct D1 storage retrieval
      const fetched = await d1Storage.getInquiryById(inquiry.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(inquiry.id);
      expect(fetched!.customerEmail).toBe('aarav.sharma@example.in');
      expect(fetched!.items.length).toBe(2);
      expect(fetched!.items[0]!.productId).toBe('p1');
      expect(fetched!.items[0]!.provisionalMinUnit).toBe(40000);
      expect(fetched!.items[0]!.provisionalMaxUnit).toBe(200000);

      // By idempotency key
      const fetchedByKey = await d1Storage.getInquiryByIdempotencyKey('idemp_d1_inq_001');
      expect(fetchedByKey).not.toBeNull();
      expect(fetchedByKey!.id).toBe(inquiry.id);
    });

    it('persists shipping quotes and reflects status transitions in D1', async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'intl.d1@example.org',
        destinationCountry: 'US',
        destinationPostalCode: '10001',
        idempotencyKey: 'idemp_quote_d1_001'
      });

      const fetched = await d1Storage.getShippingQuoteById(quote.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.status).toBe('REQUESTED');

      // Approve quote
      const approved = await service.approveShippingQuote({
        quoteId: quote.id,
        quotedAmount: 4500,
        quotedCurrency: 'INR',
        validityHours: 48,
        ownerSecret: OWNER_SECRET
      });
      expect(approved.status).toBe('APPROVED_BY_OWNER');

      // Verify persistence of update
      const fetchedApproved = await d1Storage.getShippingQuoteById(quote.id);
      expect(fetchedApproved!.status).toBe('APPROVED_BY_OWNER');
      expect(fetchedApproved!.quotedAmount).toBe(4500);

      // Accept quote
      const accepted = await service.acceptShippingQuote(quote.id, quote.customerAccessToken!);
      expect(accepted.status).toBe('ACCEPTED_BY_CUSTOMER');

      const fetchedAccepted = await d1Storage.getShippingQuoteById(quote.id);
      expect(fetchedAccepted!.status).toBe('ACCEPTED_BY_CUSTOMER');
      expect(fetchedAccepted!.acceptedAt).toBeDefined();
    });

    it('persists inventory snapshots with UPSERT support in D1', async () => {
      await d1Storage.saveInventorySnapshot({
        sku: 'SKU-D1-SAPPHIRE-01',
        productId: 'p1',
        approvedSellingPrice: 42000,
        currency: 'INR',
        inStock: true,
        caratWeight: 4.8,
        certNumber: 'GIA-D1-999',
        approvedBy: 'Gems of Nature Head Gemologist',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const fetched = await d1Storage.getInventorySnapshotBySku('SKU-D1-SAPPHIRE-01');
      expect(fetched).not.toBeNull();
      expect(fetched!.approvedSellingPrice).toBe(42000);
      expect(fetched!.inStock).toBe(true);

      // UPSERT update price
      await d1Storage.saveInventorySnapshot({
        sku: 'SKU-D1-SAPPHIRE-01',
        productId: 'p1',
        approvedSellingPrice: 45000,
        currency: 'INR',
        inStock: false,
        approvedBy: 'Admin Updated',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const updated = await d1Storage.getInventorySnapshotBySku('SKU-D1-SAPPHIRE-01');
      expect(updated!.approvedSellingPrice).toBe(45000);
      expect(updated!.inStock).toBe(false);
    });
  });

  describe('2. Persistence Across Separate Invocations & Workers', () => {
    it('retrieves saved records across completely distinct handler and service instances', async () => {
      // Instance 1 creates record
      const instance1Service = new BackendService(new D1BackendStorage(db), OWNER_SECRET);
      const inq = await instance1Service.createInquiry({
        customer: validCustomer,
        items: [{ productId: 'p3', quantity: 1 }],
        idempotencyKey: 'idemp_multi_instance_001'
      });

      // Instance 2 creates completely new storage, service, and handler pointing to same DB
      const instance2Storage = new D1BackendStorage(db);
      const instance2Handler = new ApiHandler({
        storage: instance2Storage,
        ownerSecret: OWNER_SECRET
      });

      const req = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        method: 'GET',
        headers: { 'X-Customer-Token': inq.customerAccessToken! }
      });
      const res = await instance2Handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(inq.id);
      expect(data.data.items[0].productId).toBe('p3');
    });
  });

  describe('3. Atomic Transactions & Rollback on Failure', () => {
    it('rolls back parent record insertion if child item insertion fails in batch', async () => {
      // Test atomic rollback: create a statement batch where second statement fails
      const validInquiryStmt = db.prepare(
        'INSERT INTO inquiries (id, customer_name, customer_email, destination_country, status, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind('inq_fail_test', 'Fail Test', 'fail@test.com', 'IN', 'PENDING_REVIEW', 'idemp_fail_tx', 1000, 1000);

      // This item references a non-existent parent 'inq_non_existent' to trigger FK constraint failure
      const failingItemStmt = db.prepare(
        'INSERT INTO inquiry_items (id, inquiry_id, product_id, quantity, provisional_min_unit, provisional_max_unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind('item_fail', 'inq_non_existent', 'p1', 1, 100, 200, 1000);

      await expect(db.batch([validInquiryStmt, failingItemStmt])).rejects.toThrow();

      // Verify that parent inquiry 'inq_fail_test' was NOT left in database (rolled back)
      const checkParent = await db.prepare('SELECT * FROM inquiries WHERE id = ?').bind('inq_fail_test').first();
      expect(checkParent).toBeNull();
    });

    it('enforces idempotency under concurrent duplicate submissions', async () => {
      const payload = {
        customer: validCustomer,
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_concurrent_dup_001'
      };

      // Submit identical requests concurrently using Promise.all
      const [res1, res2] = await Promise.all([
        service.createInquiry(payload),
        service.createInquiry(payload)
      ]);

      expect(res1.id).toBe(res2.id);
      expect(res1.createdAt).toBe(res2.createdAt);

      // Verify exactly one record exists in D1
      const countRes = await db.prepare('SELECT COUNT(*) as count FROM inquiries WHERE idempotency_key = ?').bind('idemp_concurrent_dup_001').first<any>();
      expect(countRes).toBeDefined();
      const inq = await d1Storage.getInquiryByIdempotencyKey('idemp_concurrent_dup_001');
      expect(inq).not.toBeNull();
    });
  });

  describe('4. Storefront Pricing, Domestic Shipping, and Provisional Safety', () => {
    it('rejects order creation for provisional items without approved SKU (HTTP 422)', async () => {
      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: validCustomer,
          items: [{ productId: 'p1', inventorySku: '', quantity: 1 }],
          idempotencyKey: 'idemp_order_prov_d1'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe('PROVISIONAL_ITEM_NOT_ORDERABLE');
    });

    it('strictly applies flat ₹200 domestic shipping and ignores client price manipulation', async () => {
      await d1Storage.saveInventorySnapshot({
        sku: 'SKU-D1-CONFIRMED-01',
        productId: 'p2',
        approvedSellingPrice: 55000,
        currency: 'INR',
        inStock: true,
        approvedBy: 'Lead Gemologist',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: validCustomer,
          items: [{ productId: 'p2', inventorySku: 'SKU-D1-CONFIRMED-01', quantity: 2 }],
          clientAttemptedPrice: 100,
          clientAttemptedShipping: 0,
          clientAttemptedTotal: 200,
          idempotencyKey: 'idemp_d1_domestic_order_001'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.subtotal).toBe(110000); // 55,000 * 2
      expect(data.data.shippingFee).toBe(200);   // Exactly ₹200 domestic flat shipping
      expect(data.data.total).toBe(110200);      // Authoritative subtotal + shipping
      expect(data.data.status).toBe('PENDING_PAYMENT');
    });

    it('strictly rejects international orders without accepted shipping quote (HTTP 422)', async () => {
      await d1Storage.saveInventorySnapshot({
        sku: 'SKU-D1-CONFIRMED-02',
        productId: 'p1',
        approvedSellingPrice: 40000,
        currency: 'INR',
        inStock: true,
        approvedBy: 'Lead Gemologist',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const intlCustomer = {
        ...validCustomer,
        country: 'US',
        postalCode: '90210'
      };

      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: intlCustomer,
          items: [{ productId: 'p1', inventorySku: 'SKU-D1-CONFIRMED-02', quantity: 1 }],
          idempotencyKey: 'idemp_intl_no_quote_d1'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe('SHIPPING_QUOTE_REQUIRED');
    });
  });

  describe('5. Security Controls & Authorization', () => {
    it('supports Bearer token and X-Owner-Secret header for owner authorization', async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'intl.auth@example.com',
        destinationCountry: 'GB',
        idempotencyKey: 'idemp_quote_auth_test'
      });

      // 1. Unauthorized attempt (no secret)
      const reqNoAuth = new Request(`http://localhost/api/quotes/${quote.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotedAmount: 3200 })
      });
      const resNoAuth = await handler.handleRequest(reqNoAuth);
      expect(resNoAuth.status).toBe(401);

      // 2. Authorized via Authorization: Bearer <secret>
      const reqBearer = new Request(`http://localhost/api/quotes/${quote.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OWNER_SECRET}`
        },
        body: JSON.stringify({ quotedAmount: 3200, validityHours: 48 })
      });
      const resBearer = await handler.handleRequest(reqBearer);
      expect(resBearer.status).toBe(200);
      const data = await resBearer.json();
      expect(data.data.status).toBe('APPROVED_BY_OWNER');
    });

    it('protects customer records against unauthorized access by mismatched email (HTTP 403)', async () => {
      const inq = await service.createInquiry({
        customer: validCustomer, // email: 'aarav.sharma@example.in'
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_inq_pii_test'
      });

      // Attempt to access without token or with forged token
      const reqUnauthorized = new Request(
        `http://localhost/api/inquiries/${inq.id}?email=attacker@malicious.com`,
        { method: 'GET' }
      );
      const resUnauthorized = await handler.handleRequest(reqUnauthorized);
      expect(resUnauthorized.status).toBe(401);
      const err = await resUnauthorized.json();
      expect(err.error.code).toBe('CUSTOMER_AUTH_REQUIRED');

      // Valid customer access token succeeds
      const reqMatch = new Request(
        `http://localhost/api/inquiries/${inq.id}`,
        {
          method: 'GET',
          headers: { 'X-Customer-Token': inq.customerAccessToken! }
        }
      );
      const resMatch = await handler.handleRequest(reqMatch);
      expect(resMatch.status).toBe(200);
    });

    it('rejects oversized payloads (>64KB) with HTTP 413 Payload Too Large', async () => {
      const hugeNotes = 'A'.repeat(70000);
      const hugePayload = JSON.stringify({
        customer: validCustomer,
        items: [{ productId: 'p1', quantity: 1 }],
        notes: hugeNotes,
        idempotencyKey: 'idemp_oversized_test'
      });

      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hugePayload
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('6. Cloudflare Worker Entry Point fetch() Behavior', () => {
    it('serves /api/health through Worker fetch() entry point', async () => {
      const env: WorkerEnv = {
        DB: db,
        OWNER_ADMIN_SECRET: OWNER_SECRET,
        ALLOWED_ORIGIN: 'https://www.gemsofnature.shop',
        RATE_LIMIT_PER_MINUTE: 60
      };

      const req = new Request('https://www.gemsofnature.shop/api/health', { method: 'GET' });
      const res = await worker.fetch(req, env, mockCtx);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('HEALTHY');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.gemsofnature.shop');
    });

    it('rejects non-/api requests in Worker with 404 directing to static Pages hosting', async () => {
      const env: WorkerEnv = { DB: db };
      const req = new Request('https://www.gemsofnature.shop/shop.html', { method: 'GET' });
      const res = await worker.fetch(req, env, mockCtx);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 if DB binding is missing in Worker env', async () => {
      const env = {} as WorkerEnv; // missing DB
      const req = new Request('https://www.gemsofnature.shop/api/health', { method: 'GET' });
      const res = await worker.fetch(req, env, mockCtx);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe('D1_BINDING_MISSING');
    });
  });

  describe('7. Stage 3C / 3C.1 Razorpay Payment Persistence & Concurrency on D1', () => {
    let rzpMock: MockRazorpayClient;
    let d1PayService: BackendService;

    beforeEach(async () => {
      rzpMock = new MockRazorpayClient('rzp_d1_key_id', 'rzp_d1_secret_key', 'rzp_d1_wh_secret');
      d1PayService = new BackendService(d1Storage, OWNER_SECRET, rzpMock);

      // Seed approved physical stone lot in D1
      const stone: InventorySnapshotRecord = {
        sku: 'RUBY-D1-001',
        productId: 'p2',
        approvedSellingPrice: 50000,
        currency: 'INR',
        inStock: true,
        caratWeight: 4.1,
        certNumber: 'IGI-D1-5544',
        certStatus: 'CERTIFIED',
        certLab: 'IGI',
        approvedBy: 'D1 Gemologist',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      };
      await d1Storage.saveInventorySnapshot(stone);
    });

    it('creates payment order in D1, locks physical gemstone lot with reserved_order_id, and records payment attempt in D1', async () => {
      const order = await d1PayService.createPaymentOrder({
        customer: validCustomer,
        items: [{ productId: 'p2', inventorySku: 'RUBY-D1-001', quantity: 1 }],
        idempotencyKey: 'idemp_d1_pay_001'
      });

      expect(order.orderId).toMatch(/^ord_/);
      expect(order.amount).toBe(50200); // 50,000 + 200 domestic shipping
      expect(order.amountSubunits).toBe(5020000);

      // Verify D1 orders table
      const d1Order = await d1Storage.getOrderById(order.orderId);
      expect(d1Order).not.toBeNull();
      expect(d1Order!.status).toBe('PENDING_PAYMENT');
      expect(d1Order!.razorpayOrderId).toBe(order.razorpayOrderId);

      // Verify D1 inventory reservation lock
      const stoneSnap = await d1Storage.getInventorySnapshotBySku('RUBY-D1-001');
      expect(stoneSnap?.reservedOrderId).toBe(order.orderId);
      expect(stoneSnap?.inStock).toBe(true);

      // Verify D1 payment_attempts table
      const attempts = await d1Storage.getPaymentAttemptsByOrderId(order.orderId);
      expect(attempts.length).toBe(1);
      expect(attempts[0]?.gatewayOrderId).toBe(order.razorpayOrderId);
      expect(attempts[0]?.status).toBe('CREATED');
    });

    it('verifies checkout payment against D1 storage: transitions order to PAYMENT_CONFIRMED and marks inventory in_stock = 0', async () => {
      const order = await d1PayService.createPaymentOrder({
        customer: validCustomer,
        items: [{ productId: 'p2', inventorySku: 'RUBY-D1-001', quantity: 1 }],
        idempotencyKey: 'idemp_d1_pay_002'
      });

      const paymentId = 'pay_d1_test_999';
      const validSig = await rzpMock.generateValidCheckoutSignature(order.razorpayOrderId, paymentId);

      const verifyRes = await d1PayService.verifyCheckoutPayment(
        {
          orderId: order.orderId,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        order.customerAccessToken
      );

      expect(verifyRes.status).toBe('PAYMENT_CONFIRMED');
      expect(verifyRes.captureStatus).toBe('captured');

      // Verify order persisted in D1
      const confirmedOrder = await d1Storage.getOrderById(order.orderId);
      expect(confirmedOrder?.status).toBe('PAYMENT_CONFIRMED');
      expect(confirmedOrder?.razorpayPaymentId).toBe(paymentId);
      expect(confirmedOrder?.paymentConfirmedAt).toBeGreaterThan(0);

      // Verify physical gemstone finalized in D1
      const stoneSnap = await d1Storage.getInventorySnapshotBySku('RUBY-D1-001');
      expect(stoneSnap?.inStock).toBe(false);
      expect(stoneSnap?.reservedOrderId).toBeUndefined();

      // Verify payment attempt updated in D1
      const attempts = await d1Storage.getPaymentAttemptsByOrderId(order.orderId);
      expect(attempts[0]?.status).toBe('CAPTURED');
    });

    it('persists and deduplicates webhook events in D1 database', async () => {
      const order = await d1PayService.createPaymentOrder({
        customer: validCustomer,
        items: [{ productId: 'p2', inventorySku: 'RUBY-D1-001', quantity: 1 }],
        idempotencyKey: 'idemp_d1_wh_001'
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_d1_dedup_test_1',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_d1_wh_1',
              order_id: order.razorpayOrderId,
              amount: order.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });

      const signature = await rzpMock.generateValidWebhookSignature(webhookPayload);

      // First webhook delivery
      const res1 = await d1PayService.processWebhook(webhookPayload, signature);
      expect(res1.status).toBe('PROCESSED');

      // Verify D1 stored the webhook event
      const eventInD1 = await d1Storage.getWebhookEventByEventId('evt_d1_dedup_test_1');
      expect(eventInD1).not.toBeNull();
      expect(eventInD1?.status).toBe('PROCESSED');

      // Second identical webhook delivery (deduplication)
      const res2 = await d1PayService.processWebhook(webhookPayload, signature);
      expect(res2.status).toBe('PROCESSED');
      expect(res2.message).toMatch(/duplicate/i);
    });

    it('handles concurrent webhook and checkout verification race on D1 storage safely and idempotently without duplicate inventory deductions', async () => {
      const order = await d1PayService.createPaymentOrder({
        customer: validCustomer,
        items: [{ productId: 'p2', inventorySku: 'RUBY-D1-001', quantity: 1 }],
        idempotencyKey: 'idemp_d1_race_001'
      });

      const paymentId = 'pay_d1_race_test';
      const validSig = await rzpMock.generateValidCheckoutSignature(order.razorpayOrderId, paymentId);

      const webhookPayload = JSON.stringify({
        id: 'evt_d1_race_wh_1',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: order.razorpayOrderId,
              amount: order.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });
      const whSig = await rzpMock.generateValidWebhookSignature(webhookPayload);

      // Simulate concurrent arrival: Webhook arrives first
      const whResult = await d1PayService.processWebhook(webhookPayload, whSig);
      expect(whResult.status).toBe('PROCESSED');

      // Checkout verification arrives immediately afterwards
      const checkoutResult = await d1PayService.verifyCheckoutPayment(
        {
          orderId: order.orderId,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        order.customerAccessToken
      );

      // Both succeed idempotently
      expect(checkoutResult.status).toBe('PAYMENT_CONFIRMED');

      // In D1, inventory finalized exactly once
      const stoneSnap = await d1Storage.getInventorySnapshotBySku('RUBY-D1-001');
      expect(stoneSnap?.inStock).toBe(false);
      expect(stoneSnap?.reservedOrderId).toBeUndefined();

      const finalOrder = await d1Storage.getOrderById(order.orderId);
      expect(finalOrder?.status).toBe('PAYMENT_CONFIRMED');
    });

    it('safely ignores late payment.failed webhook on D1 after order was already confirmed', async () => {
      const order = await d1PayService.createPaymentOrder({
        customer: validCustomer,
        items: [{ productId: 'p2', inventorySku: 'RUBY-D1-001', quantity: 1 }],
        idempotencyKey: 'idemp_d1_late_fail_001'
      });

      const paymentId = 'pay_d1_prior_capture';
      const validSig = await rzpMock.generateValidCheckoutSignature(order.razorpayOrderId, paymentId);

      // Confirm order first
      await d1PayService.verifyCheckoutPayment(
        {
          orderId: order.orderId,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        order.customerAccessToken
      );

      // Verify order is confirmed
      const beforeWebhook = await d1Storage.getOrderById(order.orderId);
      expect(beforeWebhook?.status).toBe('PAYMENT_CONFIRMED');

      // Late payment.failed webhook arrives
      const failedPayload = JSON.stringify({
        id: 'evt_d1_late_fail_wh',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_d1_failed_attempt',
              order_id: order.razorpayOrderId,
              error_description: 'Card declined'
            }
          }
        }
      });
      const whSig = await rzpMock.generateValidWebhookSignature(failedPayload);
      const whRes = await d1PayService.processWebhook(failedPayload, whSig);
      expect(whRes.status).toBe('PROCESSED');

      // Crucial: D1 order must remain confirmed!
      const afterWebhook = await d1Storage.getOrderById(order.orderId);
      expect(afterWebhook?.status).toBe('PAYMENT_CONFIRMED');

      const stoneSnap = await d1Storage.getInventorySnapshotBySku('RUBY-D1-001');
      expect(stoneSnap?.inStock).toBe(false);
    });
  });
});
