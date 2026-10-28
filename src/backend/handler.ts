// src/backend/handler.ts
// Stage 3C: Standards-based HTTP API router with customer token verification, owner authorization, inventory APIs, and Razorpay payment endpoints

import { BackendService } from './service';
import type { BackendStorage } from './storage';
import type { ApiResponse, PaginationOptions, IRazorpayClient } from './types';
import { HttpRazorpayClient, MockRazorpayClient, type RazorpayClientConfig } from './razorpay-client';
import { timingSafeEqual } from './crypto-utils';

export interface HandlerOptions {
  readonly storage: BackendStorage;
  readonly allowedOrigin?: string;
  readonly rateLimitPerMinute?: number;
  readonly ownerSecret?: string;
  readonly razorpayClient?: IRazorpayClient;
  readonly razorpayConfig?: RazorpayClientConfig;
}

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export class ApiHandler {
  public static readonly MAX_BODY_BYTES = 65536; // 64 KB payload safeguard

  private readonly service: BackendService;
  private readonly storage: BackendStorage;
  private readonly allowedOrigin: string;
  private readonly rateLimitMax: number;
  private readonly ownerSecret: string;
  private readonly rateLimitMap = new Map<string, RateLimitBucket>();

  constructor(options: HandlerOptions) {
    this.storage = options.storage;
    this.ownerSecret = options.ownerSecret || 'test-owner-secret-stage3a';
    const rzpClient =
      options.razorpayClient ||
      (options.razorpayConfig && options.razorpayConfig.keyId && options.razorpayConfig.keySecret
        ? new HttpRazorpayClient(options.razorpayConfig)
        : new MockRazorpayClient());
    this.service = new BackendService(this.storage, this.ownerSecret, rzpClient);
    this.allowedOrigin = options.allowedOrigin || '*';
    this.rateLimitMax = options.rateLimitPerMinute || 60;
  }

  public getService(): BackendService {
    return this.service;
  }

  private corsHeaders(): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': this.allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Idempotency-Key, X-Owner-Key, X-Owner-Secret, X-Customer-Token, X-Razorpay-Signature',
      'Access-Control-Max-Age': '86400',
      'Content-Type': 'application/json; charset=utf-8'
    };
  }

  private jsonResponse<T>(status: number, body: ApiResponse<T>): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: this.corsHeaders()
    });
  }

  private checkRateLimit(clientIp: string): boolean {
    const now = Date.now();
    const bucket = this.rateLimitMap.get(clientIp);

    if (!bucket || now - bucket.windowStart > 60000) {
      this.rateLimitMap.set(clientIp, { count: 1, windowStart: now });
      return true;
    }

    if (bucket.count >= this.rateLimitMax) {
      return false;
    }

    bucket.count++;
    return true;
  }

  private extractOwnerSecret(req: Request): string | null {
    const auth = req.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      if (token === this.ownerSecret) return token;
    }
    const ownerKey = req.headers.get('X-Owner-Key') || req.headers.get('X-Owner-Secret');
    if (ownerKey) {
      return ownerKey.trim();
    }
    return null;
  }

  private extractCustomerToken(req: Request): string | null {
    const custToken = req.headers.get('X-Customer-Token');
    if (custToken) return custToken.trim();

    const auth = req.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      // If token is not the owner secret, treat as customer token
      if (token !== this.ownerSecret) {
        return token;
      }
    }
    return null;
  }

  private parsePaginationOptions(url: URL): PaginationOptions {
    const pageStr = url.searchParams.get('page');
    const limitStr = url.searchParams.get('limit');
    const status = url.searchParams.get('status') || undefined;
    const query = url.searchParams.get('q') || url.searchParams.get('query') || undefined;

    return {
      page: pageStr ? parseInt(pageStr, 10) : undefined,
      limit: limitStr ? parseInt(limitStr, 10) : undefined,
      status,
      query
    };
  }

  /**
   * Main dispatch entry point for Fetch-compliant environments (Cloudflare Workers, Node fetch adapter).
   */
  public async handleRequest(req: Request, clientIp = '127.0.0.1'): Promise<Response> {
    // 1. CORS Preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: this.corsHeaders()
      });
    }

    // 2. Rate Limiting Check (Per-isolate in memory)
    if (!this.checkRateLimit(clientIp)) {
      return this.jsonResponse(429, {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again in one minute.'
        }
      });
    }

    const url = new URL(req.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const ownerSecret = this.extractOwnerSecret(req);
    const customerToken = this.extractCustomerToken(req);

    try {
      // -------------------------------------------------------------
      // Health Check
      // -------------------------------------------------------------
      if (req.method === 'GET' && pathname === '/api/health') {
        return this.jsonResponse(200, {
          success: true,
          data: {
            status: 'HEALTHY',
            service: 'Gems of Nature V2 API',
            version: '3C.0',
            timestamp: new Date().toISOString()
          }
        });
      }

      // =============================================================
      // OWNER MANAGEMENT ROUTES (/api/owner/*)
      // =============================================================

      if (pathname.startsWith('/api/owner/')) {
        if (!ownerSecret || !timingSafeEqual(ownerSecret, this.ownerSecret)) {
          return this.jsonResponse(401, {
            success: false,
            error: {
              code: 'OWNER_AUTH_REQUIRED',
              message: 'Valid owner authorization required via Authorization header.'
            }
          });
        }

        // GET /api/owner/inquiries
        if (req.method === 'GET' && pathname === '/api/owner/inquiries') {
          const pagination = this.parsePaginationOptions(url);
          const result = await this.service.listInquiries(ownerSecret, pagination);
          return this.jsonResponse(200, { success: true, data: result });
        }

        // GET /api/owner/inquiries/:id
        if (req.method === 'GET' && pathname.startsWith('/api/owner/inquiries/') && !pathname.includes('/notes') && !pathname.includes('/status')) {
          const id = pathname.slice('/api/owner/inquiries/'.length);
          const inq = await this.service.getInquiry(id);
          if (!inq) {
            return this.jsonResponse(404, {
              success: false,
              error: { code: 'INQUIRY_NOT_FOUND', message: `Inquiry '${id}' not found.` }
            });
          }
          return this.jsonResponse(200, { success: true, data: inq });
        }

        // POST /api/owner/inquiries/:id/notes
        if (req.method === 'POST' && pathname.startsWith('/api/owner/inquiries/') && pathname.endsWith('/notes')) {
          const parts = pathname.split('/');
          const id = parts[4]!;
          const body = await this.parseJsonBody(req);
          const note = await this.service.addInquiryNote(id, body, ownerSecret);
          return this.jsonResponse(201, { success: true, data: note });
        }

        // POST /api/owner/inquiries/:id/status
        if (req.method === 'POST' && pathname.startsWith('/api/owner/inquiries/') && pathname.endsWith('/status')) {
          const parts = pathname.split('/');
          const id = parts[4]!;
          const body = await this.parseJsonBody(req);
          const updated = await this.service.updateInquiryStatus(id, body.status, ownerSecret);
          return this.jsonResponse(200, { success: true, data: updated });
        }

        // GET /api/owner/quotes
        if (req.method === 'GET' && pathname === '/api/owner/quotes') {
          const pagination = this.parsePaginationOptions(url);
          const result = await this.service.listShippingQuotes(ownerSecret, pagination);
          return this.jsonResponse(200, { success: true, data: result });
        }

        // POST /api/owner/quotes/:id/approve
        if (req.method === 'POST' && pathname.startsWith('/api/owner/quotes/') && pathname.endsWith('/approve')) {
          const parts = pathname.split('/');
          const quoteId = parts[4]!;
          const body = await this.parseJsonBody(req);
          const quote = await this.service.approveShippingQuote({
            quoteId,
            quotedAmount: body.quotedAmount,
            quotedCurrency: body.quotedCurrency || 'INR',
            validityHours: body.validityHours || 72,
            ownerSecret
          });
          return this.jsonResponse(200, { success: true, data: quote });
        }

        // POST /api/owner/quotes/:id/reject
        if (req.method === 'POST' && pathname.startsWith('/api/owner/quotes/') && pathname.endsWith('/reject')) {
          const parts = pathname.split('/');
          const quoteId = parts[4]!;
          const body = await this.parseJsonBody(req);
          const quote = await this.service.rejectShippingQuote({
            quoteId,
            reason: body.reason,
            ownerSecret
          });
          return this.jsonResponse(200, { success: true, data: quote });
        }

        // GET /api/owner/inventory/template (Download CSV template)
        if (req.method === 'GET' && pathname === '/api/owner/inventory/template') {
          const csv = this.service.getInventoryCsvTemplate();
          return new Response(csv, {
            status: 200,
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': 'attachment; filename="gon_inventory_template.csv"',
              ...this.corsHeaders()
            }
          });
        }

        // POST /api/owner/inventory/batch-validate (Validate batch before import)
        if (req.method === 'POST' && pathname === '/api/owner/inventory/batch-validate') {
          const body = await this.parseJsonBody(req);
          const validation = await this.service.validateInventoryBatch(body, ownerSecret);
          return this.jsonResponse(200, { success: true, data: validation });
        }

        // POST /api/owner/inventory/batch (Execute batch import)
        if (req.method === 'POST' && pathname === '/api/owner/inventory/batch') {
          const body = await this.parseJsonBody(req);
          const result = await this.service.importInventoryBatch(body, ownerSecret);
          return this.jsonResponse(201, { success: true, data: result });
        }

        // GET /api/owner/inventory
        if (req.method === 'GET' && pathname === '/api/owner/inventory') {
          const pagination = this.parsePaginationOptions(url);
          const result = await this.service.listInventory(ownerSecret, pagination);
          return this.jsonResponse(200, { success: true, data: result });
        }

        // POST /api/owner/inventory
        if (req.method === 'POST' && pathname === '/api/owner/inventory') {
          const body = await this.parseJsonBody(req);
          const snapshot = await this.service.registerInventory(body, ownerSecret);
          return this.jsonResponse(201, { success: true, data: snapshot });
        }

        // PUT /api/owner/inventory/:sku
        if (req.method === 'PUT' && pathname.startsWith('/api/owner/inventory/')) {
          const sku = pathname.slice('/api/owner/inventory/'.length);
          const body = await this.parseJsonBody(req);
          const updated = await this.service.updateInventory(sku, body, ownerSecret);
          return this.jsonResponse(200, { success: true, data: updated });
        }

        // GET /api/owner/audit-logs
        if (req.method === 'GET' && pathname === '/api/owner/audit-logs') {
          const pagination = this.parsePaginationOptions(url);
          const result = await this.service.listAuditLogs(ownerSecret, pagination);
          return this.jsonResponse(200, { success: true, data: result });
        }
      }

      // =============================================================
      // CUSTOMER & PUBLIC ROUTES (/api/*)
      // =============================================================

      // POST /api/inquiries (Public customer submission)
      if (req.method === 'POST' && pathname === '/api/inquiries') {
        const body = await this.parseJsonBody(req);
        const inquiry = await this.service.createInquiry(body);
        return this.jsonResponse(201, { success: true, data: inquiry });
      }

      // GET /api/inquiries/:id (Protected: requires Customer Token or Owner Secret)
      if (req.method === 'GET' && pathname.startsWith('/api/inquiries/')) {
        const id = pathname.slice('/api/inquiries/'.length);
        const inq = await this.service.getInquiry(id);
        if (!inq) {
          return this.jsonResponse(404, {
            success: false,
            error: { code: 'INQUIRY_NOT_FOUND', message: `Inquiry '${id}' not found.` }
          });
        }

        const access = await this.service.verifyAccess('INQUIRY', id, customerToken, ownerSecret);
        if (!access.authorized) {
          return this.jsonResponse(401, {
            success: false,
            error: {
              code: 'CUSTOMER_AUTH_REQUIRED',
              message: 'A valid customer access token is required to view this inquiry.'
            }
          });
        }
        return this.jsonResponse(200, { success: true, data: inq });
      }

      // POST /api/quotes (Public customer quote request)
      if (req.method === 'POST' && pathname === '/api/quotes') {
        const body = await this.parseJsonBody(req);
        const quote = await this.service.createShippingQuote(body);
        return this.jsonResponse(201, { success: true, data: quote });
      }

      // Backward-compatible POST /api/quotes/:id/approve (Owner only)
      if (req.method === 'POST' && pathname.startsWith('/api/quotes/') && pathname.endsWith('/approve')) {
        const parts = pathname.split('/');
        const quoteId = parts[3]!;
        const body = await this.parseJsonBody(req);
        const secret = ownerSecret || (typeof body === 'object' && body ? (body as any).ownerSecret : null);
        if (!secret || !timingSafeEqual(secret, this.ownerSecret)) {
          return this.jsonResponse(401, {
            success: false,
            error: { code: 'OWNER_AUTH_REQUIRED', message: 'Owner credentials required.' }
          });
        }
        const quote = await this.service.approveShippingQuote({
          quoteId,
          quotedAmount: body.quotedAmount,
          quotedCurrency: body.quotedCurrency || 'INR',
          validityHours: body.validityHours || 72,
          ownerSecret: secret
        });
        return this.jsonResponse(200, { success: true, data: quote });
      }

      // POST /api/quotes/:id/accept (Customer acceptance using customer access token)
      if (req.method === 'POST' && pathname.startsWith('/api/quotes/') && pathname.endsWith('/accept')) {
        const parts = pathname.split('/');
        const quoteId = parts[3]!;
        const body = await this.parseJsonBody(req);
        const effectiveToken = customerToken || (typeof body === 'object' && body ? ((body as any).customerToken || (body as any).customerAccessToken || (body as any).token) : null);
        if (!effectiveToken) {
          return this.jsonResponse(401, {
            success: false,
            error: {
              code: 'CUSTOMER_TOKEN_REQUIRED',
              message: 'A valid customer access token is required to accept this quote.'
            }
          });
        }
        const quote = await this.service.acceptShippingQuote(quoteId, effectiveToken);
        return this.jsonResponse(200, { success: true, data: quote });
      }

      // GET /api/quotes/:id (Protected: requires Customer Token or Owner Secret)
      if (req.method === 'GET' && pathname.startsWith('/api/quotes/')) {
        const id = pathname.slice('/api/quotes/'.length);
        const quote = await this.service.getShippingQuote(id);
        if (!quote) {
          return this.jsonResponse(404, {
            success: false,
            error: { code: 'QUOTE_NOT_FOUND', message: `Quote '${id}' not found.` }
          });
        }

        const access = await this.service.verifyAccess('QUOTE', id, customerToken, ownerSecret);
        if (!access.authorized) {
          return this.jsonResponse(401, {
            success: false,
            error: {
              code: 'CUSTOMER_AUTH_REQUIRED',
              message: 'A valid customer access token is required to view this quote.'
            }
          });
        }
        return this.jsonResponse(200, { success: true, data: quote });
      }

      // POST /api/orders (Public order request: fails closed on provisional items)
      if (req.method === 'POST' && pathname === '/api/orders') {
        const body = await this.parseJsonBody(req);
        const order = await this.service.createOrder(body);
        return this.jsonResponse(201, { success: true, data: order });
      }

      // GET /api/orders/:id (Protected: requires Customer Token or Owner Secret)
      if (req.method === 'GET' && pathname.startsWith('/api/orders/')) {
        const id = pathname.slice('/api/orders/'.length);
        const order = await this.storage.getOrderById(id);
        if (!order) {
          return this.jsonResponse(404, {
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: `Order '${id}' not found.` }
          });
        }

        const access = await this.service.verifyAccess('ORDER', id, customerToken, ownerSecret);
        if (!access.authorized) {
          return this.jsonResponse(401, {
            success: false,
            error: {
              code: 'CUSTOMER_AUTH_REQUIRED',
              message: 'A valid customer access token is required to view this order.'
            }
          });
        }
        return this.jsonResponse(200, { success: true, data: order });
      }

      // =============================================================
      // PAYMENT ROUTES (/api/payments/*) (STAGE 3C)
      // =============================================================

      // POST /api/payments/create-order
      if (req.method === 'POST' && pathname === '/api/payments/create-order') {
        const body = await this.parseJsonBody(req);
        const result = await this.service.createPaymentOrder(body, customerToken);
        return this.jsonResponse(201, { success: true, data: result });
      }

      // POST /api/payments/verify
      if (req.method === 'POST' && pathname === '/api/payments/verify') {
        const body = await this.parseJsonBody(req);
        const effectiveToken =
          customerToken ||
          (body && typeof body === 'object' ? (body as any).customerAccessToken : null);
        const result = await this.service.verifyCheckoutPayment(body, effectiveToken);
        return this.jsonResponse(200, { success: true, data: result });
      }

      // POST /api/payments/webhook (Raw body required for HMAC verification)
      if (req.method === 'POST' && pathname === '/api/payments/webhook') {
        const rawBody = await req.text();
        if (rawBody && rawBody.length > ApiHandler.MAX_BODY_BYTES) {
          return this.jsonResponse(413, {
            success: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: 'Webhook payload exceeds maximum size.'
            }
          });
        }
        const signature = req.headers.get('x-razorpay-signature');
        const result = await this.service.processWebhook(rawBody, signature);
        return this.jsonResponse(200, { success: true, data: result });
      }

      // 404 Route Not Found
      return this.jsonResponse(404, {
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: `Endpoint ${req.method} ${pathname} does not exist.`
        }
      });
    } catch (err: any) {
      const status = typeof err.status === 'number' ? err.status : 500;
      const code = err.code || (status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
      return this.jsonResponse(status, {
        success: false,
        error: {
          code,
          message: err.message || 'An unexpected error occurred.',
          details: err.details
        }
      });
    }
  }

  private async parseJsonBody(req: Request): Promise<any> {
    try {
      const text = await req.text();
      if (text && text.length > ApiHandler.MAX_BODY_BYTES) {
        const err = new Error('Request payload exceeds maximum allowed size (64KB).');
        (err as any).status = 413;
        (err as any).code = 'PAYLOAD_TOO_LARGE';
        throw err;
      }
      if (!text || !text.trim()) {
        return {};
      }
      return JSON.parse(text);
    } catch (e: any) {
      if (e.status === 413) {
        throw e;
      }
      const err = new Error('Invalid JSON payload');
      (err as any).status = 400;
      (err as any).code = 'MALFORMED_JSON';
      throw err;
    }
  }
}
