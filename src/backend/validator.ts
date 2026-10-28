// src/backend/validator.ts
// Stage 3A: Server-side validation and sanitization for API endpoints

import { getProductById } from '../core/products';
import type {
  CustomerContact,
  InquiryItemInput,
  CreateInquiryRequest,
  CreateShippingQuoteRequest,
  ApiErrorDetail
} from './types';

export class BackendValidator {
  public static readonly MAX_QUANTITY_PER_ITEM = 20;
  public static readonly METADATA_ONLY_IDS: readonly string[] = Object.freeze(
    ['p127', 'p128', 'p129', 'p135']
  );

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly PHONE_REGEX = /^\+?[0-9\s\-()]{7,25}$/;

  /**
   * Validates customer contact details.
   */
  public static validateCustomer(
    customer: unknown,
    requireShippingAddress = false
  ): { valid: boolean; errors: ApiErrorDetail[]; sanitized?: CustomerContact } {
    const errors: ApiErrorDetail[] = [];
    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
      return {
        valid: false,
        errors: [{ message: 'Customer details must be an object.', code: 'INVALID_CUSTOMER' }]
      };
    }

    const c = customer as Record<string, unknown>;

    // Name
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name || name.length < 2 || name.length > 100) {
      errors.push({
        field: 'customer.name',
        message: 'Name is required and must be between 2 and 100 characters.',
        code: 'INVALID_NAME'
      });
    }

    // Email
    const email = typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
    if (!email || !this.EMAIL_REGEX.test(email) || email.length > 150) {
      errors.push({
        field: 'customer.email',
        message: 'A valid email address is required.',
        code: 'INVALID_EMAIL'
      });
    }

    // Phone (optional for inquiries, required or optional based on policy)
    let phone: string | undefined;
    if (c.phone !== undefined && c.phone !== null && String(c.phone).trim() !== '') {
      const pStr = String(c.phone).trim();
      if (!this.PHONE_REGEX.test(pStr)) {
        errors.push({
          field: 'customer.phone',
          message: 'Phone number format is invalid.',
          code: 'INVALID_PHONE'
        });
      } else {
        phone = pStr;
      }
    }

    // Country
    const country = typeof c.country === 'string' ? c.country.trim().toUpperCase() : 'IN';
    if (!country || country.length < 2 || country.length > 56) {
      errors.push({
        field: 'customer.country',
        message: 'Valid country code or name is required.',
        code: 'INVALID_COUNTRY'
      });
    }

    let addressLine1: string | undefined;
    let city: string | undefined;
    let state: string | undefined;
    let postalCode: string | undefined;

    if (requireShippingAddress) {
      addressLine1 = typeof c.addressLine1 === 'string' ? c.addressLine1.trim() : '';
      city = typeof c.city === 'string' ? c.city.trim() : '';
      state = typeof c.state === 'string' ? c.state.trim() : '';
      postalCode = typeof c.postalCode === 'string' ? c.postalCode.trim() : '';

      if (!addressLine1 || addressLine1.length < 5) {
        errors.push({
          field: 'customer.addressLine1',
          message: 'Street address line is required for delivery.',
          code: 'INVALID_ADDRESS'
        });
      }
      if (!city) {
        errors.push({ field: 'customer.city', message: 'City is required.', code: 'INVALID_CITY' });
      }
      if (!state) {
        errors.push({ field: 'customer.state', message: 'State / Province is required.', code: 'INVALID_STATE' });
      }
      if (!postalCode || postalCode.length < 3) {
        errors.push({
          field: 'customer.postalCode',
          message: 'Postal code / PIN code is required.',
          code: 'INVALID_POSTAL_CODE'
        });
      }
    } else {
      if (typeof c.addressLine1 === 'string') addressLine1 = c.addressLine1.trim();
      if (typeof c.city === 'string') city = c.city.trim();
      if (typeof c.state === 'string') state = c.state.trim();
      if (typeof c.postalCode === 'string') postalCode = c.postalCode.trim();
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        name,
        email,
        phone,
        country,
        addressLine1,
        city,
        state,
        postalCode
      }
    };
  }

  /**
   * Validates an idempotency key.
   */
  public static validateIdempotencyKey(key: unknown): { valid: boolean; error?: ApiErrorDetail; sanitized?: string } {
    if (typeof key !== 'string' || key.trim().length < 8 || key.trim().length > 128) {
      return {
        valid: false,
        error: {
          field: 'idempotencyKey',
          message: 'idempotencyKey must be a string between 8 and 128 characters.',
          code: 'INVALID_IDEMPOTENCY_KEY'
        }
      };
    }
    return { valid: true, sanitized: key.trim() };
  }

  /**
   * Validates inquiry items.
   * Rejects unknown product IDs and metadata-only product IDs (p127, p128, p129, p135).
   */
  public static validateInquiryItems(rawItems: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: InquiryItemInput[];
  } {
    const errors: ApiErrorDetail[] = [];
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return {
        valid: false,
        errors: [{ message: 'Items list must be a non-empty array.', code: 'EMPTY_ITEMS' }]
      };
    }

    const sanitized: InquiryItemInput[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      if (!item || typeof item !== 'object') {
        errors.push({
          field: `items[${i}]`,
          message: 'Item must be an object with productId and quantity.',
          code: 'INVALID_ITEM'
        });
        continue;
      }

      const pId = String((item as Record<string, unknown>).productId || '').trim();

      // Explicitly reject metadata-only IDs
      if (this.METADATA_ONLY_IDS.includes(pId)) {
        errors.push({
          field: `items[${i}].productId`,
          message: `Product ID '${pId}' is an unpurchasable metadata record.`,
          code: 'METADATA_ONLY_PRODUCT'
        });
        continue;
      }

      // Authoritative catalogue check
      const product = getProductById(pId);
      if (!product) {
        errors.push({
          field: `items[${i}].productId`,
          message: `Product ID '${pId}' is not found in catalogue.`,
          code: 'UNKNOWN_PRODUCT'
        });
        continue;
      }

      const qty = Number((item as Record<string, unknown>).quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > this.MAX_QUANTITY_PER_ITEM) {
        errors.push({
          field: `items[${i}].quantity`,
          message: `Quantity must be an integer between 1 and ${this.MAX_QUANTITY_PER_ITEM}.`,
          code: 'INVALID_QUANTITY'
        });
        continue;
      }

      sanitized.push({ productId: pId, quantity: qty });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [], sanitized };
  }

  /**
   * Validates full CreateInquiryRequest.
   */
  public static validateCreateInquiry(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: CreateInquiryRequest;
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }

    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    // Customer
    const customerRes = this.validateCustomer(b.customer, false);
    if (!customerRes.valid) {
      errors.push(...customerRes.errors);
    }

    // Items
    const itemsRes = this.validateInquiryItems(b.items);
    if (!itemsRes.valid) {
      errors.push(...itemsRes.errors);
    }

    // Idempotency Key
    const keyRes = this.validateIdempotencyKey(b.idempotencyKey);
    if (!keyRes.valid && keyRes.error) {
      errors.push(keyRes.error);
    }

    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : undefined;

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        customer: customerRes.sanitized!,
        items: itemsRes.sanitized!,
        notes,
        idempotencyKey: keyRes.sanitized!
      }
    };
  }

  /**
   * Validates international shipping quote request.
   */
  public static validateCreateShippingQuote(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: CreateShippingQuoteRequest;
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }

    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    const email = typeof b.customerEmail === 'string' ? b.customerEmail.trim().toLowerCase() : '';
    if (!email || !this.EMAIL_REGEX.test(email)) {
      errors.push({
        field: 'customerEmail',
        message: 'A valid customer email is required.',
        code: 'INVALID_EMAIL'
      });
    }

    const country = typeof b.destinationCountry === 'string' ? b.destinationCountry.trim().toUpperCase() : '';
    if (!country || country === 'IN' || country === 'INDIA') {
      errors.push({
        field: 'destinationCountry',
        message: 'International shipping quotes are only for non-domestic destinations.',
        code: 'DOMESTIC_NOT_ELIGIBLE_FOR_INTERNATIONAL_QUOTE'
      });
    }

    const keyRes = this.validateIdempotencyKey(b.idempotencyKey);
    if (!keyRes.valid && keyRes.error) {
      errors.push(keyRes.error);
    }

    const postalCode = typeof b.destinationPostalCode === 'string' ? b.destinationPostalCode.trim() : undefined;
    const address = typeof b.destinationAddress === 'string' ? b.destinationAddress.trim() : undefined;

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        customerEmail: email,
        destinationCountry: country,
        destinationPostalCode: postalCode,
        destinationAddress: address,
        idempotencyKey: keyRes.sanitized!
      }
    };
  }

  /**
   * Validates inquiry status transitions according to the strict state machine:
   * PENDING_REVIEW -> PRICE_QUOTED -> CUSTOMER_CONTACTED -> CLOSED
   * Cancellation allowed from PENDING_REVIEW and PRICE_QUOTED.
   * Terminal statuses (CLOSED, CANCELLED) cannot be changed.
   */
  public static validateInquiryStatusTransition(
    current: string,
    target: string
  ): { valid: boolean; error?: string } {
    const ALLOWED_TRANSITIONS: Record<string, string[]> = {
      PENDING_REVIEW: ['PRICE_QUOTED', 'CANCELLED'],
      PRICE_QUOTED: ['CUSTOMER_CONTACTED', 'CANCELLED'],
      CUSTOMER_CONTACTED: ['CLOSED', 'CANCELLED'],
      DRAFT_PREPARED: ['PENDING_REVIEW', 'CANCELLED'],
      CLOSED: [],
      CANCELLED: []
    };

    const allowed = ALLOWED_TRANSITIONS[current] || [];
    if (!allowed.includes(target)) {
      return {
        valid: false,
        error: `Invalid inquiry status transition from '${current}' to '${target}'. Allowed: [${allowed.join(', ')}].`
      };
    }
    return { valid: true };
  }

  /**
   * Validates an internal owner note for an inquiry.
   */
  public static validateInquiryNote(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: { note: string; author: string };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }
    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    const note = typeof b.note === 'string' ? b.note.trim() : '';
    if (!note || note.length < 1 || note.length > 2000) {
      errors.push({
        field: 'note',
        message: 'Internal note must be between 1 and 2000 characters.',
        code: 'INVALID_NOTE'
      });
    }

    const author = typeof b.author === 'string' ? b.author.trim() : 'Owner';
    if (author.length < 1 || author.length > 100) {
      errors.push({
        field: 'author',
        message: 'Author name must be between 1 and 100 characters.',
        code: 'INVALID_AUTHOR'
      });
    }

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, errors: [], sanitized: { note, author } };
  }

  /**
   * Validates international shipping quote rejection input.
   */
  public static validateQuoteRejection(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: { reason: string };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }
    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason || reason.length < 2 || reason.length > 500) {
      errors.push({
        field: 'reason',
        message: 'Rejection reason must be between 2 and 500 characters.',
        code: 'INVALID_REASON'
      });
    }

    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, errors: [], sanitized: { reason } };
  }

  /**
   * Validates physical gemstone inventory registration.
   */
  public static validateRegisterInventory(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: {
      sku: string;
      productId: string;
      approvedSellingPrice: number;
      inStock: boolean;
      caratWeight?: number;
      rattiWeight?: number;
      certNumber?: string;
      certStatus?: 'CERTIFIED' | 'PENDING' | 'UNCERTIFIED';
      certLab?: string;
      origin?: string;
      notes?: string;
      approvedBy: string;
    };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }
    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    // SKU
    const sku = typeof b.sku === 'string' ? b.sku.trim() : '';
    if (!sku || !/^[A-Z0-9_-]{3,50}$/.test(sku)) {
      errors.push({
        field: 'sku',
        message: 'SKU must be 3-50 uppercase alphanumeric characters, dashes, or underscores.',
        code: 'INVALID_SKU'
      });
    }

    // Product ID
    const productId = typeof b.productId === 'string' ? b.productId.trim() : '';
    if (this.METADATA_ONLY_IDS.includes(productId)) {
      errors.push({
        field: 'productId',
        message: `Product ID '${productId}' is an unpurchasable metadata record.`,
        code: 'METADATA_ONLY_PRODUCT'
      });
    } else {
      const prod = getProductById(productId);
      if (!prod) {
        errors.push({
          field: 'productId',
          message: `Product ID '${productId}' not found in catalogue.`,
          code: 'UNKNOWN_PRODUCT'
        });
      }
    }

    // Price
    const rawPrice = b.approvedSellingPrice;
    if (typeof rawPrice !== 'number' || !Number.isInteger(rawPrice) || rawPrice <= 0 || !Number.isFinite(rawPrice)) {
      errors.push({
        field: 'approvedSellingPrice',
        message: 'Approved selling price must be a positive finite integer in INR.',
        code: 'INVALID_PRICE'
      });
    }
    const price = typeof rawPrice === 'number' ? rawPrice : 0;

    const inStock = b.inStock !== false;
    let caratWeight: number | undefined;
    if (b.caratWeight !== undefined && b.caratWeight !== null && b.caratWeight !== '') {
      const cw = Number(b.caratWeight);
      if (Number.isFinite(cw) && cw > 0 && cw <= 1000) {
        caratWeight = Math.round(cw * 100) / 100;
      } else {
        errors.push({
          field: 'caratWeight',
          message: 'Carat weight must be a positive number up to 1000.',
          code: 'INVALID_CARAT'
        });
      }
    }

    let rattiWeight: number | undefined;
    if (b.rattiWeight !== undefined && b.rattiWeight !== null && b.rattiWeight !== '') {
      const rw = Number(b.rattiWeight);
      if (Number.isFinite(rw) && rw > 0 && rw <= 1000) {
        rattiWeight = Math.round(rw * 100) / 100;
      } else {
        errors.push({
          field: 'rattiWeight',
          message: 'Ratti weight must be a positive number up to 1000.',
          code: 'INVALID_RATTI'
        });
      }
    }

    const certNumber = typeof b.certNumber === 'string' ? b.certNumber.trim().slice(0, 50) : undefined;
    let certStatus: 'CERTIFIED' | 'PENDING' | 'UNCERTIFIED' = 'CERTIFIED';
    if (b.certStatus === 'PENDING' || b.certStatus === 'UNCERTIFIED') {
      certStatus = b.certStatus;
    }
    const certLab = typeof b.certLab === 'string' ? b.certLab.trim().slice(0, 50) : undefined;
    const origin = typeof b.origin === 'string' && b.origin.trim() ? b.origin.trim().slice(0, 100) : undefined;
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : undefined;

    const approvedBy = typeof b.approvedBy === 'string' ? b.approvedBy.trim() : 'Owner Admin';
    if (approvedBy.length < 2 || approvedBy.length > 100) {
      errors.push({
        field: 'approvedBy',
        message: 'approvedBy must be between 2 and 100 characters.',
        code: 'INVALID_APPROVED_BY'
      });
    }

    if (errors.length > 0) return { valid: false, errors };

    return {
      valid: true,
      errors: [],
      sanitized: {
        sku,
        productId,
        approvedSellingPrice: price,
        inStock,
        caratWeight,
        rattiWeight,
        certNumber,
        certStatus,
        certLab,
        origin,
        notes,
        approvedBy
      }
    };
  }

  /**
   * Validates physical gemstone inventory updates.
   */
  public static validateUpdateInventory(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: {
      approvedSellingPrice?: number;
      inStock?: boolean;
      caratWeight?: number;
      rattiWeight?: number;
      certNumber?: string;
      certStatus?: 'CERTIFIED' | 'PENDING' | 'UNCERTIFIED';
      certLab?: string;
      origin?: string;
      notes?: string;
      updatedBy: string;
    };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }
    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    let approvedSellingPrice: number | undefined;
    if (b.approvedSellingPrice !== undefined) {
      const p = Number(b.approvedSellingPrice);
      if (!Number.isInteger(p) || p <= 0 || !Number.isFinite(p)) {
        errors.push({
          field: 'approvedSellingPrice',
          message: 'Approved selling price must be a positive integer in INR.',
          code: 'INVALID_PRICE'
        });
      } else {
        approvedSellingPrice = p;
      }
    }

    const inStock = b.inStock !== undefined ? Boolean(b.inStock) : undefined;

    let caratWeight: number | undefined;
    if (b.caratWeight !== undefined && b.caratWeight !== null && b.caratWeight !== '') {
      const cw = Number(b.caratWeight);
      if (Number.isFinite(cw) && cw > 0 && cw <= 1000) {
        caratWeight = Math.round(cw * 100) / 100;
      } else {
        errors.push({
          field: 'caratWeight',
          message: 'Carat weight must be a positive number.',
          code: 'INVALID_CARAT'
        });
      }
    }

    let rattiWeight: number | undefined;
    if (b.rattiWeight !== undefined && b.rattiWeight !== null && b.rattiWeight !== '') {
      const rw = Number(b.rattiWeight);
      if (Number.isFinite(rw) && rw > 0 && rw <= 1000) {
        rattiWeight = Math.round(rw * 100) / 100;
      } else {
        errors.push({
          field: 'rattiWeight',
          message: 'Ratti weight must be a positive number up to 1000.',
          code: 'INVALID_RATTI'
        });
      }
    }

    const certNumber = typeof b.certNumber === 'string' ? b.certNumber.trim().slice(0, 50) : undefined;
    let certStatus: 'CERTIFIED' | 'PENDING' | 'UNCERTIFIED' | undefined;
    if (b.certStatus === 'CERTIFIED' || b.certStatus === 'PENDING' || b.certStatus === 'UNCERTIFIED') {
      certStatus = b.certStatus;
    }
    const certLab = typeof b.certLab === 'string' ? b.certLab.trim().slice(0, 50) : undefined;
    const origin = typeof b.origin === 'string' && b.origin.trim() ? b.origin.trim().slice(0, 100) : undefined;
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 1000) : undefined;

    const updatedBy = typeof b.updatedBy === 'string' ? b.updatedBy.trim() : 'Owner Admin';

    if (errors.length > 0) return { valid: false, errors };

    return {
      valid: true,
      errors: [],
      sanitized: {
        approvedSellingPrice,
        inStock,
        caratWeight,
        rattiWeight,
        certNumber,
        certStatus,
        certLab,
        origin,
        notes,
        updatedBy
      }
    };
  }

  /**
   * Validates server-side payment order creation requests.
   */
  public static validateCreatePaymentOrder(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: {
      customer: CustomerContact;
      items: Array<{ productId: string; inventorySku: string; quantity: number }>;
      shippingQuoteId?: string;
      idempotencyKey: string;
    };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }

    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    // 1. Customer
    const custRes = this.validateCustomer(b.customer, true);
    if (!custRes.valid || !custRes.sanitized) {
      errors.push(...custRes.errors);
    }

    // 2. Idempotency Key
    const idempRes = this.validateIdempotencyKey(b.idempotencyKey);
    if (!idempRes.valid || !idempRes.sanitized) {
      errors.push(idempRes.error!);
    }

    // 3. Items
    const rawItems = b.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      errors.push({
        field: 'items',
        message: 'Items list must be a non-empty array.',
        code: 'EMPTY_ITEMS'
      });
    }

    const sanitizedItems: Array<{ productId: string; inventorySku: string; quantity: number }> = [];

    if (Array.isArray(rawItems)) {
      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        if (!item || typeof item !== 'object') {
          errors.push({
            field: `items[${i}]`,
            message: 'Item must be an object.',
            code: 'INVALID_ITEM'
          });
          continue;
        }

        const pId = typeof item.productId === 'string' ? item.productId.trim() : '';
        if (this.METADATA_ONLY_IDS.includes(pId)) {
          errors.push({
            field: `items[${i}].productId`,
            message: `Product ID '${pId}' is an unpurchasable metadata record.`,
            code: 'METADATA_ONLY_PRODUCT'
          });
        } else {
          const prod = getProductById(pId);
          if (!prod) {
            errors.push({
              field: `items[${i}].productId`,
              message: `Product ID '${pId}' not found in catalogue.`,
              code: 'UNKNOWN_PRODUCT'
            });
          }
        }

        const sku = typeof item.inventorySku === 'string' ? item.inventorySku.trim().toUpperCase() : '';
        if (!sku || !/^[A-Z0-9_-]{3,50}$/.test(sku)) {
          errors.push({
            field: `items[${i}].inventorySku`,
            message: 'Valid inventory SKU is required for purchasing a stone.',
            code: 'INVALID_SKU'
          });
        }

        const qty = Number(item.quantity);
        if (!Number.isInteger(qty) || qty < 1 || qty > this.MAX_QUANTITY_PER_ITEM) {
          errors.push({
            field: `items[${i}].quantity`,
            message: `Quantity must be an integer between 1 and ${this.MAX_QUANTITY_PER_ITEM}.`,
            code: 'INVALID_QUANTITY'
          });
        }

        sanitizedItems.push({
          productId: pId,
          inventorySku: sku,
          quantity: qty
        });
      }
    }

    const shippingQuoteId = typeof b.shippingQuoteId === 'string' ? b.shippingQuoteId.trim() : undefined;

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        customer: custRes.sanitized!,
        items: sanitizedItems,
        shippingQuoteId,
        idempotencyKey: idempRes.sanitized!
      }
    };
  }

  /**
   * Validates checkout payment verification request payloads.
   */
  public static validateVerifyCheckoutPayment(body: unknown): {
    valid: boolean;
    errors: ApiErrorDetail[];
    sanitized?: {
      orderId: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
      customerAccessToken?: string;
    };
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        valid: false,
        errors: [{ message: 'Request body must be a JSON object.', code: 'INVALID_BODY' }]
      };
    }

    const b = body as Record<string, unknown>;
    const errors: ApiErrorDetail[] = [];

    const orderId = typeof b.orderId === 'string' ? b.orderId.trim() : '';
    if (!orderId || !/^ord_[a-f0-9-]+$/.test(orderId)) {
      errors.push({
        field: 'orderId',
        message: 'Valid internal order ID is required.',
        code: 'INVALID_ORDER_ID'
      });
    }

    const razorpayOrderId = typeof b.razorpayOrderId === 'string'
      ? b.razorpayOrderId.trim()
      : typeof b.razorpay_order_id === 'string'
        ? b.razorpay_order_id.trim()
        : '';
    if (!razorpayOrderId || !razorpayOrderId.startsWith('order_')) {
      errors.push({
        field: 'razorpayOrderId',
        message: 'Valid Razorpay order ID is required.',
        code: 'INVALID_RAZORPAY_ORDER_ID'
      });
    }

    const razorpayPaymentId = typeof b.razorpayPaymentId === 'string'
      ? b.razorpayPaymentId.trim()
      : typeof b.razorpay_payment_id === 'string'
        ? b.razorpay_payment_id.trim()
        : '';
    if (!razorpayPaymentId || !razorpayPaymentId.startsWith('pay_')) {
      errors.push({
        field: 'razorpayPaymentId',
        message: 'Valid Razorpay payment ID is required.',
        code: 'INVALID_RAZORPAY_PAYMENT_ID'
      });
    }

    const razorpaySignature = typeof b.razorpaySignature === 'string'
      ? b.razorpaySignature.trim()
      : typeof b.razorpay_signature === 'string'
        ? b.razorpay_signature.trim()
        : '';
    if (!razorpaySignature || razorpaySignature.length < 32) {
      errors.push({
        field: 'razorpaySignature',
        message: 'Valid Razorpay signature is required.',
        code: 'INVALID_RAZORPAY_SIGNATURE'
      });
    }

    const customerAccessToken = typeof b.customerAccessToken === 'string'
      ? b.customerAccessToken.trim()
      : typeof b.token === 'string'
        ? b.token.trim()
        : undefined;

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return {
      valid: true,
      errors: [],
      sanitized: {
        orderId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        customerAccessToken
      }
    };
  }
}
