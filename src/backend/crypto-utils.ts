// src/backend/crypto-utils.ts
// Stage 3C: Cryptographic & Signature Verification Utilities for Razorpay

/**
 * Computes an HMAC-SHA256 hex digest using the standard Web Cryptography API.
 * Compatible with Cloudflare Workers, Node.js 18+, and modern browsers.
 */
export async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Performs a constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verifies the Razorpay Checkout payment signature.
 * Payload formula: `${razorpay_order_id}|${razorpay_payment_id}`
 */
export async function verifyRazorpayCheckoutSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string
): Promise<boolean> {
  if (!keySecret || !orderId || !paymentId || !signature) {
    return false;
  }

  const payload = `${orderId.trim()}|${paymentId.trim()}`;
  const expectedSignature = await hmacSha256(keySecret.trim(), payload);
  return timingSafeEqual(expectedSignature.toLowerCase(), signature.trim().toLowerCase());
}

/**
 * Verifies the Razorpay Webhook signature against the unmodified raw request body.
 */
export async function verifyRazorpayWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string
): Promise<boolean> {
  if (!webhookSecret || typeof rawBody !== 'string' || !signature) {
    return false;
  }

  const expectedSignature = await hmacSha256(webhookSecret.trim(), rawBody);
  return timingSafeEqual(expectedSignature.toLowerCase(), signature.trim().toLowerCase());
}
