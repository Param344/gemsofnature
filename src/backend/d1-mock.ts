// src/backend/d1-mock.ts
// Stage 3B: High-fidelity in-memory Cloudflare D1 test double with ACID transaction rollback, customer tokens, owner management & audit logs

import type {
  D1Database,
  D1PreparedStatement,
  D1Response,
  D1Result,
  D1ExecResult
} from './d1-types';

interface MockDatabaseTables {
  customer_tokens: Map<string, Record<string, unknown>>;
  inquiries: Map<string, Record<string, unknown>>;
  inquiry_items: Map<string, Record<string, unknown>>;
  inquiry_notes: Map<string, Record<string, unknown>>;
  shipping_quotes: Map<string, Record<string, unknown>>;
  inventory_snapshots: Map<string, Record<string, unknown>>;
  orders: Map<string, Record<string, unknown>>;
  order_items: Map<string, Record<string, unknown>>;
  payment_attempts: Map<string, Record<string, unknown>>;
  idempotency_records: Map<string, Record<string, unknown>>;
  audit_logs: Map<string, Record<string, unknown>>;
  webhook_events: Map<string, Record<string, unknown>>;
}

interface MockDatabaseUniqueIndexes {
  'customer_tokens.token': Set<string>;
  'inquiries.idempotency_key': Set<string>;
  'shipping_quotes.idempotency_key': Set<string>;
  'orders.idempotency_key': Set<string>;
  'webhook_events.event_id': Set<string>;
}

export class MockD1Database implements D1Database {
  private tables: MockDatabaseTables = {
    customer_tokens: new Map(),
    inquiries: new Map(),
    inquiry_items: new Map(),
    inquiry_notes: new Map(),
    shipping_quotes: new Map(),
    inventory_snapshots: new Map(),
    orders: new Map(),
    order_items: new Map(),
    payment_attempts: new Map(),
    idempotency_records: new Map(),
    audit_logs: new Map(),
    webhook_events: new Map()
  };

  private uniqueIndexes: MockDatabaseUniqueIndexes = {
    'customer_tokens.token': new Set(),
    'inquiries.idempotency_key': new Set(),
    'shipping_quotes.idempotency_key': new Set(),
    'orders.idempotency_key': new Set(),
    'webhook_events.event_id': new Set()
  };

  private cloneState(): {
    tables: MockDatabaseTables;
    uniqueIndexes: MockDatabaseUniqueIndexes;
  } {
    const clonedTables: MockDatabaseTables = {
      customer_tokens: new Map(),
      inquiries: new Map(),
      inquiry_items: new Map(),
      inquiry_notes: new Map(),
      shipping_quotes: new Map(),
      inventory_snapshots: new Map(),
      orders: new Map(),
      order_items: new Map(),
      payment_attempts: new Map(),
      idempotency_records: new Map(),
      audit_logs: new Map(),
      webhook_events: new Map()
    };
    for (const [tbl, map] of Object.entries(this.tables) as [keyof MockDatabaseTables, Map<string, Record<string, unknown>>][]) {
      for (const [k, v] of map.entries()) {
        clonedTables[tbl].set(k, { ...v });
      }
    }
    const clonedIndexes: MockDatabaseUniqueIndexes = {
      'customer_tokens.token': new Set(this.uniqueIndexes['customer_tokens.token']),
      'inquiries.idempotency_key': new Set(this.uniqueIndexes['inquiries.idempotency_key']),
      'shipping_quotes.idempotency_key': new Set(this.uniqueIndexes['shipping_quotes.idempotency_key']),
      'orders.idempotency_key': new Set(this.uniqueIndexes['orders.idempotency_key']),
      'webhook_events.event_id': new Set(this.uniqueIndexes['webhook_events.event_id'])
    };
    return { tables: clonedTables, uniqueIndexes: clonedIndexes };
  }

  private restoreState(snapshot: {
    tables: MockDatabaseTables;
    uniqueIndexes: MockDatabaseUniqueIndexes;
  }): void {
    this.tables = snapshot.tables;
    this.uniqueIndexes = snapshot.uniqueIndexes;
  }

  public prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(this, query);
  }

  public async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0);
  }

  public async batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[]
  ): Promise<D1Response<T>[]> {
    const snapshot = this.cloneState();
    const responses: D1Response<T>[] = [];

    try {
      for (const stmt of statements) {
        const mockStmt = stmt as MockD1PreparedStatement;
        const res = await mockStmt.executeDirect();
        responses.push(res as D1Response<T>);
      }
      return responses;
    } catch (err) {
      // Atomic rollback on transaction failure
      this.restoreState(snapshot);
      throw err;
    }
  }

  public async exec(query: string): Promise<D1ExecResult> {
    const queries = query.split(';').map(q => q.trim()).filter(Boolean);
    for (const q of queries) {
      await this.prepare(q).run();
    }
    return { count: queries.length, duration: 1 };
  }

  // Internal SQL execution simulator
  public executeSql(query: string, params: unknown[]): { results: Record<string, unknown>[] } {
    const normalized = query.trim().replace(/\s+/g, ' ');

    // 1. DELETE FROM <table>
    if (normalized.toUpperCase().startsWith('DELETE FROM')) {
      const match = normalized.match(/DELETE FROM (\w+)/i);
      if (match && match[1]) {
        const tbl = match[1].toLowerCase() as keyof MockDatabaseTables;
        if (this.tables[tbl]) {
          this.tables[tbl].clear();
          if (tbl === 'customer_tokens') this.uniqueIndexes['customer_tokens.token'].clear();
          if (tbl === 'inquiries') this.uniqueIndexes['inquiries.idempotency_key'].clear();
          if (tbl === 'shipping_quotes') this.uniqueIndexes['shipping_quotes.idempotency_key'].clear();
          if (tbl === 'orders') this.uniqueIndexes['orders.idempotency_key'].clear();
        }
      }
      return { results: [] };
    }

    // 2. INSERT INTO customer_tokens
    if (normalized.toUpperCase().startsWith('INSERT INTO CUSTOMER_TOKENS')) {
      const [id, token, resource_type, resource_id, customer_email, expires_at, created_at] =
        params as [string, string, string, string, string, number, number];

      if (this.uniqueIndexes['customer_tokens.token'].has(token)) {
        throw new Error(`UNIQUE constraint failed: customer_tokens.token (${token})`);
      }

      this.tables.customer_tokens.set(token, {
        id, token, resource_type, resource_id, customer_email, expires_at, created_at
      });
      this.uniqueIndexes['customer_tokens.token'].add(token);
      return { results: [] };
    }

    // 3. INSERT INTO inquiries
    if (normalized.toUpperCase().startsWith('INSERT INTO INQUIRIES')) {
      const [
        id, customer_name, customer_email, customer_phone,
        destination_country, status, notes, idempotency_key,
        created_at, updated_at
      ] = params as [string, string, string, string | null, string, string, string | null, string, number, number];

      if (this.tables.inquiries.has(id)) {
        throw new Error(`UNIQUE constraint failed: inquiries.id (${id})`);
      }
      if (this.uniqueIndexes['inquiries.idempotency_key'].has(idempotency_key)) {
        throw new Error(`UNIQUE constraint failed: inquiries.idempotency_key (${idempotency_key})`);
      }

      this.tables.inquiries.set(id, {
        id, customer_name, customer_email, customer_phone,
        destination_country, status, notes, idempotency_key,
        created_at, updated_at
      });
      this.uniqueIndexes['inquiries.idempotency_key'].add(idempotency_key);
      return { results: [] };
    }

    // 4. UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?
    if (normalized.toUpperCase().startsWith('UPDATE INQUIRIES SET STATUS')) {
      const [status, updated_at, id] = params as [string, number, string];
      const existing = this.tables.inquiries.get(id);
      if (!existing) {
        throw new Error(`Row not found: inquiries.id (${id})`);
      }
      this.tables.inquiries.set(id, { ...existing, status, updated_at });
      return { results: [] };
    }

    // 5. INSERT INTO inquiry_items
    if (normalized.toUpperCase().startsWith('INSERT INTO INQUIRY_ITEMS')) {
      const [
        id, inquiry_id, product_id, quantity,
        provisional_min_unit, provisional_max_unit, created_at
      ] = params as [string, string, string, number, number, number, number];

      if (this.tables.inquiry_items.has(id)) {
        throw new Error(`UNIQUE constraint failed: inquiry_items.id (${id})`);
      }
      if (!this.tables.inquiries.has(inquiry_id)) {
        throw new Error(`FOREIGN KEY constraint failed: inquiry_items.inquiry_id (${inquiry_id})`);
      }

      this.tables.inquiry_items.set(id, {
        id, inquiry_id, product_id, quantity,
        provisional_min_unit, provisional_max_unit, created_at
      });
      return { results: [] };
    }

    // 6. INSERT INTO inquiry_notes
    if (normalized.toUpperCase().startsWith('INSERT INTO INQUIRY_NOTES')) {
      const [id, inquiry_id, author, note, created_at] =
        params as [string, string, string, string, number];

      if (!this.tables.inquiries.has(inquiry_id)) {
        throw new Error(`FOREIGN KEY constraint failed: inquiry_notes.inquiry_id (${inquiry_id})`);
      }

      this.tables.inquiry_notes.set(id, { id, inquiry_id, author, note, created_at });
      return { results: [] };
    }

    // 7. INSERT INTO shipping_quotes
    if (normalized.toUpperCase().startsWith('INSERT INTO SHIPPING_QUOTES')) {
      const [
        id, customer_email, destination_country, destination_postal_code,
        destination_address, status, quoted_amount, quoted_currency,
        rejection_reason, expires_at, accepted_at, cancelled_at,
        idempotency_key, created_at, updated_at
      ] = params as [
        string, string, string, string | null,
        string | null, string, number | null, string,
        string | null, number | null, number | null, number | null,
        string, number, number
      ];

      if (this.tables.shipping_quotes.has(id)) {
        throw new Error(`UNIQUE constraint failed: shipping_quotes.id (${id})`);
      }
      if (this.uniqueIndexes['shipping_quotes.idempotency_key'].has(idempotency_key)) {
        throw new Error(`UNIQUE constraint failed: shipping_quotes.idempotency_key (${idempotency_key})`);
      }

      this.tables.shipping_quotes.set(id, {
        id, customer_email, destination_country, destination_postal_code,
        destination_address, status, quoted_amount, quoted_currency,
        rejection_reason, expires_at, accepted_at, cancelled_at,
        idempotency_key, created_at, updated_at
      });
      this.uniqueIndexes['shipping_quotes.idempotency_key'].add(idempotency_key);
      return { results: [] };
    }

    // 8. UPDATE shipping_quotes
    if (normalized.toUpperCase().startsWith('UPDATE SHIPPING_QUOTES')) {
      const [
        status, quoted_amount, quoted_currency,
        rejection_reason, expires_at, accepted_at, cancelled_at,
        updated_at, id
      ] = params as [
        string, number | null, string,
        string | null, number | null, number | null, number | null,
        number, string
      ];

      const existing = this.tables.shipping_quotes.get(id);
      if (!existing) {
        throw new Error(`Row not found: shipping_quotes.id (${id})`);
      }

      this.tables.shipping_quotes.set(id, {
        ...existing,
        status,
        quoted_amount,
        quoted_currency,
        rejection_reason,
        expires_at,
        accepted_at,
        cancelled_at,
        updated_at
      });
      return { results: [] };
    }

    // 9. INSERT INTO orders
    if (normalized.toUpperCase().startsWith('INSERT INTO ORDERS')) {
      let id: string, customer_name: string, customer_email: string, customer_phone: string | null;
      let shipping_address_line1: string, shipping_city: string, shipping_state: string;
      let shipping_postal_code: string, shipping_country: string;
      let shipping_fee: number, subtotal: number, total: number, currency: string, status: string;
      let shipping_quote_id: string | null, idempotency_key: string;
      let razorpay_order_id: string | null = null, razorpay_payment_id: string | null = null, payment_confirmed_at: number | null = null;
      let created_at: number, updated_at: number;

      if (params.length >= 21) {
        [
          id, customer_name, customer_email, customer_phone,
          shipping_address_line1, shipping_city, shipping_state,
          shipping_postal_code, shipping_country,
          shipping_fee, subtotal, total, currency, status,
          shipping_quote_id, idempotency_key,
          razorpay_order_id, razorpay_payment_id, payment_confirmed_at,
          created_at, updated_at
        ] = params as any;
      } else {
        [
          id, customer_name, customer_email, customer_phone,
          shipping_address_line1, shipping_city, shipping_state,
          shipping_postal_code, shipping_country,
          shipping_fee, subtotal, total, currency, status,
          shipping_quote_id, idempotency_key, created_at, updated_at
        ] = params as any;
      }

      if (this.tables.orders.has(id)) {
        throw new Error(`UNIQUE constraint failed: orders.id (${id})`);
      }
      if (this.uniqueIndexes['orders.idempotency_key'].has(idempotency_key)) {
        throw new Error(`UNIQUE constraint failed: orders.idempotency_key (${idempotency_key})`);
      }

      this.tables.orders.set(id, {
        id, customer_name, customer_email, customer_phone,
        shipping_address_line1, shipping_city, shipping_state,
        shipping_postal_code, shipping_country,
        shipping_fee, subtotal, total, currency, status,
        shipping_quote_id, idempotency_key,
        razorpay_order_id, razorpay_payment_id, payment_confirmed_at,
        created_at, updated_at
      });
      this.uniqueIndexes['orders.idempotency_key'].add(idempotency_key);
      return { results: [] };
    }

    // 9b. UPDATE orders
    if (normalized.toUpperCase().startsWith('UPDATE ORDERS')) {
      const [status, razorpay_order_id, razorpay_payment_id, payment_confirmed_at, updated_at, id] =
        params as [string, string | null, string | null, number | null, number, string];
      const existing = this.tables.orders.get(id);
      if (existing) {
        this.tables.orders.set(id, {
          ...existing,
          status,
          razorpay_order_id: razorpay_order_id !== null ? razorpay_order_id : existing.razorpay_order_id,
          razorpay_payment_id: razorpay_payment_id !== null ? razorpay_payment_id : existing.razorpay_payment_id,
          payment_confirmed_at: payment_confirmed_at !== null ? payment_confirmed_at : existing.payment_confirmed_at,
          updated_at
        });
      }
      return { results: [] };
    }

    // 10. INSERT INTO order_items
    if (normalized.toUpperCase().startsWith('INSERT INTO ORDER_ITEMS')) {
      const [
        id, order_id, product_id, inventory_sku,
        unit_price, quantity, line_total, created_at
      ] = params as [string, string, string, string, number, number, number, number];

      if (this.tables.order_items.has(id)) {
        throw new Error(`UNIQUE constraint failed: order_items.id (${id})`);
      }
      if (!this.tables.orders.has(order_id)) {
        throw new Error(`FOREIGN KEY constraint failed: order_items.order_id (${order_id})`);
      }

      this.tables.order_items.set(id, {
        id, order_id, product_id, inventory_sku,
        unit_price, quantity, line_total, created_at
      });
      return { results: [] };
    }

    // 11. INSERT INTO inventory_snapshots ... ON CONFLICT
    if (normalized.toUpperCase().startsWith('INSERT INTO INVENTORY_SNAPSHOTS')) {
      let sku: string, product_id: string, approved_selling_price: number, currency: string, in_stock: number;
      let reserved_order_id: string | null = null;
      let carat_weight: number | null, cert_number: string | null, cert_status: string, cert_lab: string | null, notes: string | null;
      let approved_by: string, approved_at: number, updated_at: number;

      if (params.length >= 14) {
        [
          sku, product_id, approved_selling_price, currency, in_stock, reserved_order_id,
          carat_weight, cert_number, cert_status, cert_lab, notes,
          approved_by, approved_at, updated_at
        ] = params as any;
      } else {
        [
          sku, product_id, approved_selling_price, currency, in_stock,
          carat_weight, cert_number, cert_status, cert_lab, notes,
          approved_by, approved_at, updated_at
        ] = params as any;
      }

      this.tables.inventory_snapshots.set(sku, {
        sku, product_id, approved_selling_price, currency, in_stock, reserved_order_id,
        carat_weight, cert_number, cert_status, cert_lab, notes,
        approved_by, approved_at, updated_at
      });
      return { results: [] };
    }

    // 12. UPDATE inventory_snapshots
    if (normalized.toUpperCase().startsWith('UPDATE INVENTORY_SNAPSHOTS')) {
      if (normalized.includes('SET reserved_order_id = ?, updated_at = ? WHERE sku = ?')) {
        const [reserved_order_id, updated_at, sku] = params as [string, number, string];
        const existing = this.tables.inventory_snapshots.get(sku);
        if (existing) {
          this.tables.inventory_snapshots.set(sku, { ...existing, reserved_order_id, updated_at });
        }
        return { results: [] };
      }
      if (normalized.includes('SET reserved_order_id = NULL, updated_at = ? WHERE reserved_order_id = ?')) {
        const [updated_at, orderId] = params as [number, string];
        for (const [sku, item] of this.tables.inventory_snapshots.entries()) {
          if (item.reserved_order_id === orderId) {
            this.tables.inventory_snapshots.set(sku, { ...item, reserved_order_id: null, updated_at });
          }
        }
        return { results: [] };
      }
      if (normalized.includes('SET in_stock = 0, reserved_order_id = NULL, updated_at = ? WHERE reserved_order_id = ?')) {
        const [updated_at, orderId] = params as [number, string];
        for (const [sku, item] of this.tables.inventory_snapshots.entries()) {
          if (item.reserved_order_id === orderId) {
            this.tables.inventory_snapshots.set(sku, { ...item, in_stock: 0, reserved_order_id: null, updated_at });
          }
        }
        return { results: [] };
      }

      const [
        approved_selling_price, in_stock, reserved_order_id, carat_weight, cert_number,
        cert_status, cert_lab, notes, updated_at, sku
      ] = params.length >= 10
        ? (params as [number, number, string | null, number | null, string | null, string, string | null, string | null, number, string])
        : [
            params[0] as number,
            params[1] as number,
            null,
            params[2] as number | null,
            params[3] as string | null,
            params[4] as string,
            params[5] as string | null,
            params[6] as string | null,
            params[7] as number,
            params[8] as string
          ];

      const existing = this.tables.inventory_snapshots.get(sku);
      if (!existing) {
        throw new Error(`Row not found: inventory_snapshots.sku (${sku})`);
      }

      this.tables.inventory_snapshots.set(sku, {
        ...existing,
        approved_selling_price,
        in_stock,
        reserved_order_id: reserved_order_id ?? existing.reserved_order_id,
        carat_weight,
        cert_number,
        cert_status,
        cert_lab,
        notes,
        updated_at
      });
      return { results: [] };
    }

    // 13. INSERT INTO payment_attempts
    if (normalized.toUpperCase().startsWith('INSERT INTO PAYMENT_ATTEMPTS')) {
      let id: string, order_id: string, gateway: string, gateway_order_id: string | null, gateway_payment_id: string | null;
      let status: string, amount: number, amount_subunits: number | null = null, currency: string;
      let signature: string | null = null, error_message: string | null = null, created_at: number, updated_at: number;

      if (params.length >= 13) {
        [
          id, order_id, gateway, gateway_order_id, gateway_payment_id,
          status, amount, amount_subunits, currency, signature, error_message, created_at, updated_at
        ] = params as any;
      } else {
        [
          id, order_id, gateway, gateway_order_id, gateway_payment_id,
          status, amount, currency, error_message, created_at, updated_at
        ] = params as any;
      }

      this.tables.payment_attempts.set(id, {
        id, order_id, gateway, gateway_order_id, gateway_payment_id,
        status, amount, amount_subunits, currency, signature, error_message, created_at, updated_at
      });
      return { results: [] };
    }

    // 13b. UPDATE payment_attempts
    if (normalized.toUpperCase().startsWith('UPDATE PAYMENT_ATTEMPTS')) {
      const [status, gateway_payment_id, signature, error_message, updated_at, id] =
        params as [string | null, string | null, string | null, string | null, number, string];

      const existing = this.tables.payment_attempts.get(id);
      if (existing) {
        this.tables.payment_attempts.set(id, {
          ...existing,
          status: status !== null ? status : existing.status,
          gateway_payment_id: gateway_payment_id !== null ? gateway_payment_id : existing.gateway_payment_id,
          signature: signature !== null ? signature : existing.signature,
          error_message: error_message !== null ? error_message : existing.error_message,
          updated_at
        });
      }
      return { results: [] };
    }

    // 14. INSERT INTO webhook_events
    if (normalized.toUpperCase().startsWith('INSERT INTO WEBHOOK_EVENTS')) {
      const [id, event_id, event_type, status, payload_json, error_message, processed_at, created_at] =
        params as [string, string, string, string, string | null, string | null, number, number];

      if (this.uniqueIndexes['webhook_events.event_id'].has(event_id)) {
        throw new Error(`UNIQUE constraint failed: webhook_events.event_id (${event_id})`);
      }

      this.tables.webhook_events.set(event_id, {
        id, event_id, event_type, status, payload_json, error_message, processed_at, created_at
      });
      this.uniqueIndexes['webhook_events.event_id'].add(event_id);
      return { results: [] };
    }

    // 14b. UPDATE webhook_events
    if (normalized.toUpperCase().startsWith('UPDATE WEBHOOK_EVENTS')) {
      const [status, error_message, processed_at, event_id] =
        params as [string, string | null, number, string];

      const existing = this.tables.webhook_events.get(event_id);
      if (existing) {
        this.tables.webhook_events.set(event_id, {
          ...existing,
          status,
          error_message: error_message !== null ? error_message : existing.error_message,
          processed_at
        });
      }
      return { results: [] };
    }

    // 14. INSERT INTO idempotency_records
    if (normalized.toUpperCase().startsWith('INSERT INTO IDEMPOTENCY_RECORDS')) {
      const [key, resource_type, resource_id, response_status, response_body, created_at] =
        params as [string, string, string, number, string, number];

      this.tables.idempotency_records.set(key, {
        key, resource_type, resource_id, response_status, response_body, created_at
      });
      return { results: [] };
    }

    // 15. INSERT INTO audit_logs
    if (normalized.toUpperCase().startsWith('INSERT INTO AUDIT_LOGS')) {
      const [id, entity_type, entity_id, action, actor, details_json, created_at] =
        params as [string, string, string, string, string, string | null, number];

      this.tables.audit_logs.set(id, {
        id, entity_type, entity_id, action, actor, details_json, created_at
      });
      return { results: [] };
    }

    // 16. SELECT queries
    if (normalized.toUpperCase().startsWith('SELECT')) {
      // customer_tokens
      if (normalized.includes('FROM customer_tokens WHERE token = ?')) {
        const row = this.tables.customer_tokens.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }

      // Check pending orders for SKU
      if (normalized.includes('FROM order_items oi JOIN orders o') && normalized.includes('oi.inventory_sku = ?')) {
        const sku = params[0] as string;
        let count = 0;
        for (const item of this.tables.order_items.values()) {
          if (item.inventory_sku === sku) {
            const order = this.tables.orders.get(item.order_id as string);
            if (order && order.status === 'PENDING_PAYMENT') {
              count++;
            }
          }
        }
        return { results: [{ count }] };
      }

      // inquiries
      if (normalized.includes('FROM inquiries WHERE id = ?')) {
        const row = this.tables.inquiries.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }
      if (normalized.includes('FROM inquiries WHERE idempotency_key = ?')) {
        const key = params[0] as string;
        for (const row of this.tables.inquiries.values()) {
          if (row.idempotency_key === key) return { results: [{ ...row }] };
        }
        return { results: [] };
      }
      if (normalized.includes('FROM inquiries') && normalized.includes('SELECT COUNT(*)')) {
        return { results: [{ count: this.tables.inquiries.size }] };
      }
      if (normalized.includes('FROM inquiries')) {
        const res = Array.from(this.tables.inquiries.values()).sort(
          (a, b) => Number(b.created_at) - Number(a.created_at)
        );
        return { results: res };
      }

      // inquiry_items
      if (normalized.includes('FROM inquiry_items WHERE inquiry_id = ?')) {
        const inqId = params[0] as string;
        const res: Record<string, unknown>[] = [];
        for (const row of this.tables.inquiry_items.values()) {
          if (row.inquiry_id === inqId) res.push({ ...row });
        }
        res.sort((a, b) => Number(a.created_at) - Number(b.created_at));
        return { results: res };
      }

      // inquiry_notes
      if (normalized.includes('FROM inquiry_notes WHERE inquiry_id = ?')) {
        const inqId = params[0] as string;
        const res: Record<string, unknown>[] = [];
        for (const row of this.tables.inquiry_notes.values()) {
          if (row.inquiry_id === inqId) res.push({ ...row });
        }
        res.sort((a, b) => Number(a.created_at) - Number(b.created_at));
        return { results: res };
      }

      // shipping_quotes
      if (normalized.includes('FROM shipping_quotes WHERE id = ?')) {
        const row = this.tables.shipping_quotes.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }
      if (normalized.includes('FROM shipping_quotes WHERE idempotency_key = ?')) {
        const key = params[0] as string;
        for (const row of this.tables.shipping_quotes.values()) {
          if (row.idempotency_key === key) return { results: [{ ...row }] };
        }
        return { results: [] };
      }
      if (normalized.includes('FROM shipping_quotes') && normalized.includes('SELECT COUNT(*)')) {
        return { results: [{ count: this.tables.shipping_quotes.size }] };
      }
      if (normalized.includes('FROM shipping_quotes')) {
        const res = Array.from(this.tables.shipping_quotes.values()).sort(
          (a, b) => Number(b.created_at) - Number(a.created_at)
        );
        return { results: res };
      }

      // orders
      if (normalized.includes('FROM orders WHERE id = ?')) {
        const row = this.tables.orders.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }
      if (normalized.includes('FROM orders WHERE razorpay_order_id = ?')) {
        const rzpId = params[0] as string;
        for (const row of this.tables.orders.values()) {
          if (row.razorpay_order_id === rzpId) return { results: [{ ...row }] };
        }
        return { results: [] };
      }
      if (normalized.includes('FROM orders WHERE idempotency_key = ?')) {
        const key = params[0] as string;
        for (const row of this.tables.orders.values()) {
          if (row.idempotency_key === key) return { results: [{ ...row }] };
        }
        return { results: [] };
      }
      if (normalized.includes('FROM order_items WHERE order_id = ?')) {
        const ordId = params[0] as string;
        const res: Record<string, unknown>[] = [];
        for (const row of this.tables.order_items.values()) {
          if (row.order_id === ordId) res.push({ ...row });
        }
        res.sort((a, b) => Number(a.created_at) - Number(b.created_at));
        return { results: res };
      }

      // inventory_snapshots
      if (normalized.includes('FROM inventory_snapshots WHERE sku = ?')) {
        const row = this.tables.inventory_snapshots.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }
      if (normalized.includes('FROM inventory_snapshots') && normalized.includes('SELECT COUNT(*)')) {
        return { results: [{ count: this.tables.inventory_snapshots.size }] };
      }
      if (normalized.includes('FROM inventory_snapshots')) {
        const res = Array.from(this.tables.inventory_snapshots.values()).sort(
          (a, b) => Number(b.updated_at) - Number(a.updated_at)
        );
        return { results: res };
      }

      // payment_attempts
      if (normalized.includes('FROM payment_attempts WHERE gateway_order_id = ?')) {
        const gId = params[0] as string;
        const matches: Record<string, unknown>[] = [];
        for (const row of this.tables.payment_attempts.values()) {
          if (row.gateway_order_id === gId) matches.push({ ...row });
        }
        matches.sort((a, b) => Number(b.created_at) - Number(a.created_at));
        return { results: matches };
      }
      if (normalized.includes('FROM payment_attempts WHERE order_id = ?')) {
        const ordId = params[0] as string;
        const res: Record<string, unknown>[] = [];
        for (const row of this.tables.payment_attempts.values()) {
          if (row.order_id === ordId) res.push({ ...row });
        }
        res.sort((a, b) => Number(a.created_at) - Number(b.created_at));
        return { results: res };
      }

      // webhook_events
      if (normalized.includes('FROM webhook_events WHERE event_id = ?')) {
        const evId = params[0] as string;
        const row = this.tables.webhook_events.get(evId);
        return { results: row ? [{ ...row }] : [] };
      }

      // idempotency_records
      if (normalized.includes('FROM idempotency_records WHERE key = ?')) {
        const row = this.tables.idempotency_records.get(params[0] as string);
        return { results: row ? [{ ...row }] : [] };
      }

      // audit_logs
      if (normalized.includes('FROM audit_logs') && normalized.includes('SELECT COUNT(*)')) {
        return { results: [{ count: this.tables.audit_logs.size }] };
      }
      if (normalized.includes('FROM audit_logs')) {
        const res = Array.from(this.tables.audit_logs.values()).sort(
          (a, b) => Number(b.created_at) - Number(a.created_at)
        );
        return { results: res };
      }
    }

    return { results: [] };
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: MockD1Database,
    private readonly query: string
  ) {}

  public bind(...values: unknown[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  public async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
    const { results } = this.db.executeSql(this.query, this.params);
    return (results[0] as T) || null;
  }

  public async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { results } = this.db.executeSql(this.query, this.params);
    return {
      results: results as T[],
      success: true,
      meta: { duration: 1 }
    };
  }

  public async run<T = Record<string, unknown>>(): Promise<D1Response<T>> {
    return this.executeDirect() as Promise<D1Response<T>>;
  }

  public async raw<T = unknown>(): Promise<T[]> {
    const { results } = this.db.executeSql(this.query, this.params);
    return results.map(r => Object.values(r)) as T[];
  }

  public async executeDirect(): Promise<D1Response<Record<string, unknown>>> {
    const { results } = this.db.executeSql(this.query, this.params);
    return {
      success: true,
      results,
      meta: { duration: 1 }
    };
  }
}
