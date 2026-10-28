// src/backend/razorpay-client.ts
// Stage 3C: Razorpay API Client & Test Doubles

import type {
  IRazorpayClient,
  RazorpayOrderCreationParams,
  RazorpayOrderResponse,
  RazorpayPaymentDetails
} from './types';
import {
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
  hmacSha256
} from './crypto-utils';

export interface RazorpayClientConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly webhookSecret?: string;
  readonly baseUrl?: string;
}

/**
 * Production & Test-Mode HTTP client for the official Razorpay Orders & Payments API (v1).
 * Authenticates using HTTP Basic Auth over HTTPS with server-side Key ID and Key Secret.
 */
export class HttpRazorpayClient implements IRazorpayClient {
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;

  constructor(config: RazorpayClientConfig) {
    this.keyId = config.keyId?.trim() || '';
    this.keySecret = config.keySecret?.trim() || '';
    this.webhookSecret = config.webhookSecret?.trim() || '';
    this.baseUrl = (config.baseUrl || 'https://api.razorpay.com/v1').replace(/\/+$/, '');
  }

  private getAuthHeader(): string {
    const creds = `${this.keyId}:${this.keySecret}`;
    // Standard btoa works in Workers and modern runtimes
    const encoded = typeof btoa === 'function' ? btoa(creds) : Buffer.from(creds).toString('base64');
    return `Basic ${encoded}`;
  }

  public async createOrder(params: RazorpayOrderCreationParams): Promise<RazorpayOrderResponse> {
    if (!this.keyId || !this.keySecret) {
      throw new Error('Razorpay API credentials (KEY_ID / KEY_SECRET) are not configured.');
    }

    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader()
      },
      body: JSON.stringify({
        amount: params.amount,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        notes: params.notes || {}
      })
    });

    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      const err = new Error(
        `Razorpay order creation failed (HTTP ${res.status}): ${errBody?.error?.description || errBody?.message || 'Unknown error'}`
      );
      (err as any).status = res.status;
      (err as any).code = 'RAZORPAY_API_ERROR';
      (err as any).details = errBody;
      throw err;
    }

    return (await res.json()) as RazorpayOrderResponse;
  }

  public async fetchPayment(paymentId: string): Promise<RazorpayPaymentDetails> {
    if (!this.keyId || !this.keySecret) {
      throw new Error('Razorpay API credentials (KEY_ID / KEY_SECRET) are not configured.');
    }

    const res = await fetch(`${this.baseUrl}/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader()
      }
    });

    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      const err = new Error(
        `Razorpay payment lookup failed (HTTP ${res.status}): ${errBody?.error?.description || errBody?.message || 'Unknown error'}`
      );
      (err as any).status = res.status;
      (err as any).code = 'RAZORPAY_PAYMENT_NOT_FOUND';
      throw err;
    }

    return (await res.json()) as RazorpayPaymentDetails;
  }

  public async verifyCheckoutSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): Promise<boolean> {
    return verifyRazorpayCheckoutSignature(this.keySecret, orderId, paymentId, signature);
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return verifyRazorpayWebhookSignature(this.webhookSecret, rawBody, signature);
  }
}

/**
 * Deterministic In-Memory Mock Razorpay Client for automated testing.
 * Simulates order creation, signature verification, payment lookup, and controllable error modes.
 */
export class MockRazorpayClient implements IRazorpayClient {
  public keyId: string;
  public keySecret: string;
  public webhookSecret: string;

  public createdOrders: Map<string, RazorpayOrderResponse> = new Map();
  public payments: Map<string, RazorpayPaymentDetails> = new Map();
  public shouldFailCreateOrder = false;
  public shouldFailFetchPayment = false;
  public shouldTimeout = false;
  public failureMessage = 'Simulated Razorpay network error';
  public defaultPaymentStatus: 'captured' | 'authorized' | 'failed' = 'captured';

  constructor(
    keyId = 'rzp_test_mock_key_id',
    keySecret = 'rzp_test_mock_secret_key_2026',
    webhookSecret = 'rzp_test_mock_webhook_secret_2026'
  ) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
  }

  public async createOrder(params: RazorpayOrderCreationParams): Promise<RazorpayOrderResponse> {
    if (this.shouldTimeout) {
      const err = new Error('Gateway timeout while connecting to Razorpay');
      (err as any).code = 'GATEWAY_TIMEOUT';
      (err as any).status = 504;
      throw err;
    }

    if (this.shouldFailCreateOrder) {
      const err = new Error(this.failureMessage);
      (err as any).code = 'RAZORPAY_API_ERROR';
      (err as any).status = 500;
      throw err;
    }

    const orderId = `order_mock_${crypto.randomUUID().slice(0, 14)}`;
    const response: RazorpayOrderResponse = {
      id: orderId,
      entity: 'order',
      amount: params.amount,
      amount_paid: 0,
      amount_due: params.amount,
      currency: params.currency || 'INR',
      receipt: params.receipt,
      status: 'created',
      attempts: 0,
      notes: params.notes || {},
      created_at: Math.floor(Date.now() / 1000)
    };

    this.createdOrders.set(orderId, response);
    return response;
  }

  public async fetchPayment(paymentId: string): Promise<RazorpayPaymentDetails> {
    if (this.shouldTimeout) {
      const err = new Error('Gateway timeout while querying Razorpay payment');
      (err as any).code = 'GATEWAY_TIMEOUT';
      (err as any).status = 504;
      throw err;
    }

    if (this.shouldFailFetchPayment) {
      const err = new Error(this.failureMessage);
      (err as any).code = 'RAZORPAY_API_ERROR';
      (err as any).status = 500;
      throw err;
    }

    const existing = this.payments.get(paymentId);
    if (existing) return existing;

    // Default mock payment details matching created order if any
    let matchingOrderId = 'order_mock_default';
    let matchingAmount = 100000;
    if (this.createdOrders.size > 0) {
      const lastOrder = Array.from(this.createdOrders.values()).pop();
      if (lastOrder) {
        matchingOrderId = lastOrder.id;
        matchingAmount = lastOrder.amount;
      }
    }

    return {
      id: paymentId,
      entity: 'payment',
      amount: matchingAmount,
      currency: 'INR',
      status: this.defaultPaymentStatus,
      order_id: matchingOrderId,
      method: 'card'
    };
  }

  public async verifyCheckoutSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): Promise<boolean> {
    return verifyRazorpayCheckoutSignature(this.keySecret, orderId, paymentId, signature);
  }

  public async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    return verifyRazorpayWebhookSignature(this.webhookSecret, rawBody, signature);
  }

  /**
   * Helper to generate a valid checkout signature using the mock secret for test cases.
   */
  public async generateValidCheckoutSignature(orderId: string, paymentId: string): Promise<string> {
    return hmacSha256(this.keySecret, `${orderId}|${paymentId}`);
  }

  /**
   * Helper to generate a valid webhook signature using the mock webhook secret for test cases.
   */
  public async generateValidWebhookSignature(rawBody: string): Promise<string> {
    return hmacSha256(this.webhookSecret, rawBody);
  }
}
