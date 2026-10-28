import { describe, it, expect, beforeEach } from 'vitest';
import { ApiHandler } from '../../src/backend/handler';
import { MemoryBackendStorage } from '../../src/backend/storage';
import { BackendService } from '../../src/backend/service';

describe('Stage 3B: Owner Inventory & Inquiry Management Tests', () => {
  const OWNER_SECRET = 'gon_owner_super_secret_test_key_2026';
  let storage: MemoryBackendStorage;
  let service: BackendService;
  let handler: ApiHandler;

  beforeEach(() => {
    storage = new MemoryBackendStorage();
    service = new BackendService(storage, OWNER_SECRET);
    handler = new ApiHandler({
      storage,
      ownerSecret: OWNER_SECRET
    });
  });

  // Helper for authenticated owner requests
  function makeOwnerRequest(
    pathname: string,
    options: {
      method?: string;
      body?: unknown;
      headerType?: 'bearer' | 'x-key' | 'x-secret';
      customSecret?: string;
    } = {}
  ): Request {
    const method = options.method || 'GET';
    const secret = options.customSecret !== undefined ? options.customSecret : OWNER_SECRET;
    const headers: Record<string, string> = {};

    if (secret) {
      const type = options.headerType || 'bearer';
      if (type === 'bearer') {
        headers['Authorization'] = `Bearer ${secret}`;
      } else if (type === 'x-key') {
        headers['X-Owner-Key'] = secret;
      } else {
        headers['X-Owner-Secret'] = secret;
      }
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
  // 1. Authorization, Security & Customer Token Protection
  // =========================================================================
  describe('1. Security & Authorization Controls', () => {
    it('strictly rejects owner endpoints without credentials (HTTP 401)', async () => {
      const endpoints = [
        { path: '/api/owner/inquiries', method: 'GET' },
        { path: '/api/owner/quotes', method: 'GET' },
        { path: '/api/owner/inventory', method: 'GET' },
        { path: '/api/owner/audit-logs', method: 'GET' },
        { path: '/api/owner/inventory', method: 'POST', body: {} }
      ];

      for (const ep of endpoints) {
        const req = new Request(`http://localhost${ep.path}`, {
          method: ep.method,
          headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
          body: ep.body ? JSON.stringify(ep.body) : undefined
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error.code).toBe('OWNER_AUTH_REQUIRED');
      }
    });

    it('strictly rejects owner endpoints with invalid credentials (HTTP 401)', async () => {
      const req = makeOwnerRequest('/api/owner/inquiries', {
        customSecret: 'completely-wrong-password'
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe('OWNER_AUTH_REQUIRED');
    });

    it('strictly ignores secrets passed in query parameters (HTTP 401)', async () => {
      const req = new Request(`http://localhost/api/owner/inquiries?secret=${OWNER_SECRET}`, {
        method: 'GET'
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(401);
    });

    it('accepts valid credentials via all three authorized header forms', async () => {
      const forms: Array<'bearer' | 'x-key' | 'x-secret'> = ['bearer', 'x-key', 'x-secret'];
      for (const form of forms) {
        const req = makeOwnerRequest('/api/owner/inquiries', { headerType: form });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
      }
    });

    it('protects customer inquiries against unauthorized inspection without token', async () => {
      const inq = await service.createInquiry({
        customer: { name: 'Priya Sharma', email: 'priya@example.com', country: 'IN' },
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_auth_test_01'
      });

      // No token -> 401
      const reqNoToken = new Request(`http://localhost/api/inquiries/${inq.id}`);
      const resNoToken = await handler.handleRequest(reqNoToken);
      expect(resNoToken.status).toBe(401);

      // Wrong token -> 401
      const reqWrongToken = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        headers: { 'X-Customer-Token': 'wrong_customer_token_999' }
      });
      const resWrongToken = await handler.handleRequest(reqWrongToken);
      expect(resWrongToken.status).toBe(401);

      // Valid customer access token -> 200
      const reqValid = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        headers: { 'X-Customer-Token': inq.customerAccessToken! }
      });
      const resValid = await handler.handleRequest(reqValid);
      expect(resValid.status).toBe(200);
      const data = await resValid.json();
      expect(data.data.id).toBe(inq.id);

      // Authenticated Owner can also access directly -> 200
      const reqOwner = makeOwnerRequest(`/api/inquiries/${inq.id}`);
      const resOwner = await handler.handleRequest(reqOwner);
      expect(resOwner.status).toBe(200);
    });

    it('rejects expired customer tokens (HTTP 401)', async () => {
      const inq = await service.createInquiry({
        customer: { name: 'Priya Sharma', email: 'priya@example.com', country: 'IN' },
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_expired_token_01'
      });

      // Manually expire token
      await storage.saveCustomerToken({
        id: 'tok_test_expired_01',
        token: inq.customerAccessToken!,
        resourceType: 'INQUIRY',
        resourceId: inq.id,
        customerEmail: inq.customerEmail,
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 2000
      });

      const req = new Request(`http://localhost/api/inquiries/${inq.id}`, {
        headers: { 'X-Customer-Token': inq.customerAccessToken! }
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. Owner Inquiry Management
  // =========================================================================
  describe('2. Owner Inquiry Management', () => {
    let inq1Id: string;
    let inq2Id: string;

    beforeEach(async () => {
      const inq1 = await service.createInquiry({
        customer: { name: 'Amitabh Bachchan', email: 'amitabh@bollywood.in', phone: '+91 98200 11111', country: 'IN' },
        items: [{ productId: 'p1', quantity: 1 }, { productId: 'p2', quantity: 2 }],
        notes: 'Looking for natural untreated yellow sapphire and ruby for astrological wear.',
        idempotencyKey: 'idemp_inq_amitabh_01'
      });
      inq1Id = inq1.id;

      const inq2 = await service.createInquiry({
        customer: { name: 'Devendra Joshi', email: 'devendra@pune.org', country: 'IN' },
        items: [{ productId: 'p3', quantity: 1 }],
        idempotencyKey: 'idemp_inq_devendra_02'
      });
      inq2Id = inq2.id;
    });

    it('lists inquiries with pagination and search filtering', async () => {
      // List all
      const reqAll = makeOwnerRequest('/api/owner/inquiries?page=1&limit=10');
      const resAll = await handler.handleRequest(reqAll);
      expect(resAll.status).toBe(200);
      const dataAll = await resAll.json();
      expect(dataAll.data.total).toBe(2);
      expect(dataAll.data.items.length).toBe(2);

      // Search by query
      const reqSearch = makeOwnerRequest('/api/owner/inquiries?q=Amitabh');
      const resSearch = await handler.handleRequest(reqSearch);
      const dataSearch = await resSearch.json();
      expect(dataSearch.data.total).toBe(1);
      expect(dataSearch.data.items[0].id).toBe(inq1Id);
      expect(dataSearch.data.items[0].customerName).toBe('Amitabh Bachchan');
    });

    it('retrieves complete inquiry details with item snapshots and notes', async () => {
      const req = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}`);
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      const inquiry = data.data;

      expect(inquiry.id).toBe(inq1Id);
      expect(inquiry.customerName).toBe('Amitabh Bachchan');
      expect(inquiry.items.length).toBe(2);

      // Item bounds snapshot check
      const itemP1 = inquiry.items.find((i: any) => i.productId === 'p1');
      expect(itemP1.provisionalMinUnit).toBe(40000);
      expect(itemP1.provisionalMaxUnit).toBe(200000);
      expect(itemP1.quantity).toBe(1);
    });

    it('adds internal owner notes and returns them in chronological order', async () => {
      // Add first note
      const note1Req = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/notes`, {
        method: 'POST',
        body: { note: 'Contacted client via WhatsApp. Preferred weight is 5+ carats.', author: 'Owner Paramjeet' }
      });
      const note1Res = await handler.handleRequest(note1Req);
      expect(note1Res.status).toBe(201);
      const note1Data = await note1Res.json();
      expect(note1Data.data.note).toContain('Preferred weight is 5+ carats');
      expect(note1Data.data.author).toBe('Owner Paramjeet');

      // Add second note
      const note2Req = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/notes`, {
        method: 'POST',
        body: { note: 'Selected lot SKU-PUKHRAJ-5CT for inspection.', author: 'Gemologist Team' }
      });
      const note2Res = await handler.handleRequest(note2Req);
      expect(note2Res.status).toBe(201);

      // Retrieve inquiry and verify notes are appended
      const reqDetail = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}`);
      const resDetail = await handler.handleRequest(reqDetail);
      const detail = await resDetail.json();
      expect(detail.data.internalNotes.length).toBe(2);
      expect(detail.data.internalNotes[0].author).toBe('Owner Paramjeet');
      expect(detail.data.internalNotes[1].author).toBe('Gemologist Team');
    });

    it('validates inquiry notes (rejects empty or excessively long notes)', async () => {
      // Empty note
      const reqEmpty = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/notes`, {
        method: 'POST',
        body: { note: '', author: 'Owner' }
      });
      const resEmpty = await handler.handleRequest(reqEmpty);
      expect(resEmpty.status).toBe(400);

      // Excessively long note (>2000 chars)
      const reqLong = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/notes`, {
        method: 'POST',
        body: { note: 'X'.repeat(2500), author: 'Owner' }
      });
      const resLong = await handler.handleRequest(reqLong);
      expect(resLong.status).toBe(400);
    });

    it('transitions inquiry status through allowed lifecycle', async () => {
      // PENDING_REVIEW -> PRICE_QUOTED
      const req1 = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/status`, {
        method: 'POST',
        body: { status: 'PRICE_QUOTED' }
      });
      const res1 = await handler.handleRequest(req1);
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.data.status).toBe('PRICE_QUOTED');

      // PRICE_QUOTED -> CUSTOMER_CONTACTED
      const req2 = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/status`, {
        method: 'POST',
        body: { status: 'CUSTOMER_CONTACTED' }
      });
      const res2 = await handler.handleRequest(req2);
      expect(res2.status).toBe(200);

      // CUSTOMER_CONTACTED -> CLOSED
      const req3 = makeOwnerRequest(`/api/owner/inquiries/${inq1Id}/status`, {
        method: 'POST',
        body: { status: 'CLOSED' }
      });
      const res3 = await handler.handleRequest(req3);
      expect(res3.status).toBe(200);
    });

    it('strictly rejects illegal status transitions (HTTP 422)', async () => {
      // Direct jump from PENDING_REVIEW -> CLOSED is illegal
      const reqIllegal = makeOwnerRequest(`/api/owner/inquiries/${inq2Id}/status`, {
        method: 'POST',
        body: { status: 'CLOSED' }
      });
      const resIllegal = await handler.handleRequest(reqIllegal);
      expect(resIllegal.status).toBe(422);
      const err = await resIllegal.json();
      expect(err.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('allows cancelling an inquiry from any non-terminal state', async () => {
      const reqCancel = makeOwnerRequest(`/api/owner/inquiries/${inq2Id}/status`, {
        method: 'POST',
        body: { status: 'CANCELLED' }
      });
      const resCancel = await handler.handleRequest(reqCancel);
      expect(resCancel.status).toBe(200);
      const data = await resCancel.json();
      expect(data.data.status).toBe('CANCELLED');

      // Cannot reopen once CANCELLED
      const reqReopen = makeOwnerRequest(`/api/owner/inquiries/${inq2Id}/status`, {
        method: 'POST',
        body: { status: 'PENDING_REVIEW' }
      });
      const resReopen = await handler.handleRequest(reqReopen);
      expect(resReopen.status).toBe(422);
    });
  });

  // =========================================================================
  // 3. International Shipping Quote Management
  // =========================================================================
  describe('3. International Shipping Quote Management', () => {
    let quoteId: string;
    let customerAccessToken: string;

    beforeEach(async () => {
      const quote = await service.createShippingQuote({
        customerEmail: 'intl.buyer@london.co.uk',
        destinationCountry: 'GB',
        destinationPostalCode: 'EC1A 1BB',
        destinationAddress: '10 Downing St, London',
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_intl_quote_gb_01'
      });
      quoteId = quote.id;
      customerAccessToken = quote.customerAccessToken!;
    });

    it('lists shipping quotes with status filtering for owner', async () => {
      const req = makeOwnerRequest('/api/owner/quotes?status=REQUESTED');
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.items.length).toBeGreaterThan(0);
      expect(data.data.items[0].id).toBe(quoteId);
      expect(data.data.items[0].status).toBe('REQUESTED');
    });

    it('allows owner to approve shipping quote with INR fee and validity hours', async () => {
      const req = makeOwnerRequest(`/api/owner/quotes/${quoteId}/approve`, {
        method: 'POST',
        body: { quotedAmount: 3800, quotedCurrency: 'INR', validityHours: 48 }
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe('APPROVED_BY_OWNER');
      expect(data.data.quotedAmount).toBe(3800);
      expect(data.data.quotedCurrency).toBe('INR');
      expect(data.data.expiresAt).toBeGreaterThan(Date.now());
    });

    it('allows customer to accept approved quote using customer access token', async () => {
      // First approve
      await service.approveShippingQuote({
        quoteId,
        quotedAmount: 3500,
        quotedCurrency: 'INR',
        validityHours: 72,
        ownerSecret: OWNER_SECRET
      });

      // Customer accepts with token
      const reqAccept = new Request(`http://localhost/api/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Token': customerAccessToken
        }
      });
      const resAccept = await handler.handleRequest(reqAccept);
      expect(resAccept.status).toBe(200);
      const data = await resAccept.json();
      expect(data.data.status).toBe('ACCEPTED_BY_CUSTOMER');
      expect(data.data.acceptedAt).toBeDefined();

      // Duplicate acceptance is idempotent and succeeds
      const resDup = await handler.handleRequest(reqAccept);
      expect(resDup.status).toBe(200);
    });

    it('rejects shipping quote with reason and prevents future acceptance', async () => {
      // Reject by owner
      const reqReject = makeOwnerRequest(`/api/owner/quotes/${quoteId}/reject`, {
        method: 'POST',
        body: { reason: 'Destination postal code is currently unreachable by express courier.' }
      });
      const resReject = await handler.handleRequest(reqReject);
      expect(resReject.status).toBe(200);
      const data = await resReject.json();
      expect(data.data.status).toBe('REJECTED');
      expect(data.data.rejectionReason).toContain('unreachable by express courier');

      // Customer attempt to accept rejected quote must fail (HTTP 409)
      const reqAccept = new Request(`http://localhost/api/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Token': customerAccessToken
        }
      });
      const resAccept = await handler.handleRequest(reqAccept);
      expect(resAccept.status).toBe(409);
    });

    it('fails quote rejection if reason is missing or too short', async () => {
      const reqInvalid = makeOwnerRequest(`/api/owner/quotes/${quoteId}/reject`, {
        method: 'POST',
        body: { reason: '' }
      });
      const resInvalid = await handler.handleRequest(reqInvalid);
      expect(resInvalid.status).toBe(400);
    });
  });

  // =========================================================================
  // 4. Physical Gemstone Inventory Management
  // =========================================================================
  describe('4. Physical Gemstone Inventory Management', () => {
    const validGem: Record<string, unknown> = {
      sku: 'SKU-PUKHRAJ-5CT-001',
      productId: 'p1',
      approvedSellingPrice: 52000,
      currency: 'INR',
      inStock: true,
      caratWeight: 5.15,
      certLab: 'GIA',
      certNumber: 'GIA-2233445566',
      certStatus: 'CERTIFIED',
      origin: 'Ceylon, Sri Lanka',
      treatment: 'Unheated / Untreated Natural Sapphire',
      dimensions: '11.2 x 9.4 x 6.1 mm',
      colorGrade: 'Vibrant Canary Yellow'
    };

    it('registers physical gemstone inventory with full gemological attributes', async () => {
      const req = makeOwnerRequest('/api/owner/inventory', {
        method: 'POST',
        body: validGem
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.sku).toBe('SKU-PUKHRAJ-5CT-001');
      expect(data.data.productId).toBe('p1');
      expect(data.data.approvedSellingPrice).toBe(52000);
      expect(data.data.currency).toBe('INR');
      expect(data.data.caratWeight).toBe(5.15);
      expect(data.data.certStatus).toBe('CERTIFIED');
      expect(data.data.certLab).toBe('GIA');
    });

    it('strictly prevents duplicate SKU registration (HTTP 409)', async () => {
      // First registration
      const req1 = makeOwnerRequest('/api/owner/inventory', {
        method: 'POST',
        body: validGem
      });
      const res1 = await handler.handleRequest(req1);
      expect(res1.status).toBe(201);

      // Duplicate registration with same SKU
      const reqDup = makeOwnerRequest('/api/owner/inventory', {
        method: 'POST',
        body: validGem
      });
      const resDup = await handler.handleRequest(reqDup);
      expect(resDup.status).toBe(409);
      const err = await resDup.json();
      expect(err.error.code).toBe('SKU_ALREADY_EXISTS');
    });

    it('strictly rejects non-purchasable / metadata-only product IDs: p127, p128, p129, p135', async () => {
      const metaIds = ['p127', 'p128', 'p129', 'p135'];
      for (const metaId of metaIds) {
        const req = makeOwnerRequest('/api/owner/inventory', {
          method: 'POST',
          body: {
            ...validGem,
            sku: `SKU-META-${metaId.toUpperCase()}-01`,
            productId: metaId
          }
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(400);
        const err = await res.json();
        expect(err.error.details.some((d: any) => d.code === 'METADATA_ONLY_PRODUCT')).toBe(true);
      }
    });

    it('strictly rejects unknown product IDs not in catalogue', async () => {
      const req = makeOwnerRequest('/api/owner/inventory', {
        method: 'POST',
        body: {
          ...validGem,
          sku: 'SKU-UNKNOWN-999',
          productId: 'fake_product_id'
        }
      });
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.error.details.some((d: any) => d.code === 'UNKNOWN_PRODUCT')).toBe(true);
    });

    it('strictly rejects non-positive or non-integer prices', async () => {
      const invalidPrices = [0, -100, 450.5, '5000', null];
      for (const p of invalidPrices) {
        const req = makeOwnerRequest('/api/owner/inventory', {
          method: 'POST',
          body: {
            ...validGem,
            sku: `SKU-PRICE-TEST-${String(p).replace(/[^a-zA-Z0-9]/g, '_')}`,
            approvedSellingPrice: p
          }
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(400);
      }
    });

    it('strictly rejects invalid SKU formats', async () => {
      const invalidSkus = ['ab', 'with spaces', 'lowercase_sku', 'SKU@SPECIAL!'];
      for (const badSku of invalidSkus) {
        const req = makeOwnerRequest('/api/owner/inventory', {
          method: 'POST',
          body: {
            ...validGem,
            sku: badSku
          }
        });
        const res = await handler.handleRequest(req);
        expect(res.status).toBe(400);
      }
    });

    it('updates physical inventory item attributes and toggles inStock', async () => {
      await service.registerInventory(validGem as any, OWNER_SECRET);

      const reqUpdate = makeOwnerRequest(`/api/owner/inventory/${validGem.sku}`, {
        method: 'PUT',
        body: {
          approvedSellingPrice: 54000,
          inStock: false
        }
      });
      const resUpdate = await handler.handleRequest(reqUpdate);
      expect(resUpdate.status).toBe(200);
      const data = await resUpdate.json();
      expect(data.data.approvedSellingPrice).toBe(54000);
      expect(data.data.inStock).toBe(false);
    });

    it('blocks inventory price mutations when unresolved pending orders exist (HTTP 409)', async () => {
      await service.registerInventory(validGem as any, OWNER_SECRET);

      // Create an order in PENDING_PAYMENT status referencing this SKU
      await service.createOrder({
        customer: {
          name: 'Vikram Seth',
          email: 'vikram@delhi.in',
          phone: '+91 99999 11111',
          country: 'IN',
          addressLine1: 'Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
          postalCode: '110001'
        },
        items: [{ productId: 'p1', inventorySku: validGem.sku as string, quantity: 1 }],
        idempotencyKey: 'idemp_order_pending_guard_01'
      });

      // Attempt to change price of this SKU
      const reqPriceChange = makeOwnerRequest(`/api/owner/inventory/${validGem.sku}`, {
        method: 'PUT',
        body: { approvedSellingPrice: 60000 }
      });
      const resPriceChange = await handler.handleRequest(reqPriceChange);
      expect(resPriceChange.status).toBe(409);
      const err = await resPriceChange.json();
      expect(err.error.code).toBe('SKU_HAS_PENDING_ORDERS');

      // Toggling inStock without changing price is allowed
      const reqStockToggle = makeOwnerRequest(`/api/owner/inventory/${validGem.sku}`, {
        method: 'PUT',
        body: { inStock: false }
      });
      const resStockToggle = await handler.handleRequest(reqStockToggle);
      expect(resStockToggle.status).toBe(200);
    });

    it('lists inventory with pagination and stock filtering', async () => {
      await service.registerInventory(validGem as any, OWNER_SECRET);
      await service.registerInventory({
        ...validGem,
        sku: 'SKU-RUBY-3CT-001',
        productId: 'p2',
        approvedSellingPrice: 75000,
        inStock: true
      } as any, OWNER_SECRET);

      const req = makeOwnerRequest('/api/owner/inventory?page=1&limit=10');
      const res = await handler.handleRequest(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.total).toBe(2);
      expect(data.data.items.length).toBe(2);
    });
  });

  // =========================================================================
  // 5. Audit Logging & Owner Dashboard Integrity
  // =========================================================================
  describe('5. Audit Logs & Dashboard Verification', () => {
    it('creates auditable event logs for owner actions and supports filtering', async () => {
      // 1. Create inquiry (triggers INQUIRY_CREATED audit)
      const inq = await service.createInquiry({
        customer: { name: 'Audit Customer', email: 'audit@test.com', country: 'IN' },
        items: [{ productId: 'p1', quantity: 1 }],
        idempotencyKey: 'idemp_audit_test_01'
      });

      // 2. Add owner note (triggers NOTE_ADDED audit)
      await service.addInquiryNote(inq.id, { note: 'Verification call complete', author: 'Owner' }, OWNER_SECRET);

      // 3. Register inventory (triggers INVENTORY_REGISTERED audit)
      await service.registerInventory({
        sku: 'SKU-AUDIT-STONE-01',
        productId: 'p1',
        approvedSellingPrice: 32000,
        currency: 'INR',
        inStock: true
      } as any, OWNER_SECRET);

      // 4. Retrieve audit logs for owner
      const reqLogs = makeOwnerRequest('/api/owner/audit-logs?limit=20');
      const resLogs = await handler.handleRequest(reqLogs);
      expect(resLogs.status).toBe(200);
      const dataLogs = await resLogs.json();

      expect(dataLogs.data.items.length).toBeGreaterThanOrEqual(3);
      const actions = dataLogs.data.items.map((i: any) => i.action);
      expect(actions).toContain('INQUIRY_CREATED');
      expect(actions).toContain('INQUIRY_NOTE_ADDED');
      expect(actions).toContain('INVENTORY_REGISTERED');
    });
  });
});
