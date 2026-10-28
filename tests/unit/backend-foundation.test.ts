// tests/unit/backend-foundation.test.ts
// Stage 3A: Unit and Integration tests for Secure Backend Foundation

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryBackendStorage,
  BackendService,
  ApiHandler
} from '../../src/backend';

describe('Stage 3A: Backend Foundation Tests', () => {
  let storage: MemoryBackendStorage;
  let service: BackendService;
  let handler: ApiHandler;
  const OWNER_SECRET = 'stage3a-secret-test';

  beforeEach(async () => {
    storage = new MemoryBackendStorage();
    await storage.clear();
    service = new BackendService(storage, OWNER_SECRET);
    handler = new ApiHandler({
      storage,
      ownerSecret: OWNER_SECRET,
      rateLimitPerMinute: 20
    });
  });

  describe('1. Health Check & HTTP Infrastructure', () => {
    it('returns 200 OK with health status on GET /api/health', async () => {
      const req = new Request('http://localhost/api/health', { method: 'GET' });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('HEALTHY');
      expect(data.data.version).toMatch(/^3[A-Z]\.0$/);
    });

    it('returns 204 No Content for CORS preflight OPTIONS request', async () => {
      const req = new Request('http://localhost/api/inquiries', { method: 'OPTIONS' });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('returns 404 for unknown endpoints', async () => {
      const req = new Request('http://localhost/api/unknown-endpoint', { method: 'GET' });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('enforces rate limiting when limit exceeded', async () => {
      const ip = '192.168.1.100';
      // Rate limit is set to 20 for this test handler
      for (let i = 0; i < 20; i++) {
        const req = new Request('http://localhost/api/health', { method: 'GET' });
        const res = await handler.handleRequest(req, ip);
        expect(res.status).toBe(200);
      }
      // 21st request should be blocked
      const blockedReq = new Request('http://localhost/api/health', { method: 'GET' });
      const blockedRes = await handler.handleRequest(blockedReq, ip);
      expect(blockedRes.status).toBe(429);
      const data = await blockedRes.json();
      expect(data.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('2. Inquiries & Server-Side Catalogue Validation', () => {
    const validInquiryPayload = {
      customer: {
        name: 'Aarav Sharma',
        email: 'aarav@example.com',
        phone: '+91 98765 43210',
        country: 'IN'
      },
      items: [
        { productId: 'p1', quantity: 2 },
        { productId: 'p5', quantity: 1 }
      ],
      notes: 'Please confirm 5+ carat yellow sapphire availability with lab cert.',
      idempotencyKey: 'idemp_inq_aarav_001'
    };

    it('successfully creates an inquiry and snapshots provisional bounds', async () => {
      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInquiryPayload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toMatch(/^inq_[a-f0-9-]+$/);
      expect(data.data.status).toBe('PENDING_REVIEW');
      expect(data.data.items.length).toBe(2);

      // p1 bounds snapshot check
      const itemP1 = data.data.items.find((it: any) => it.productId === 'p1');
      expect(itemP1.provisionalMinUnit).toBe(40000);
      expect(itemP1.provisionalMaxUnit).toBe(200000);
      expect(itemP1.quantity).toBe(2);
    });

    it('retrieves an existing inquiry by ID', async () => {
      const inquiry = await service.createInquiry(validInquiryPayload);
      const req = new Request(`http://localhost/api/inquiries/${inquiry.id}`, {
        method: 'GET',
        headers: { 'X-Customer-Token': inquiry.customerAccessToken! }
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(inquiry.id);
      expect(data.data.customerEmail).toBe('aarav@example.com');
    });

    it('returns 404 for non-existent inquiry ID', async () => {
      const req = new Request('http://localhost/api/inquiries/inq_does_not_exist', { method: 'GET' });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('INQUIRY_NOT_FOUND');
    });

    it('enforces idempotency on duplicate inquiry submissions', async () => {
      const inq1 = await service.createInquiry(validInquiryPayload);
      const inq2 = await service.createInquiry(validInquiryPayload);
      expect(inq1.id).toBe(inq2.id);
      expect(inq1.createdAt).toBe(inq2.createdAt);
    });

    it('strictly rejects unknown product IDs', async () => {
      const payload = {
        ...validInquiryPayload,
        idempotencyKey: 'idemp_inq_unknown_002',
        items: [{ productId: 'fake_product_999', quantity: 1 }]
      };
      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.details.some((d: any) => d.code === 'UNKNOWN_PRODUCT')).toBe(true);
    });

    it('strictly rejects metadata-only product IDs: p127, p128, p129, p135', async () => {
      for (const metaId of ['p127', 'p128', 'p129', 'p135']) {
        const payload = {
          ...validInquiryPayload,
          idempotencyKey: `idemp_meta_${metaId}`,
          items: [{ productId: metaId, quantity: 1 }]
        };
        const req = new Request('http://localhost/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error.details.some((d: any) => d.code === 'METADATA_ONLY_PRODUCT')).toBe(true);
      }
    });

    it('rejects invalid quantities (0, negative, > 20, non-integers)', async () => {
      const invalidQuantities = [0, -5, 25, 2.5, 'five'];
      for (let i = 0; i < invalidQuantities.length; i++) {
        const payload = {
          ...validInquiryPayload,
          idempotencyKey: `idemp_qty_test_${i}`,
          items: [{ productId: 'p1', quantity: invalidQuantities[i] }]
        };
        const req = new Request('http://localhost/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(400);
      }
    });

    it('rejects malformed email and short customer name', async () => {
      const payload = {
        ...validInquiryPayload,
        customer: { name: 'A', email: 'invalid-email', country: 'IN' },
        idempotencyKey: 'idemp_invalid_cust_001'
      };
      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.details.some((d: any) => d.code === 'INVALID_NAME')).toBe(true);
      expect(data.error.details.some((d: any) => d.code === 'INVALID_EMAIL')).toBe(true);
    });

    it('rejects malformed JSON body', async () => {
      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ malformed json: true '
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe('MALFORMED_JSON');
    });
  });

  describe('3. International Shipping Quotes & Customer Acceptance Gating', () => {
    it('rejects domestic destinations from international quote request', async () => {
      const payload = {
        customerEmail: 'customer@india.com',
        destinationCountry: 'IN',
        idempotencyKey: 'idemp_intl_quote_in'
      };
      const req = new Request('http://localhost/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.details.some((d: any) => d.code === 'DOMESTIC_NOT_ELIGIBLE_FOR_INTERNATIONAL_QUOTE')).toBe(true);
    });

    it('creates an international shipping quote request in REQUESTED status', async () => {
      const payload = {
        customerEmail: 'intl.buyer@example.com',
        destinationCountry: 'US',
        destinationPostalCode: '94105',
        destinationAddress: '100 Market St, San Francisco, CA',
        idempotencyKey: 'idemp_intl_quote_us_001'
      };
      const req = new Request('http://localhost/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('REQUESTED');
      expect(data.data.destinationCountry).toBe('US');
    });

    it('requires owner secret to approve a quote', async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'buyer@london.co.uk',
        destinationCountry: 'GB',
        idempotencyKey: 'idemp_quote_gb_001'
      });

      // Wrong secret
      const reqWrong = new Request(`http://localhost/api/quotes/${quote.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotedAmount: 3500, ownerSecret: 'wrong-secret' })
      });
      const resWrong = await handler.handleRequest(reqWrong);
      expect(resWrong.status).toBe(401);

      // Correct secret
      const reqCorrect = new Request(`http://localhost/api/quotes/${quote.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotedAmount: 3500, ownerSecret: OWNER_SECRET, validityHours: 48 })
      });
      const resCorrect = await handler.handleRequest(reqCorrect);
      expect(resCorrect.status).toBe(200);
      const data = await resCorrect.json();
      expect(data.data.status).toBe('APPROVED_BY_OWNER');
      expect(data.data.quotedAmount).toBe(3500);
      expect(data.data.expiresAt).toBeGreaterThan(Date.now());
    });

    it('enforces customer token verification upon quote acceptance', async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'legit.buyer@dubai.ae',
        destinationCountry: 'AE',
        idempotencyKey: 'idemp_quote_ae_001'
      });
      await service.approveShippingQuote({
        quoteId: quote.id,
        quotedAmount: 2800,
        quotedCurrency: 'INR',
        validityHours: 72,
        ownerSecret: OWNER_SECRET
      });

      // Mismatched / invalid token
      const reqMismatch = new Request(`http://localhost/api/quotes/${quote.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerToken: 'invalid_token_123' })
      });
      const resMismatch = await handler.handleRequest(reqMismatch);
      expect(resMismatch.status).toBe(403);

      // Matching token
      const reqMatch = new Request(`http://localhost/api/quotes/${quote.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerToken: quote.customerAccessToken! })
      });
      const resMatch = await handler.handleRequest(reqMatch);
      expect(resMatch.status).toBe(200);
      const data = await resMatch.json();
      expect(data.data.status).toBe('ACCEPTED_BY_CUSTOMER');
      expect(data.data.acceptedAt).toBeDefined();
    });

    it('fails quote acceptance if quote has expired (status 410)', async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'expired@example.org',
        destinationCountry: 'DE',
        idempotencyKey: 'idemp_quote_de_expired'
      });
      // Approve with 0 validity (expires immediately in past)
      const approved = await service.approveShippingQuote({
        quoteId: quote.id,
        quotedAmount: 4000,
        quotedCurrency: 'INR',
        validityHours: 0,
        ownerSecret: OWNER_SECRET
      });
      // Force expiry timestamp into past
      await storage.updateShippingQuote({
        ...approved,
        expiresAt: Date.now() - 1000
      });

      const req = new Request(`http://localhost/api/quotes/${quote.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerToken: quote.customerAccessToken! })
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(410);
    });
  });

  describe('4. Order Creation, Domestic Policy, and Payment Gating', () => {
    const validDomesticCustomer = {
      name: 'Rohan Mehra',
      email: 'rohan.mehra@example.com',
      phone: '+91 91234 56789',
      country: 'IN',
      addressLine1: 'Flat 402, Lotus Towers, MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001'
    };

    it('fails closed when attempting to order provisional products without confirmed SKU (status 422)', async () => {
      const payload = {
        customer: validDomesticCustomer,
        items: [{ productId: 'p1', inventorySku: '', quantity: 1 }],
        idempotencyKey: 'idemp_order_provisional_fail'
      };
      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe('PROVISIONAL_ITEM_NOT_ORDERABLE');
    });

    it('fails closed when inventory SKU snapshot does not exist or is out of stock (status 422)', async () => {
      const payload = {
        customer: validDomesticCustomer,
        items: [{ productId: 'p1', inventorySku: 'SKU-NON-EXISTENT', quantity: 1 }],
        idempotencyKey: 'idemp_order_missing_sku'
      };
      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error.code).toBe('INVENTORY_NOT_AVAILABLE');
    });

    it('calculates authoritative totals and applies flat ₹200 domestic shipping for confirmed inventory', async () => {
      // Setup confirmed inventory snapshot
      await storage.saveInventorySnapshot({
        sku: 'SKU-PUKHRAJ-LOT-01',
        productId: 'p1',
        approvedSellingPrice: 48500,
        currency: 'INR',
        inStock: true,
        caratWeight: 5.25,
        certNumber: 'GIA-12345678',
        approvedBy: 'Gems of Nature Gemologist Admin',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const payload = {
        customer: validDomesticCustomer,
        items: [{ productId: 'p1', inventorySku: 'SKU-PUKHRAJ-LOT-01', quantity: 2 }],
        // Client attempts to manipulate price and shipping
        clientSuppliedSubtotal: 1000,
        clientSuppliedShipping: 0,
        clientSuppliedTotal: 1000,
        idempotencyKey: 'idemp_order_domestic_success_001'
      };

      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);

      const order = data.data;
      expect(order.subtotal).toBe(48500 * 2); // 97,000
      expect(order.shippingFee).toBe(200);   // Exactly ₹200 domestic flat shipping
      expect(order.total).toBe(97200);        // 97,000 + 200
      expect(order.status).toBe('PENDING_PAYMENT');
      expect(order.items[0].unitPrice).toBe(48500);
      expect(order.items[0].lineTotal).toBe(97000);
    });

    it('requires accepted international quote for international orders', async () => {
      await storage.saveInventorySnapshot({
        sku: 'SKU-RUBY-LOT-09',
        productId: 'p2',
        approvedSellingPrice: 65000,
        currency: 'INR',
        inStock: true,
        approvedBy: 'Gems of Nature Gemologist Admin',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const intlCustomer = {
        name: 'John Doe',
        email: 'john.doe@ny.us',
        phone: '+1 212 555 0199',
        country: 'US',
        addressLine1: '350 5th Ave',
        city: 'New York',
        state: 'NY',
        postalCode: '10118'
      };

      // Attempt order without quote ID
      const reqNoQuote = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: intlCustomer,
          items: [{ productId: 'p2', inventorySku: 'SKU-RUBY-LOT-09', quantity: 1 }],
          idempotencyKey: 'idemp_intl_order_no_quote'
        })
      });
      const resNoQuote = await handler.handleRequest(reqNoQuote);
      expect(resNoQuote.status).toBe(422);
      const errData = await resNoQuote.json();
      expect(errData.error.code).toBe('SHIPPING_QUOTE_REQUIRED');

      // Create, approve, and accept quote
      const quote = await service.createShippingQuote({
        customerEmail: 'john.doe@ny.us',
        destinationCountry: 'US',
        idempotencyKey: 'idemp_quote_john_us'
      });
      await service.approveShippingQuote({
        quoteId: quote.id,
        quotedAmount: 4200,
        quotedCurrency: 'INR',
        validityHours: 72,
        ownerSecret: OWNER_SECRET
      });
      await service.acceptShippingQuote(quote.id, quote.customerAccessToken!);

      // Attempt order with accepted quote
      const reqWithQuote = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: intlCustomer,
          items: [{ productId: 'p2', inventorySku: 'SKU-RUBY-LOT-09', quantity: 1 }],
          shippingQuoteId: quote.id,
          idempotencyKey: 'idemp_intl_order_with_quote'
        })
      });
      const resWithQuote = await handler.handleRequest(reqWithQuote);
      expect(resWithQuote.status).toBe(201);
      const orderData = await resWithQuote.json();
      expect(orderData.data.subtotal).toBe(65000);
      expect(orderData.data.shippingFee).toBe(4200); // Quoted international fee applied
      expect(orderData.data.total).toBe(69200);
      expect(orderData.data.shippingQuoteId).toBe(quote.id);
    });

    it('enforces idempotency on order creation', async () => {
      await storage.saveInventorySnapshot({
        sku: 'SKU-EMERALD-01',
        productId: 'p5',
        approvedSellingPrice: 15000,
        currency: 'INR',
        inStock: true,
        approvedBy: 'Admin',
        approvedAt: Date.now(),
        updatedAt: Date.now()
      });

      const payload = {
        customer: validDomesticCustomer,
        items: [{ productId: 'p5', inventorySku: 'SKU-EMERALD-01', quantity: 1 }],
        idempotencyKey: 'idemp_order_dup_test'
      };

      const order1 = await service.createOrder(payload);
      const order2 = await service.createOrder(payload);
      expect(order1.id).toBe(order2.id);
      expect(order1.createdAt).toBe(order2.createdAt);
      expect(order1.total).toBe(order2.total);
    });
  });
});
