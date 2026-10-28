// src/worker.ts
// Stage 3A.1: Cloudflare Worker Entry Point with D1 Binding and Route Dispatcher

import { D1BackendStorage } from './backend/d1-storage';
import { ApiHandler } from './backend/handler';
import type { WorkerEnv, ExecutionContext } from './backend/d1-types';

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /api/* endpoints
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Static storefront assets should be served via Pages; Worker only routes /api/*.'
          }
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    if (!env.DB) {
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'D1_BINDING_MISSING',
            message: 'Database binding "DB" is not configured.'
          }
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        }
      );
    }

    const storage = new D1BackendStorage(env.DB);
    const rateLimit = typeof env.RATE_LIMIT_PER_MINUTE === 'string'
      ? parseInt(env.RATE_LIMIT_PER_MINUTE, 10) || 60
      : env.RATE_LIMIT_PER_MINUTE || 60;

    const razorpayConfig =
      env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
        ? {
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET
          }
        : undefined;

    const handler = new ApiHandler({
      storage,
      ownerSecret: env.OWNER_ADMIN_SECRET,
      allowedOrigin: env.ALLOWED_ORIGIN || '*',
      rateLimitPerMinute: rateLimit,
      razorpayConfig
    });

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
    return handler.handleRequest(request, clientIp);
  }
};
