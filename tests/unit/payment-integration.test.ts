// tests/unit/payment-integration.test.ts
// Stage 3C: Comprehensive test suite for Razorpay payment integration, cryptographic verification,
// atomic physical gemstone reservation, webhook reconciliation, and idempotency.

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBackendStorage } from '../../src/backend/storage';
import { BackendService } from '../../src/backend/service';
import { ApiHandler } from '../../src/backend/handler';
import { MockRazorpayClient } from '../../src/backend/razorpay-client';
import {
  hmacSha256,
  timingSafeEqual,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature
} from '../../src/backend/crypto-utils';
import type { InventorySnapshotRecord, ShippingQuoteRecord } from '../../src/backend/types';

describe('Stage 3C: Secure Razorpay Payment Integration', () => {
  let storage: MemoryBackendStorage;
  let rzpMock: MockRazorpayClient;
  let service: BackendService;
  let handler: ApiHandler;

  const OWNER_SECRET = 'test-owner-secret-stage3c';
  const MOCK_KEY_ID = 'rzp_test_mock_3c_key';
  const MOCK_KEY_SECRET = 'rzp_test_secret_key_stage3c_2026';
  const MOCK_WEBHOOK_SECRET = 'rzp_test_webhook_secret_stage3c_2026';

  beforeEach(async () => {
    storage = new MemoryBackendStorage();
    rzpMock = new MockRazorpayClient(MOCK_KEY_ID, MOCK_KEY_SECRET, MOCK_WEBHOOK_SECRET);
    service = new BackendService(storage, OWNER_SECRET, rzpMock);
    handler = new ApiHandler({
      storage,
      ownerSecret: OWNER_SECRET,
      razorpayClient: rzpMock
    });

    // Seed approved physical gemstone inventory lots for testing
    const stone1: InventorySnapshotRecord = {
      sku: 'RUBY-TEST-001',
      productId: 'p2',
      approvedSellingPrice: 45000,
      currency: 'INR',
      inStock: true,
      caratWeight: 3.25,
      certNumber: 'IGI-RUBY-99881',
      certStatus: 'CERTIFIED',
      certLab: 'IGI',
      approvedBy: 'Owner Gemologist',
      approvedAt: Date.now(),
      updatedAt: Date.now()
    };

    const stone2: InventorySnapshotRecord = {
      sku: 'EMERALD-TEST-002',
      productId: 'p5',
      approvedSellingPrice: 38000,
      currency: 'INR',
      inStock: true,
      caratWeight: 2.8,
      certNumber: 'GIA-EME-11223',
      certStatus: 'CERTIFIED',
      certLab: 'GIA',
      approvedBy: 'Owner Gemologist',
      approvedAt: Date.now(),
      updatedAt: Date.now()
    };

    await storage.saveInventorySnapshot(stone1);
    await storage.saveInventorySnapshot(stone2);
  });

  // =========================================================================
  // 1. CRYPTOGRAPHIC UTILITIES & SIGNATURE VERIFICATION
  // =========================================================================
  describe('1. Cryptographic Signatures & Timing Safety', () => {
    it('computes valid HMAC-SHA256 hex string matching standard definition', async () => {
      const sig = await hmacSha256('secret123', 'order_123|pay_456');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('performs constant-time equality comparisons safely', () => {
      expect(timingSafeEqual('abcdef123456', 'abcdef123456')).toBe(true);
      expect(timingSafeEqual('abcdef123456', 'abcdef123457')).toBe(false);
      expect(timingSafeEqual('short', 'longer_string')).toBe(false);
    });

    it('validates checkout signatures correctly with (order_id|payment_id)', async () => {
      const orderId = 'order_DA1234567890';
      const paymentId = 'pay_9876543210';
      const validSig = await rzpMock.generateValidCheckoutSignature(orderId, paymentId);

      const isValid = await verifyRazorpayCheckoutSignature(
        MOCK_KEY_SECRET,
        orderId,
        paymentId,
        validSig
      );
      expect(isValid).toBe(true);

      const isInvalid = await verifyRazorpayCheckoutSignature(
        MOCK_KEY_SECRET,
        orderId,
        paymentId,
        'forged_or_tampered_signature_hex'
      );
      expect(isInvalid).toBe(false);
    });

    it('validates webhook raw-body signatures correctly using webhook secret', async () => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', id: 'evt_123' });
      const validSig = await rzpMock.generateValidWebhookSignature(rawPayload);

      const isValid = await verifyRazorpayWebhookSignature(
        MOCK_WEBHOOK_SECRET,
        rawPayload,
        validSig
      );
      expect(isValid).toBe(true);

      const isInvalid = await verifyRazorpayWebhookSignature(
        MOCK_WEBHOOK_SECRET,
        rawPayload,
        'invalid_signature_hex'
      );
      expect(isInvalid).toBe(false);
    });
  });

  // =========================================================================
  // 2. SERVER-SIDE ORDER CREATION & INVENTORY RESERVATION
  // =========================================================================
  describe('2. Payment Order Creation & Atomic Reservation', () => {
    it('creates server-side Razorpay order with domestic shipping fee and integer paise subunits', async () => {
      const req = new Request('http://localhost/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: 'Priya Sharma',
            email: 'priya@example.com',
            phone: '+919876543210',
            addressLine1: '42 Ring Road, Lajpat Nagar',
            city: 'New Delhi',
            state: 'Delhi',
            postalCode: '110024',
            country: 'IN'
          },
          items: [
            { productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }
          ],
          idempotencyKey: 'idemp_order_create_001'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);

      const data = json.data;
      expect(data.orderId).toMatch(/^ord_/);
      expect(data.razorpayOrderId).toMatch(/^order_mock_/);
      expect(data.razorpayKeyId).toBe(MOCK_KEY_ID);
      // Ruby is ₹45,000 + ₹200 domestic shipping = ₹45,200. Subunits = 4,520,000 paise
      expect(data.amount).toBe(45200);
      expect(data.amountSubunits).toBe(4520000);
      expect(data.customerAccessToken).toMatch(/^cat_/);

      // Verify that physical inventory lot is atomically reserved for this order
      const snap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(snap?.reservedOrderId).toBe(data.orderId);
    });

    it('fails closed on provisional catalogue items lacking inventory SKU', async () => {
      const req = new Request('http://localhost/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: 'Priya Sharma',
            email: 'priya@example.com',
            phone: '+919876543210',
            addressLine1: '42 Ring Road',
            city: 'New Delhi',
            state: 'Delhi',
            postalCode: '110024',
            country: 'IN'
          },
          items: [
            { productId: 'p2', quantity: 1 } // missing inventorySku!
          ],
          idempotencyKey: 'idemp_prov_fail_002'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('rejects unpurchasable metadata items from payment gateway', async () => {
      const req = new Request('http://localhost/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: {
            name: 'Priya Sharma',
            email: 'priya@example.com',
            phone: '+919876543210',
            addressLine1: '42 Ring Road',
            city: 'New Delhi',
            state: 'Delhi',
            postalCode: '110024',
            country: 'IN'
          },
          items: [
            { productId: 'sample-gemstone', inventorySku: 'RUBY-TEST-001', quantity: 1 }
          ],
          idempotencyKey: 'idemp_metadata_fail_003'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('prevents concurrent double-booking of 1-of-1 gemstones (overselling prevention)', async () => {
      // First customer reserves the ruby
      const res1 = await service.createPaymentOrder({
        customer: {
          name: 'First Buyer',
          email: 'first@example.com',
          phone: '+919876543211',
          addressLine1: '1 First Ave',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_race_buyer_1'
      });
      expect(res1.orderId).toBeTruthy();

      // Second customer attempts to checkout the same 1-of-1 stone simultaneously
      await expect(
        service.createPaymentOrder({
          customer: {
            name: 'Second Buyer',
            email: 'second@example.com',
            phone: '+919876543212',
            addressLine1: '2 Second Ave',
            city: 'Bangalore',
            state: 'Karnataka',
            postalCode: '560001',
            country: 'IN'
          },
          items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
          idempotencyKey: 'idemp_race_buyer_2'
        })
      ).rejects.toThrow(/already reserved/i);
    });

    it('rolls back inventory reservation if Razorpay gateway order creation fails', async () => {
      rzpMock.shouldFailCreateOrder = true;
      rzpMock.failureMessage = 'Simulated Razorpay server 500 error';

      await expect(
        service.createPaymentOrder({
          customer: {
            name: 'Emerald Buyer',
            email: 'eme@example.com',
            phone: '+919876543213',
            addressLine1: '3 Third Ave',
            city: 'Jaipur',
            state: 'Rajasthan',
            postalCode: '302001',
            country: 'IN'
          },
          items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
          idempotencyKey: 'idemp_rzp_fail_rollback'
        })
      ).rejects.toThrow('Simulated Razorpay server 500 error');

      // The emerald reservation must be completely released
      const snap = await storage.getInventorySnapshotBySku('EMERALD-TEST-002');
      expect(snap?.reservedOrderId).toBeUndefined();
      expect(snap?.inStock).toBe(true);
    });

    it('requires accepted shipping quote for international payment orders', async () => {
      // 1. Rejects international order when shipping quote is missing
      await expect(
        service.createPaymentOrder({
          customer: {
            name: 'John Doe',
            email: 'john@example.co.uk',
            phone: '+447911123456',
            addressLine1: '10 Downing St',
            city: 'London',
            state: 'London',
            postalCode: 'SW1A 2AA',
            country: 'GB'
          },
          items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
          idempotencyKey: 'idemp_intl_no_quote'
        })
      ).rejects.toThrow(/accepted shipping quote/i);

      // 2. Set up accepted international shipping quote
      const quote: ShippingQuoteRecord = {
        id: 'quote_intl_test_99',
        customerEmail: 'john@example.co.uk',
        destinationCountry: 'GB',
        destinationPostalCode: 'SW1A 2AA',
        destinationAddress: '10 Downing St',
        quotedAmount: 4500, // ₹4,500 courier fee
        quotedCurrency: 'INR',
        status: 'ACCEPTED_BY_CUSTOMER',
        idempotencyKey: 'idemp_quote_seed_intl',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await storage.saveShippingQuote(quote);

      // 3. International order succeeds with accepted quote
      const intlOrder = await service.createPaymentOrder({
        customer: {
          name: 'John Doe',
          email: 'john@example.co.uk',
          phone: '+447911123456',
          addressLine1: '10 Downing St',
          city: 'London',
          state: 'London',
          postalCode: 'SW1A 2AA',
          country: 'GB'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        shippingQuoteId: quote.id,
        idempotencyKey: 'idemp_intl_with_quote'
      });

      // Total = ₹45,000 + ₹4,500 shipping = ₹49,500 (4,950,000 paise)
      expect(intlOrder.amount).toBe(49500);
      expect(intlOrder.amountSubunits).toBe(4950000);
    });

    it('returns existing order idempotently on duplicate creation requests', async () => {
      const payload = {
        customer: {
          name: 'Idempotent Buyer',
          email: 'idem@example.com',
          phone: '+919876543299',
          addressLine1: '100 MG Road',
          city: 'Pune',
          state: 'Maharashtra',
          postalCode: '411001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_test_duplicate_key'
      };

      const first = await service.createPaymentOrder(payload);
      const second = await service.createPaymentOrder(payload);

      expect(second.orderId).toBe(first.orderId);
      expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
      expect(second.amountSubunits).toBe(first.amountSubunits);
    });
  });

  // =========================================================================
  // 3. CHECKOUT SIGNATURE VERIFICATION
  // =========================================================================
  describe('3. Checkout Payment Verification', () => {
    it('verifies valid checkout signature, confirms order, and finalizes inventory', async () => {
      // 1. Create payment order
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Amit Patel',
          email: 'amit@example.com',
          phone: '+919876543215',
          addressLine1: '55 Navrangpura',
          city: 'Ahmedabad',
          state: 'Gujarat',
          postalCode: '380009',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_verify_success_001'
      });

      const paymentId = 'pay_mock_test_123456';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // 2. Call verify endpoint with customer token
      const req = new Request('http://localhost/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Token': createRes.customerAccessToken
        },
        body: JSON.stringify({
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('PAYMENT_CONFIRMED');
      expect(json.data.paymentId).toBe(paymentId);

      // 3. Verify order record updated in storage
      const confirmedOrder = await storage.getOrderById(createRes.orderId);
      expect(confirmedOrder?.status).toBe('PAYMENT_CONFIRMED');
      expect(confirmedOrder?.razorpayPaymentId).toBe(paymentId);
      expect(confirmedOrder?.paymentConfirmedAt).toBeGreaterThan(0);

      // 4. Verify physical inventory snapshot finalized (inStock = false, reservation cleared)
      const stoneSnap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(stoneSnap?.inStock).toBe(false);
      expect(stoneSnap?.reservedOrderId).toBeUndefined();

      // 5. Verify payment attempt marked as CAPTURED
      const attempts = await storage.getPaymentAttemptsByOrderId(createRes.orderId);
      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts[0]?.status).toBe('CAPTURED');
    });

    it('rejects tampered or forged checkout signatures and records payment attempt failure', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Security Test',
          email: 'sec@example.com',
          phone: '+919876543216',
          addressLine1: 'Security Lab',
          city: 'New Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_verify_tamper_002'
      });

      const req = new Request('http://localhost/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Token': createRes.customerAccessToken
        },
        body: JSON.stringify({
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: 'pay_tampered_000',
          razorpaySignature: 'bad_forged_signature_hex_000000000000000000000000000000000000000000'
        })
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INVALID_PAYMENT_SIGNATURE');

      // Order must remain PENDING_PAYMENT
      const order = await storage.getOrderById(createRes.orderId);
      expect(order?.status).toBe('PENDING_PAYMENT');

      // Payment attempt marked FAILED
      const attempts = await storage.getPaymentAttemptsByOrderId(createRes.orderId);
      expect(attempts[0]?.status).toBe('FAILED');
    });

    it('requires customer access token to verify order payment', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Token Gated',
          email: 'gated@example.com',
          phone: '+919876543217',
          addressLine1: 'Gated Community',
          city: 'Noida',
          state: 'Uttar Pradesh',
          postalCode: '201301',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_verify_token_gate_003'
      });

      const paymentId = 'pay_valid_tok_test';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Attempt verification without token
      const reqNoToken = new Request('http://localhost/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        })
      });

      const resNoToken = await handler.handleRequest(reqNoToken);
      expect(resNoToken.status).toBe(403);
    });

    it('handles idempotent verification requests gracefully without repeated side effects', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Idempotent Verify',
          email: 'idem_v@example.com',
          phone: '+919876543218',
          addressLine1: 'Idem Lane',
          city: 'Hyderabad',
          state: 'Telangana',
          postalCode: '500001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_verify_repeated_004'
      });

      const paymentId = 'pay_repeated_test';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      const vPayload = {
        orderId: createRes.orderId,
        razorpayOrderId: createRes.razorpayOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSig
      };

      const res1 = await service.verifyCheckoutPayment(vPayload, createRes.customerAccessToken);
      expect(res1.status).toBe('PAYMENT_CONFIRMED');

      const res2 = await service.verifyCheckoutPayment(vPayload, createRes.customerAccessToken);
      expect(res2.status).toBe('PAYMENT_CONFIRMED');
    });

    it('keeps order in PENDING_PAYMENT when payment is authorized but not yet captured (captureStatus: authorized)', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Auth Only Buyer',
          email: 'auth_only@example.com',
          phone: '+919876543224',
          addressLine1: '12 Auth St',
          city: 'Jaipur',
          state: 'Rajasthan',
          postalCode: '302001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_verify_auth_only_005'
      });

      const paymentId = 'pay_auth_only_999';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Configure Mock to return 'authorized' status (not yet captured)
      rzpMock.payments.set(paymentId, {
        id: paymentId,
        entity: 'payment',
        amount: createRes.amountSubunits,
        currency: 'INR',
        status: 'authorized',
        order_id: createRes.razorpayOrderId
      });

      const res = await service.verifyCheckoutPayment(
        {
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        createRes.customerAccessToken
      );

      // Order must remain PENDING_PAYMENT!
      expect(res.status).toBe('PENDING_PAYMENT');
      expect(res.captureStatus).toBe('authorized');

      const orderInDb = await storage.getOrderById(createRes.orderId);
      expect(orderInDb?.status).toBe('PENDING_PAYMENT');
      expect(orderInDb?.paymentConfirmedAt).toBeUndefined();

      // Physical gemstone lot must REMAIN RESERVED, but NOT marked in_stock = 0 (not finalized)
      const stoneSnap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(stoneSnap?.inStock).toBe(true);
      expect(stoneSnap?.reservedOrderId).toBe(createRes.orderId);

      // Payment attempt marked AUTHORIZED
      const attempts = await storage.getPaymentAttemptsByOrderId(createRes.orderId);
      expect(attempts[0]?.status).toBe('AUTHORIZED');
    });

    it('handles gateway timeout during fetchPayment safely and confirms when webhook arrives', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Timeout Buyer',
          email: 'timeout@example.com',
          phone: '+919876543225',
          addressLine1: '13 Timeout Ave',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_timeout_safe_006'
      });

      const paymentId = 'pay_timeout_test_888';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Simulate Gateway Timeout
      rzpMock.shouldTimeout = true;

      const res = await service.verifyCheckoutPayment(
        {
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        createRes.customerAccessToken
      );

      // Order stays PENDING_PAYMENT, captureStatus is pending
      expect(res.status).toBe('PENDING_PAYMENT');
      expect(res.captureStatus).toBe('pending');

      const orderInDb = await storage.getOrderById(createRes.orderId);
      expect(orderInDb?.status).toBe('PENDING_PAYMENT');

      // Gemstone stays reserved
      const snapBefore = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(snapBefore?.inStock).toBe(true);
      expect(snapBefore?.reservedOrderId).toBe(createRes.orderId);

      // Reset timeout
      rzpMock.shouldTimeout = false;

      // Webhook arrives later and confirms the payment
      const webhookPayload = JSON.stringify({
        id: 'evt_delayed_capture_wh',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: createRes.razorpayOrderId,
              amount: createRes.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });
      const whSig = await rzpMock.generateValidWebhookSignature(webhookPayload);
      const whRes = await service.processWebhook(webhookPayload, whSig);
      expect(whRes.status).toBe('PROCESSED');

      // Now order is confirmed and inventory finalized!
      const orderConfirmed = await storage.getOrderById(createRes.orderId);
      expect(orderConfirmed?.status).toBe('PAYMENT_CONFIRMED');

      const snapAfter = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(snapAfter?.inStock).toBe(false);
    });

    it('rejects payment verification if Razorpay order ID belongs to a different order', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Order Mismatch Buyer',
          email: 'mismatch@example.com',
          phone: '+919876543226',
          addressLine1: '14 Mismatch Rd',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_order_mismatch_007'
      });

      const paymentId = 'pay_mismatch_test_777';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Set payment pointing to a DIFFERENT Razorpay order
      rzpMock.payments.set(paymentId, {
        id: paymentId,
        entity: 'payment',
        amount: createRes.amountSubunits,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_mock_DIFFERENT_999'
      });

      await expect(
        service.verifyCheckoutPayment(
          {
            orderId: createRes.orderId,
            razorpayOrderId: createRes.razorpayOrderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: validSig
          },
          createRes.customerAccessToken
        )
      ).rejects.toThrow(/order_mock_DIFFERENT_999/);
    });

    it('rejects payment verification if payment amount is less than expected paise', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Underpaid Buyer',
          email: 'underpaid@example.com',
          phone: '+919876543227',
          addressLine1: '15 Underpaid St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_underpaid_008'
      });

      const paymentId = 'pay_underpaid_666';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Amount is 500 paise (₹5) instead of ₹45,200
      rzpMock.payments.set(paymentId, {
        id: paymentId,
        entity: 'payment',
        amount: 500,
        currency: 'INR',
        status: 'captured',
        order_id: createRes.razorpayOrderId
      });

      await expect(
        service.verifyCheckoutPayment(
          {
            orderId: createRes.orderId,
            razorpayOrderId: createRes.razorpayOrderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: validSig
          },
          createRes.customerAccessToken
        )
      ).rejects.toThrow(/does not match required order total/i);
    });

    it('rejects payment verification when payment amount is an unexpected overpayment', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Overpay Buyer',
          email: 'overpay@example.com',
          phone: '+919876543229',
          addressLine1: '17 Overpay St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
        idempotencyKey: 'idemp_overpay_001'
      });

      const paymentId = 'pay_overpay_12345';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // Amount is 5,000,000 paise (₹50,000) instead of ₹45,200
      rzpMock.payments.set(paymentId, {
        id: paymentId,
        entity: 'payment',
        amount: 5000000,
        currency: 'INR',
        status: 'captured',
        order_id: createRes.razorpayOrderId
      });

      await expect(
        service.verifyCheckoutPayment(
          {
            orderId: createRes.orderId,
            razorpayOrderId: createRes.razorpayOrderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: validSig
          },
          createRes.customerAccessToken
        )
      ).rejects.toThrow(/does not match required order total/i);
    });

    it('allows retry of payment verification after earlier gateway timeout', async () => {
      const createRes = await service.createPaymentOrder({
        customer: {
          name: 'Retry Buyer',
          email: 'retry@example.com',
          phone: '+919876543228',
          addressLine1: '16 Retry St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_retry_009'
      });

      const paymentId = 'pay_retry_555';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        createRes.razorpayOrderId,
        paymentId
      );

      // First attempt: timeout
      rzpMock.shouldTimeout = true;
      const firstRes = await service.verifyCheckoutPayment(
        {
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        createRes.customerAccessToken
      );
      expect(firstRes.status).toBe('PENDING_PAYMENT');
      expect(firstRes.captureStatus).toBe('pending');

      // Second attempt: gateway recovered
      rzpMock.shouldTimeout = false;
      const secondRes = await service.verifyCheckoutPayment(
        {
          orderId: createRes.orderId,
          razorpayOrderId: createRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        createRes.customerAccessToken
      );
      expect(secondRes.status).toBe('PAYMENT_CONFIRMED');
      expect(secondRes.captureStatus).toBe('captured');
    });
  });

  // =========================================================================
  // 4. WEBHOOK VERIFICATION & STATE RECONCILIATION
  // =========================================================================
  describe('4. Webhook Processing & Event Reconciliation', () => {
    it('rejects webhooks with missing or invalid x-razorpay-signature header', async () => {
      const rawPayload = JSON.stringify({ event: 'payment.captured', id: 'evt_sig_fail_1' });

      // Missing signature header
      const reqMissing = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: rawPayload
      });
      const resMissing = await handler.handleRequest(reqMissing);
      expect(resMissing.status).toBe(400);

      // Invalid signature
      const reqInvalid = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': 'forged_webhook_signature_hex'
        },
        body: rawPayload
      });
      const resInvalid = await handler.handleRequest(reqInvalid);
      expect(resInvalid.status).toBe(401);
    });

    it('processes payment.captured webhook, confirms order, and finalizes physical stone lot', async () => {
      // 1. Create order
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Webhook Customer',
          email: 'wh_cust@example.com',
          phone: '+919876543219',
          addressLine1: '7 Webhook St',
          city: 'Chennai',
          state: 'Tamil Nadu',
          postalCode: '600001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
        idempotencyKey: 'idemp_wh_captured_001'
      });

      // 2. Prepare official Razorpay webhook payload
      const webhookPayload = JSON.stringify({
        entity: 'event',
        account_id: 'acc_GON_TEST',
        event: 'payment.captured',
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: 'pay_wh_captured_9988',
              order_id: orderRes.razorpayOrderId,
              amount: orderRes.amountSubunits, // ₹38,200 (3,820,000 paise)
              currency: 'INR',
              status: 'captured'
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      });

      const signature = await rzpMock.generateValidWebhookSignature(webhookPayload);

      // 3. Dispatch to webhook endpoint
      const req = new Request('http://localhost/api/payments/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature
        },
        body: webhookPayload
      });

      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe('PROCESSED');

      // 4. Verify order confirmed via webhook
      const confirmedOrder = await storage.getOrderById(orderRes.orderId);
      expect(confirmedOrder?.status).toBe('PAYMENT_CONFIRMED');
      expect(confirmedOrder?.razorpayPaymentId).toBe('pay_wh_captured_9988');

      // 5. Verify emerald is marked out of stock
      const emeraldSnap = await storage.getInventorySnapshotBySku('EMERALD-TEST-002');
      expect(emeraldSnap?.inStock).toBe(false);
    });

    it('detects captured payment amount tampering and rejects webhook', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Tamper Target',
          email: 'tamper@example.com',
          phone: '+919876543220',
          addressLine1: '8 Tamper Lane',
          city: 'Kolkata',
          state: 'West Bengal',
          postalCode: '700001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
        idempotencyKey: 'idemp_wh_tamper_002'
      });

      // Attacker tampers amount to 100 paise (₹1) instead of ₹38,200
      const tamperedPayload = JSON.stringify({
        entity: 'event',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_wh_tampered_111',
              order_id: orderRes.razorpayOrderId,
              amount: 100, // Only ₹1 !
              currency: 'INR',
              status: 'captured'
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      });

      const signature = await rzpMock.generateValidWebhookSignature(tamperedPayload);
      const result = await service.processWebhook(tamperedPayload, signature);

      expect(result.status).toBe('FAILED');
      expect(result.message).toMatch(/tamper/i);

      // Order must NOT be confirmed
      const order = await storage.getOrderById(orderRes.orderId);
      expect(order?.status).toBe('PENDING_PAYMENT');
    });

    it('deduplicates identical webhook deliveries idempotently', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Dedup Buyer',
          email: 'dedup@example.com',
          phone: '+919876543221',
          addressLine1: '9 Dedup Rd',
          city: 'Chandigarh',
          state: 'Punjab',
          postalCode: '160001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
        idempotencyKey: 'idemp_wh_dedup_003'
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_dedup_unique_123',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_wh_dedup_222',
              order_id: orderRes.razorpayOrderId,
              amount: orderRes.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });

      const signature = await rzpMock.generateValidWebhookSignature(webhookPayload);

      const res1 = await service.processWebhook(webhookPayload, signature);
      expect(res1.status).toBe('PROCESSED');

      // Replay identical event
      const res2 = await service.processWebhook(webhookPayload, signature);
      expect(res2.status).toBe('PROCESSED');
      expect(res2.message).toMatch(/duplicate/i);
    });

    it('does NOT revert an already PAYMENT_CONFIRMED order on late payment.failed webhook', async () => {
      // 1. Order confirmed via checkout verification
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Confirmed Buyer',
          email: 'conf@example.com',
          phone: '+919876543222',
          addressLine1: '10 Safe Way',
          city: 'Indore',
          state: 'Madhya Pradesh',
          postalCode: '452001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_wh_out_of_order_004'
      });

      const paymentId = 'pay_confirmed_prior';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        orderRes.razorpayOrderId,
        paymentId
      );
      await service.verifyCheckoutPayment(
        {
          orderId: orderRes.orderId,
          razorpayOrderId: orderRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        orderRes.customerAccessToken
      );

      // Verify order is confirmed
      const beforeWebhook = await storage.getOrderById(orderRes.orderId);
      expect(beforeWebhook?.status).toBe('PAYMENT_CONFIRMED');

      // 2. Out-of-order payment.failed webhook arrives
      const failedPayload = JSON.stringify({
        id: 'evt_late_failure_333',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_attempt_444',
              order_id: orderRes.razorpayOrderId,
              error_description: 'Card expired'
            }
          }
        }
      });

      const signature = await rzpMock.generateValidWebhookSignature(failedPayload);
      const res = await service.processWebhook(failedPayload, signature);
      expect(res.status).toBe('PROCESSED');

      // CRITICAL: Order must STAY confirmed and NOT revert to failed!
      const afterWebhook = await storage.getOrderById(orderRes.orderId);
      expect(afterWebhook?.status).toBe('PAYMENT_CONFIRMED');
    });

    it('releases reserved inventory for pending order on payment.failed webhook', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Failed Attempt Buyer',
          email: 'fail@example.com',
          phone: '+919876543223',
          addressLine1: '11 Release St',
          city: 'Surat',
          state: 'Gujarat',
          postalCode: '395001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_wh_release_005'
      });

      // Lot is initially reserved
      const reservedSnap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(reservedSnap?.reservedOrderId).toBe(orderRes.orderId);

      // Payment fails at gateway
      const failedPayload = JSON.stringify({
        id: 'evt_pending_failure_444',
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_attempt_555',
              order_id: orderRes.razorpayOrderId,
              error_description: 'Insufficient funds'
            }
          }
        }
      });

      const signature = await rzpMock.generateValidWebhookSignature(failedPayload);
      await service.processWebhook(failedPayload, signature);

      // Inventory reservation is released, ruby is available again
      const releasedSnap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(releasedSnap?.reservedOrderId).toBeUndefined();
      expect(releasedSnap?.inStock).toBe(true);
    });

    it('handles concurrent race where webhook arrives first, followed by checkout verification', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Concurrent Buyer 1',
          email: 'conc1@example.com',
          phone: '+919876543230',
          addressLine1: '17 Race St',
          city: 'Noida',
          state: 'Uttar Pradesh',
          postalCode: '201301',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_race_wh_first_010'
      });

      const paymentId = 'pay_race_first_111';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        orderRes.razorpayOrderId,
        paymentId
      );

      // 1. Webhook arrives first
      const webhookPayload = JSON.stringify({
        id: 'evt_race_first_wh',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderRes.razorpayOrderId,
              amount: orderRes.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });
      const whSig = await rzpMock.generateValidWebhookSignature(webhookPayload);
      const whRes = await service.processWebhook(webhookPayload, whSig);
      expect(whRes.status).toBe('PROCESSED');

      // 2. Checkout verification arrives second
      const verifyRes = await service.verifyCheckoutPayment(
        {
          orderId: orderRes.orderId,
          razorpayOrderId: orderRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        orderRes.customerAccessToken
      );

      // Successfully returns confirmed status idempotently without duplicate inventory modification
      expect(verifyRes.status).toBe('PAYMENT_CONFIRMED');

      const finalOrder = await storage.getOrderById(orderRes.orderId);
      expect(finalOrder?.status).toBe('PAYMENT_CONFIRMED');

      const stoneSnap = await storage.getInventorySnapshotBySku('RUBY-TEST-001');
      expect(stoneSnap?.inStock).toBe(false);
    });

    it('handles concurrent race where checkout verification arrives first, followed by webhook', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Concurrent Buyer 2',
          email: 'conc2@example.com',
          phone: '+919876543231',
          addressLine1: '18 Race Rd',
          city: 'Gurugram',
          state: 'Haryana',
          postalCode: '122001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'EMERALD-TEST-002', quantity: 1 }],
        idempotencyKey: 'idemp_race_checkout_first_011'
      });

      const paymentId = 'pay_race_second_222';
      const validSig = await rzpMock.generateValidCheckoutSignature(
        orderRes.razorpayOrderId,
        paymentId
      );

      // 1. Checkout verification arrives first
      const verifyRes = await service.verifyCheckoutPayment(
        {
          orderId: orderRes.orderId,
          razorpayOrderId: orderRes.razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: validSig
        },
        orderRes.customerAccessToken
      );
      expect(verifyRes.status).toBe('PAYMENT_CONFIRMED');

      // 2. Webhook arrives second
      const webhookPayload = JSON.stringify({
        id: 'evt_race_second_wh',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderRes.razorpayOrderId,
              amount: orderRes.amountSubunits,
              currency: 'INR'
            }
          }
        }
      });
      const whSig = await rzpMock.generateValidWebhookSignature(webhookPayload);
      const whRes = await service.processWebhook(webhookPayload, whSig);
      expect(whRes.status).toBe('PROCESSED');

      // Order remains confirmed, inventory finalized
      const finalOrder = await storage.getOrderById(orderRes.orderId);
      expect(finalOrder?.status).toBe('PAYMENT_CONFIRMED');

      const stoneSnap = await storage.getInventorySnapshotBySku('EMERALD-TEST-002');
      expect(stoneSnap?.inStock).toBe(false);
    });

    it('rejects webhook if payment currency is not INR', async () => {
      const orderRes = await service.createPaymentOrder({
        customer: {
          name: 'Currency Test',
          email: 'currency@example.com',
          phone: '+919876543232',
          addressLine1: '19 Currency St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p2', inventorySku: 'RUBY-TEST-001', quantity: 1 }],
        idempotencyKey: 'idemp_wh_currency_012'
      });

      const webhookPayload = JSON.stringify({
        id: 'evt_usd_currency_test',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_usd_test',
              order_id: orderRes.razorpayOrderId,
              amount: orderRes.amountSubunits,
              currency: 'USD' // Disallowed currency!
            }
          }
        }
      });

      const signature = await rzpMock.generateValidWebhookSignature(webhookPayload);
      const res = await service.processWebhook(webhookPayload, signature);

      expect(res.status).toBe('FAILED');
      expect(res.message).toMatch(/currency/i);

      // Order must NOT be confirmed
      const order = await storage.getOrderById(orderRes.orderId);
      expect(order?.status).toBe('PENDING_PAYMENT');
    });
  });
});
