// src/types/cart.ts
// Cart and storage interfaces

export type LegacyCartRecord = Record<string, number>;

export interface CartItem {
  readonly productId: string;
  readonly quantity: number;
}

export interface CartCalculation {
  readonly subtotal: number;
  readonly shipping: number;
  readonly total: number;
  readonly itemCount: number;
  readonly isProvisionalEstimate?: boolean;
  readonly minSubtotal?: number;
  readonly maxSubtotal?: number;
  readonly minTotal?: number;
  readonly maxTotal?: number;
}

export type PurchaseReadinessStatus =
  | 'PROVISIONAL_INQUIRY'   // Cart contains items with provisional ranges; automated payment is blocked
  | 'READY_FOR_PAYMENT';    // All items have owner-approved inventory fixed prices

export interface PurchaseReadinessResult {
  readonly canCapturePayment: boolean;
  readonly status: PurchaseReadinessStatus;
  readonly provisionalItemIds: readonly string[];
  readonly confirmedItemIds: readonly string[];
  readonly reason: string;
}

export interface CartState {
  readonly items: ReadonlyMap<string, number>;
  readonly lastUpdated: number;
}
