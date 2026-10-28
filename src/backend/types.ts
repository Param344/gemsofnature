// src/backend/types.ts
// Stage 3B: Domain Models, Token Records, Owner Management & Audit Types

export type InquiryStatus =
  | 'DRAFT_PREPARED'
  | 'PENDING_REVIEW'
  | 'PRICE_QUOTED'
  | 'CUSTOMER_CONTACTED'
  | 'CONVERTED_TO_ORDER'
  | 'CLOSED'
  | 'CANCELLED';

export type ShippingQuoteStatus =
  | 'REQUESTED'
  | 'APPROVED_BY_OWNER'
  | 'ACCEPTED_BY_CUSTOMER'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentAttemptStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED';

export type CertStatus = 'CERTIFIED' | 'PENDING' | 'UNCERTIFIED';

export type AuditEntityType = 'INQUIRY' | 'QUOTE' | 'INVENTORY' | 'ORDER';

export interface CustomerContact {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly country: string; // ISO 2-letter or standard name (e.g., 'IN', 'US')
  readonly addressLine1?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
}

export interface CustomerTokenRecord {
  readonly id: string;
  readonly token: string;
  readonly resourceType: 'INQUIRY' | 'QUOTE' | 'ORDER';
  readonly resourceId: string;
  readonly customerEmail: string;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface InquiryItemInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface InquiryItemRecord {
  readonly id: string;
  readonly inquiryId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly provisionalMinUnit: number;
  readonly provisionalMaxUnit: number;
  readonly createdAt: number;
}

export interface InquiryNoteRecord {
  readonly id: string;
  readonly inquiryId: string;
  readonly author: string;
  readonly note: string;
  readonly createdAt: number;
}

export interface InquiryRecord {
  readonly id: string;
  readonly customerName: string;
  readonly customerEmail: string;
  readonly customerPhone?: string;
  readonly destinationCountry: string;
  readonly status: InquiryStatus;
  readonly notes?: string; // customer's initial notes
  readonly internalNotes?: readonly InquiryNoteRecord[];
  readonly items: readonly InquiryItemRecord[];
  readonly idempotencyKey: string;
  readonly customerAccessToken?: string;
  readonly tokenExpiresAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateInquiryRequest {
  readonly customer: CustomerContact;
  readonly items: readonly InquiryItemInput[];
  readonly notes?: string;
  readonly idempotencyKey: string;
}

export interface ShippingQuoteRecord {
  readonly id: string;
  readonly customerEmail: string;
  readonly destinationCountry: string;
  readonly destinationPostalCode?: string;
  readonly destinationAddress?: string;
  readonly status: ShippingQuoteStatus;
  readonly quotedAmount?: number;
  readonly quotedCurrency?: string;
  readonly rejectionReason?: string;
  readonly expiresAt?: number;
  readonly acceptedAt?: number;
  readonly cancelledAt?: number;
  readonly idempotencyKey: string;
  readonly customerAccessToken?: string;
  readonly tokenExpiresAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateShippingQuoteRequest {
  readonly customerEmail: string;
  readonly destinationCountry: string;
  readonly destinationPostalCode?: string;
  readonly destinationAddress?: string;
  readonly idempotencyKey: string;
}

export interface ApproveShippingQuoteInput {
  readonly quoteId: string;
  readonly quotedAmount: number;
  readonly quotedCurrency: string;
  readonly validityHours: number;
  readonly ownerSecret: string;
}

export interface RejectShippingQuoteInput {
  readonly quoteId: string;
  readonly reason: string;
  readonly ownerSecret: string;
}

export interface OrderItemRecord {
  readonly id: string;
  readonly orderId: string;
  readonly productId: string;
  readonly inventorySku: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
  readonly createdAt: number;
}

export interface OrderRecord {
  readonly id: string;
  readonly customer: CustomerContact;
  readonly items: readonly OrderItemRecord[];
  readonly shippingFee: number;
  readonly subtotal: number;
  readonly total: number;
  readonly currency: 'INR';
  readonly status: OrderStatus;
  readonly shippingQuoteId?: string;
  readonly idempotencyKey: string;
  readonly customerAccessToken?: string;
  readonly tokenExpiresAt?: number;
  readonly razorpayOrderId?: string;
  readonly razorpayPaymentId?: string;
  readonly paymentConfirmedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OrderItemInput {
  readonly productId: string;
  readonly inventorySku: string;
  readonly quantity: number;
}

export interface CreateOrderRequest {
  readonly customer: CustomerContact;
  readonly items: readonly OrderItemInput[];
  readonly shippingQuoteId?: string;
  readonly idempotencyKey: string;
}

export interface InventorySnapshotRecord {
  readonly sku: string;
  readonly productId: string;
  readonly approvedSellingPrice: number;
  readonly currency: 'INR';
  readonly inStock: boolean;
  readonly reservedOrderId?: string;
  readonly caratWeight?: number;
  readonly rattiWeight?: number;
  readonly certNumber?: string;
  readonly certStatus?: CertStatus;
  readonly certLab?: string;
  readonly origin?: string;
  readonly notes?: string;
  readonly approvedBy: string;
  readonly approvedAt: number;
  readonly updatedAt: number;
}

export interface RegisterInventoryInput {
  readonly sku: string;
  readonly productId: string;
  readonly approvedSellingPrice: number;
  readonly inStock?: boolean;
  readonly caratWeight?: number;
  readonly rattiWeight?: number;
  readonly certNumber?: string;
  readonly certStatus?: CertStatus;
  readonly certLab?: string;
  readonly origin?: string;
  readonly notes?: string;
  readonly approvedBy: string;
}

export interface UpdateInventoryInput {
  readonly sku: string;
  readonly approvedSellingPrice?: number;
  readonly inStock?: boolean;
  readonly caratWeight?: number;
  readonly rattiWeight?: number;
  readonly certNumber?: string;
  readonly certStatus?: CertStatus;
  readonly certLab?: string;
  readonly origin?: string;
  readonly notes?: string;
  readonly updatedBy: string;
}

export interface PaymentAttemptRecord {
  readonly id: string;
  readonly orderId: string;
  readonly gateway: 'RAZORPAY';
  readonly gatewayOrderId?: string;
  readonly gatewayPaymentId?: string;
  readonly status: PaymentAttemptStatus;
  readonly amount: number;
  readonly amountSubunits?: number;
  readonly currency: 'INR';
  readonly signature?: string;
  readonly errorMessage?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface IdempotencyRecord {
  readonly key: string;
  readonly resourceType: 'INQUIRY' | 'QUOTE' | 'ORDER';
  readonly resourceId: string;
  readonly responseStatus: number;
  readonly responseBody: string;
  readonly createdAt: number;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
  readonly action: string;
  readonly actor: string;
  readonly detailsJson?: string;
  readonly createdAt: number;
}

export interface PaginationOptions {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: string;
  readonly query?: string;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly data: T;
}

export interface ApiErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code: string;
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ApiErrorDetail[];
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ==========================================
// STAGE 3C: RAZORPAY PAYMENT & WEBHOOK TYPES
// ==========================================

export interface CreatePaymentOrderInput {
  readonly customer: CustomerContact;
  readonly items: readonly OrderItemInput[];
  readonly shippingQuoteId?: string;
  readonly idempotencyKey: string;
}

export interface CreatePaymentOrderResult {
  readonly orderId: string;
  readonly razorpayOrderId: string;
  readonly razorpayKeyId: string;
  readonly amountSubunits: number;
  readonly amount: number;
  readonly currency: 'INR';
  readonly customerAccessToken: string;
}

export interface VerifyCheckoutPaymentInput {
  readonly orderId: string;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
  readonly customerAccessToken?: string;
}

export interface VerifyCheckoutPaymentResult {
  readonly success: boolean;
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly paymentId: string;
  readonly captureStatus?: 'captured' | 'authorized' | 'failed' | 'pending';
  readonly verifiedAt: number;
  readonly message?: string;
}

export interface WebhookEventRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED';
  readonly payloadJson?: string;
  readonly errorMessage?: string;
  readonly processedAt?: number;
  readonly createdAt: number;
}

export interface WebhookProcessingResult {
  readonly success: boolean;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: 'RECEIVED' | 'PROCESSED' | 'FAILED' | 'IGNORED';
  readonly message?: string;
}

export interface RazorpayOrderCreationParams {
  readonly amount: number; // in paise
  readonly currency: string;
  readonly receipt: string;
  readonly notes?: Record<string, string>;
}

export interface RazorpayOrderResponse {
  readonly id: string;
  readonly entity: 'order';
  readonly amount: number;
  readonly amount_paid: number;
  readonly amount_due: number;
  readonly currency: string;
  readonly receipt: string;
  readonly status: 'created' | 'attempted' | 'paid';
  readonly attempts: number;
  readonly notes?: Record<string, string>;
  readonly created_at: number;
}

export interface RazorpayPaymentDetails {
  readonly id: string;
  readonly entity: 'payment';
  readonly amount: number;
  readonly currency: string;
  readonly status: 'captured' | 'authorized' | 'failed';
  readonly order_id: string;
  readonly method?: string;
  readonly email?: string;
  readonly contact?: string;
  readonly error_code?: string | null;
  readonly error_description?: string | null;
}

export interface IRazorpayClient {
  createOrder(params: RazorpayOrderCreationParams): Promise<RazorpayOrderResponse>;
  fetchPayment(paymentId: string): Promise<RazorpayPaymentDetails>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): Promise<boolean>;
  verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean>;
}

