// src/backend/d1-types.ts
// Stage 3A.1: Cloudflare D1 Database and Worker Environment Type Definitions

export interface D1Result<T = Record<string, unknown>> {
  readonly results: T[];
  readonly success: boolean;
  readonly meta: Record<string, unknown>;
  readonly error?: string;
}

export interface D1Response<T = Record<string, unknown>> {
  readonly success: boolean;
  readonly meta: Record<string, unknown>;
  readonly error?: string;
  readonly results?: T[];
}

export interface D1ExecResult {
  readonly count: number;
  readonly duration: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Response<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Response<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface WorkerEnv {
  readonly DB: D1Database;
  readonly OWNER_ADMIN_SECRET?: string;
  readonly ALLOWED_ORIGIN?: string;
  readonly RATE_LIMIT_PER_MINUTE?: string | number;
  readonly RAZORPAY_KEY_ID?: string;
  readonly RAZORPAY_KEY_SECRET?: string;
  readonly RAZORPAY_WEBHOOK_SECRET?: string;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
