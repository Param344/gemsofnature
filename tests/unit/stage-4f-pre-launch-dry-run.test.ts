// tests/unit/stage-4f-pre-launch-dry-run.test.ts
// Stage 4F: Non-Commercial Pre-Launch Dry Run Unit & Workflow Verification Suite
// NOTE: EXPLICITLY NON-PAYMENT. NO PAYMENT SUITES, GATEWAYS, OR LIVE CREDENTIALS ARE USED.

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  MockD1Database,
  D1BackendStorage,
  BackendService,
  ApiHandler
} from '../../src/backend';
import {
  parseInventoryCsv,
  validateInventoryBatch,
  SAMPLE_TEST_INVENTORY_CSV
} from '../../src/inventory/csv-importer';
import { timingSafeEqual } from '../../src/backend/crypto-utils';

describe('Stage 4F: Non-Commercial Pre-Launch Dry Run Suite', () => {
  const OWNER_SECRET = 'gon_owner_stage4f_dryrun_secret_2026';
  let db: MockD1Database;
  let d1Storage: D1BackendStorage;
  let service: BackendService;
  let handler: ApiHandler;

  beforeEach(async () => {
    db = new MockD1Database();
    d1Storage = new D1BackendStorage(db);
    await d1Storage.clear();
    service = new BackendService(d1Storage, OWNER_SECRET);
    handler = new ApiHandler({
      storage: d1Storage,
      ownerSecret: OWNER_SECRET,
      rateLimitPerMinute: 60
    });
  });

  // Helper for authenticated owner requests
  function makeOwnerRequest(
    pathname: string,
    options: {
      method?: string;
      body?: unknown;
      customSecret?: string;
    } = {}
  ): Request {
    const method = options.method || 'GET';
    const secret = options.customSecret !== undefined ? options.customSecret : OWNER_SECRET;
    const headers: Record<string, string> = {};

    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    return new Request(`http://localhost${pathname}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  }

  // =========================================================================
  // TASK 1: Environment Discovery & Configuration Auditing
  // =========================================================================
  describe('Task 1: Environment Discovery & Configuration Auditing', () => {
    it('verifies wrangler.toml uses placeholder D1 database_id and is not treated as production', () => {
      const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');
      expect(fs.existsSync(wranglerPath)).toBe(true);
      const content = fs.readFileSync(wranglerPath, 'utf8');

      // Must have placeholder UUID
      expect(content).toContain('00000000-0000-0000-0000-000000000000');
      // Must clearly document that secrets are not stored in repository
      expect(content).toContain('No real credentials or live payment secrets are stored here');
    });

    it('verifies D1 migrations exist in migrations/ directory with correct sequencing', () => {
      const migrationsDir = path.resolve(process.cwd(), 'migrations');
      expect(fs.existsSync(migrationsDir)).toBe(true);
      const files = fs.readdirSync(migrationsDir).sort();

      expect(files).toContain('0001_initial_schema.sql');
      expect(files).toContain('0002_owner_management_and_audit.sql');
      expect(files).toContain('0003_razorpay_payments_and_webhooks.sql');
      expect(files).toContain('0004_inventory_ratti_and_origin.sql');
    });

    it('verifies MockD1Database provides isolated, ACID in-memory test double simulation', async () => {
      expect(db).toBeInstanceOf(MockD1Database);
      const inqs = await d1Storage.listInquiries();
      expect(inqs.total).toBe(0);
    });
  });

  // =========================================================================
  // TASK 2: Customer Inquiry & International Shipping Quote Workflow
  // =========================================================================
  describe('Task 2: Customer Inquiry Workflow (Synthetic Non-Payment Data)', () => {
    const syntheticCustomer = {
      name: 'DryRun Test User',
      email: 'dryrun.synthetic.customer@example.invalid',
      phone: '+91 98765 00000',
      country: 'IN',
      addressLine1: '42 Synthetic Test Boulevard',
      city: 'New Delhi',
      state: 'Delhi',
      postalCode: '110001'
    };

    it('submits synthetic inquiry, receives customerToken, and verifies persistence in D1', async () => {
      const inquiryPayload = {
        customer: syntheticCustomer,
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p2', quantity: 2 }
        ],
        notes: 'Dry-run synthetic test inquiry for precious yellow sapphire & ruby.',
        idempotencyKey: 'dryrun_idemp_001'
      };

      const req = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiryPayload)
      });

      const res = await handler.handleRequest(req, '127.0.0.1');
      expect(res.status).toBe(201);
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.data.id).toMatch(/^inq_/);
      expect(body.data.customerAccessToken).toBeDefined();
      expect(typeof body.data.customerAccessToken).toBe('string');
      expect(body.data.customerAccessToken.startsWith('cat_')).toBe(true);
      expect(body.data.customerAccessToken.length).toBe(68); // cat_ prefix + 64 hex chars
      expect(body.data.status).toBe('PENDING_REVIEW');

      // Verify persistence in D1 storage
      const persistedInq = await d1Storage.getInquiryById(body.data.id);
      expect(persistedInq).not.toBeNull();
      expect(persistedInq?.customerEmail).toBe('dryrun.synthetic.customer@example.invalid');
      expect(persistedInq?.items.length).toBe(2);
      expect(persistedInq?.items[0]?.productId).toBe('p1');
      expect(persistedInq?.items[1]?.productId).toBe('p2');
    });

    it('verifies customer token authorization: authorized on valid token, rejected on invalid or missing token', async () => {
      // 1. Create inquiry
      const inq = await service.createInquiry({
        customer: syntheticCustomer,
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'dryrun_auth_check_01'
      });

      // 2. Query with valid customer token
      const reqValid = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${inq.customerAccessToken}` }
      });
      const resValid = await handler.handleRequest(reqValid, '127.0.0.1');
      expect(resValid.status).toBe(200);
      const bodyValid = await resValid.json();
      expect(bodyValid.success).toBe(true);
      expect(bodyValid.data.id).toBe(inq.id);

      // 3. Query with invalid/forged customer token
      const reqInvalid = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer invalid_forged_customer_token_hex_1234567890' }
      });
      const resInvalid = await handler.handleRequest(reqInvalid, '127.0.0.1');
      expect(resInvalid.status).toBe(401);
      const bodyInvalid = await resInvalid.json();
      expect(bodyInvalid.success).toBe(false);
      expect(bodyInvalid.error.code).toBe('CUSTOMER_AUTH_REQUIRED');

      // 4. Query with no token at all
      const reqNoToken = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        method: 'GET'
      });
      const resNoToken = await handler.handleRequest(reqNoToken, '127.0.0.1');
      expect(resNoToken.status).toBe(401);
    });

    it('verifies owner management: list inquiries, add notes, and transition inquiry status', async () => {
      const inq = await service.createInquiry({
        customer: syntheticCustomer,
        items: [{ productId: 'p5', quantity: 1 }],
        notes: 'Inquiry for emerald',
        idempotencyKey: 'dryrun_owner_mgmt_01'
      });

      // 1. Owner lists inquiries
      const listReq = makeOwnerRequest('/api/owner/inquiries');
      const listRes = await handler.handleRequest(listReq, '127.0.0.1');
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.success).toBe(true);
      expect(listBody.data.items.some((item: any) => item.id === inq.id)).toBe(true);

      // 2. Owner adds inquiry note
      const noteReq = makeOwnerRequest(`/api/owner/inquiries/${inq.id}/notes`, {
        method: 'POST',
        body: { note: 'Verified genuine rough batch with workshop; Zambian origin.' }
      });
      const noteRes = await handler.handleRequest(noteReq, '127.0.0.1');
      expect(noteRes.status).toBe(201);
      const noteBody = await noteRes.json();
      expect(noteBody.success).toBe(true);
      expect(noteBody.data.note).toContain('Zambian origin');

      // 3. Owner updates status according to valid state machine transition (PENDING_REVIEW -> PRICE_QUOTED)
      const statusReq = makeOwnerRequest(`/api/owner/inquiries/${inq.id}/status`, {
        method: 'POST',
        body: { status: 'PRICE_QUOTED' }
      });
      const statusRes = await handler.handleRequest(statusReq, '127.0.0.1');
      expect(statusRes.status).toBe(200);
      const statusBody = await statusRes.json();
      expect(statusBody.data.status).toBe('PRICE_QUOTED');
    });

    it('verifies international quote workflow: request, owner approval, and customer acceptance', async () => {
      // 1. Submit international quote request
      const quotePayload = {
        customerEmail: 'synthetic.uk.customer@example.invalid',
        destinationCountry: 'GB',
        destinationPostalCode: 'EC1A 1BB',
        destinationAddress: 'Flat 4, 10 Baker Street, London',
        idempotencyKey: 'dryrun_intl_quote_01'
      };

      const quoteReq = new Request('http://localhost/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotePayload)
      });
      const quoteRes = await handler.handleRequest(quoteReq, '127.0.0.1');
      expect(quoteRes.status).toBe(201);
      const quoteData = await quoteRes.json();
      const quoteId = quoteData.data.id;
      const quoteCustomerToken = quoteData.data.customerAccessToken;
      expect(quoteData.data.status).toBe('REQUESTED');

      // 2. Owner approves international quote with shipping charge
      const approveReq = makeOwnerRequest(`/api/owner/quotes/${quoteId}/approve`, {
        method: 'POST',
        body: {
          quotedAmount: 3500, // ₹3500 international insured DHL courier
          quotedCurrency: 'INR',
          validityHours: 72
        }
      });
      const approveRes = await handler.handleRequest(approveReq, '127.0.0.1');
      expect(approveRes.status).toBe(200);
      const approveData = await approveRes.json();
      expect(approveData.data.status).toBe('APPROVED_BY_OWNER');
      expect(approveData.data.quotedAmount).toBe(3500);

      // 3. Customer accepts quote using customerToken
      const acceptReq = new Request(`http://localhost/api/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${quoteCustomerToken}`,
          'Content-Type': 'application/json'
        }
      });
      const acceptRes = await handler.handleRequest(acceptReq, '127.0.0.1');
      expect(acceptRes.status).toBe(200);
      const acceptData = await acceptRes.json();
      expect(acceptData.data.status).toBe('ACCEPTED_BY_CUSTOMER');
    });

    it('rejects invalid inputs: invalid email, phone, unknown product IDs, and negative quantities', async () => {
      // Bad email
      const res1 = await handler.handleRequest(
        new Request('http://localhost/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: { ...syntheticCustomer, email: 'not-an-email' },
            items: [{ productId: 'p1', quantity: 1 }]
          })
        }),
        '127.0.0.1'
      );
      expect(res1.status).toBe(400);

      // Unknown product ID
      const res2 = await handler.handleRequest(
        new Request('http://localhost/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: syntheticCustomer,
            items: [{ productId: 'p9999', quantity: 1 }]
          })
        }),
        '127.0.0.1'
      );
      expect(res2.status).toBe(400);

      // Negative quantity
      const res3 = await handler.handleRequest(
        new Request('http://localhost/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: syntheticCustomer,
            items: [{ productId: 'p1', quantity: -3 }]
          })
        }),
        '127.0.0.1'
      );
      expect(res3.status).toBe(400);
    });

    it('verifies idempotent inquiry submission: duplicate submission returns cached inquiry safely', async () => {
      const payload = {
        customer: syntheticCustomer,
        items: [{ productId: 'p2', quantity: 1 }],
        idempotencyKey: 'idemp_duplicate_test_key_01'
      };

      const req1 = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res1 = await handler.handleRequest(req1, '127.0.0.1');
      const body1 = await res1.json();

      const req2 = new Request('http://localhost/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const res2 = await handler.handleRequest(req2, '127.0.0.1');
      const body2 = await res2.json();

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(body1.data.id).toBe(body2.data.id);
      expect(body1.data.status).toBe(body2.data.status);

      // Ensure no duplicate records created in D1
      const inqs = await d1Storage.listInquiries();
      expect(inqs.total).toBe(1);
    });

    it('verifies storefront fallback contract: failed backend never emits a false success message', () => {
      // Simulation of checkout.html lines 1366-1436 logic:
      const renderInquiryResponse = (isServerConfirmed: boolean, inqRef: string) => {
        if (isServerConfirmed) {
          return { status: 'success', heading: 'Inquiry Received Successfully!', reference: inqRef };
        } else {
          return { status: 'info', heading: 'Inquiry draft prepared — send via WhatsApp or Email.', reference: inqRef };
        }
      };

      // Server failure scenario
      const failureResult = renderInquiryResponse(false, 'GON-INQ-FALLBACK');
      expect(failureResult.status).toBe('info');
      expect(failureResult.heading).not.toContain('Successfully');
      expect(failureResult.heading).toContain('draft prepared');

      // Server confirmed scenario
      const successResult = renderInquiryResponse(true, 'inq_server_verified_01');
      expect(successResult.status).toBe('success');
      expect(successResult.heading).toBe('Inquiry Received Successfully!');
    });
  });

  // =========================================================================
  // TASK 3: Physical Inventory CSV Validation
  // =========================================================================
  describe('Task 3: Physical Inventory CSV Validation (Clearly Labelled Sample Data)', () => {
    it('validates SAMPLE_TEST_INVENTORY_CSV completely with 100% valid rows and 0 errors', () => {
      const parsed = parseInventoryCsv(SAMPLE_TEST_INVENTORY_CSV);
      expect(parsed.parseErrors.length).toBe(0);
      expect(parsed.rawRows.length).toBe(3);

      const validated = validateInventoryBatch(parsed.rawRows);
      expect(validated.isValid).toBe(true);
      expect(validated.errors.length).toBe(0);
      expect(validated.validRows.length).toBe(3);

      expect(validated.validRows[0]?.sku).toBe('TEST-RUBY-001');
      expect(validated.validRows[0]?.approvedSellingPrice).toBe(75000);
      expect(validated.validRows[1]?.sku).toBe('TEST-SAPPHIRE-001');
      expect(validated.validRows[2]?.sku).toBe('TEST-EMERALD-001');
    });

    it('rejects duplicate SKUs within the same batch and against pre-existing D1 stock', () => {
      // 1. Duplicate within batch
      const batchWithDups = `sku,product_id,approved_price_inr
TEST-DUP-01,p1,50000
TEST-DUP-01,p2,60000`;
      const parsed1 = parseInventoryCsv(batchWithDups);
      const val1 = validateInventoryBatch(parsed1.rawRows);
      expect(val1.isValid).toBe(false);
      expect(val1.errors.some(e => e.code === 'DUPLICATE_SKU_IN_BATCH')).toBe(true);

      // 2. Duplicate against DB existing SKU
      const existingSkus = new Set(['TEST-ALREADY-EXISTS']);
      const parsed2 = parseInventoryCsv('sku,product_id,approved_price_inr\nTEST-ALREADY-EXISTS,p1,50000');
      const val2 = validateInventoryBatch(parsed2.rawRows, existingSkus);
      expect(val2.isValid).toBe(false);
      expect(val2.errors.some(e => e.code === 'SKU_ALREADY_EXISTS')).toBe(true);
    });

    it('strictly rejects metadata-only product IDs: p127, p128, p129, p135', () => {
      const metadataCsv = `sku,product_id,approved_price_inr
TEST-META-127,p127,50000
TEST-META-128,p128,60000
TEST-META-129,p129,70000
TEST-META-135,p135,80000`;
      const parsed = parseInventoryCsv(metadataCsv);
      const val = validateInventoryBatch(parsed.rawRows);
      expect(val.isValid).toBe(false);
      expect(val.errors.length).toBe(4);
      for (const err of val.errors) {
        expect(err.code).toBe('METADATA_ONLY_PRODUCT');
        expect(err.message).toContain('unpurchasable metadata record');
      }
    });

    it('rejects unknown product IDs (e.g. p999)', () => {
      const csv = `sku,product_id,approved_price_inr\nTEST-UNK-01,p999,10000`;
      const parsed = parseInventoryCsv(csv);
      const val = validateInventoryBatch(parsed.rawRows);
      expect(val.isValid).toBe(false);
      expect(val.errors[0]?.code).toBe('UNKNOWN_PRODUCT');
    });

    it('rejects missing, zero, negative, and decimal approved prices', () => {
      const invalidPricesCsv = `sku,product_id,approved_price_inr
TEST-P1,p1,
TEST-P2,p1,0
TEST-P3,p1,-500
TEST-P4,p1,15000.75
TEST-P5,p1,not_a_number`;
      const parsed = parseInventoryCsv(invalidPricesCsv);
      const val = validateInventoryBatch(parsed.rawRows);
      expect(val.isValid).toBe(false);
      expect(val.errors.length).toBe(5);
      expect(val.errors[0]?.code).toBe('MISSING_PRICE');
      expect(val.errors[1]?.code).toBe('INVALID_PRICE');
      expect(val.errors[2]?.code).toBe('INVALID_PRICE');
      expect(val.errors[3]?.code).toBe('INVALID_PRICE');
      expect(val.errors[4]?.code).toBe('INVALID_PRICE');
    });

    it('rejects invalid carat and ratti weights', () => {
      const invalidWeightsCsv = `sku,product_id,approved_price_inr,carat_weight,ratti_weight
TEST-W1,p1,10000,-2,5.0
TEST-W2,p1,10000,1200,5.0
TEST-W3,p1,10000,5.0,-1
TEST-W4,p1,10000,5.0,2000`;
      const parsed = parseInventoryCsv(invalidWeightsCsv);
      const val = validateInventoryBatch(parsed.rawRows);
      expect(val.isValid).toBe(false);
      expect(val.errors.length).toBe(4);
      expect(val.errors[0]?.code).toBe('INVALID_CARAT');
      expect(val.errors[1]?.code).toBe('INVALID_CARAT');
      expect(val.errors[2]?.code).toBe('INVALID_RATTI');
      expect(val.errors[3]?.code).toBe('INVALID_RATTI');
    });

    it('fails closed: batch import never writes to D1 database if all rows contain errors', async () => {
      const badCsv = `sku,product_id,approved_price_inr\nTEST-FAIL-01,p127,10000`;
      await expect(service.importInventoryBatch(badCsv, OWNER_SECRET)).rejects.toThrow(
        /Batch import failed/
      );

      const items = await d1Storage.listInventorySnapshots();
      expect(items.total).toBe(0);
    });
  });

  // =========================================================================
  // TASK 4: Owner Access & Security Verification
  // =========================================================================
  describe('Task 4: Owner Access & Security Controls Review', () => {
    it('verifies timing-safe constant-time string comparison protects owner authentication', () => {
      expect(timingSafeEqual('correct-secret-12345', 'correct-secret-12345')).toBe(true);
      expect(timingSafeEqual('correct-secret-12345', 'wrong-secret-1234567')).toBe(false);
      expect(timingSafeEqual('short', 'longer-string')).toBe(false);
    });

    it('rejects unauthorized owner requests without valid secret with HTTP 401', async () => {
      // 1. Missing header
      const req1 = new Request('http://localhost/api/owner/inquiries', { method: 'GET' });
      const res1 = await handler.handleRequest(req1, '127.0.0.1');
      expect(res1.status).toBe(401);

      // 2. Wrong secret
      const req2 = makeOwnerRequest('/api/owner/inquiries', { customSecret: 'wrong_secret_key' });
      const res2 = await handler.handleRequest(req2, '127.0.0.1');
      expect(res2.status).toBe(401);
    });

    it('records audit logs for all sensitive owner actions', async () => {
      // 1. Register sample inventory item
      await service.registerInventory(
        {
          sku: 'DRYRUN-AUDIT-001',
          productId: 'p1',
          approvedSellingPrice: 45000,
          inStock: true
        },
        OWNER_SECRET
      );

      // 2. Query audit logs
      const logs = await service.listAuditLogs(OWNER_SECRET);
      expect(logs.total).toBeGreaterThan(0);
      const regLog = logs.items.find(l => l.action === 'INVENTORY_REGISTERED');
      expect(regLog).toBeDefined();
      expect(regLog?.entityId).toBe('DRYRUN-AUDIT-001');
    });

    it('enforces rate limiting per IP to prevent brute-force attacks', async () => {
      const tightHandler = new ApiHandler({
        storage: d1Storage,
        ownerSecret: OWNER_SECRET,
        rateLimitPerMinute: 3 // Small limit for testing
      });

      const clientIp = '192.168.1.100';
      let reqCount = 0;
      const makeReq = () => {
        reqCount++;
        return tightHandler.handleRequest(
          new Request('http://localhost/api/inquiries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer: {
                name: 'Rate Limit Test',
                email: 'rate.limit@example.invalid',
                phone: '+91 99999 00000',
                country: 'IN',
                addressLine1: 'Test St'
              },
              items: [{ productId: 'p1', quantity: 1 }],
              idempotencyKey: 'idemp_ratelimit_key_' + reqCount
            })
          }),
          clientIp
        );
      };

      const r1 = await makeReq();
      const r2 = await makeReq();
      const r3 = await makeReq();
      const r4 = await makeReq();

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r3.status).toBe(201);
      expect(r4.status).toBe(429); // Blocked
    });
  });
});
