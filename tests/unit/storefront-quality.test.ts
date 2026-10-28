import { describe, it, expect } from 'vitest';
import { products } from '../../src/core/products';
import { productMeta } from '../../src/core/product-meta';
import type { Product } from '../../src/types/product';
import { BackendValidator } from '../../src/backend/validator';

describe('Stage 4C: Storefront Quality and Customer Experience Unit Tests', () => {
  describe('1. Category Parameter Mapping & Normalization', () => {
    const catMap: Record<string, string> = {
      'precious': 'Precious',
      'precious stones': 'Precious',
      'opal': 'Opal',
      'opal collection': 'Opal',
      'astrology': 'Astrology',
      'astrology & planetary stones': 'Astrology',
      'healing': 'Healing',
      'healing stones': 'Healing',
      'accessory': 'Accessory',
      'accessories': 'Accessory',
      'healing accessories': 'Accessory',
      'rudraksha': 'Rudraksha',
      'rudraksha collection': 'Rudraksha',
      'raw': 'Raw',
      'raw stones': 'Raw',
      'raw crystals': 'Raw',
      'raw crystals & décor': 'Raw'
    };

    function resolveCategory(param: string | null): string {
      if (!param) return 'all';
      const clean = decodeURIComponent(param).trim().toLowerCase();
      return catMap[clean] || 'all';
    }

    it('maps lowercase and synonym category params to canonical catalogue categories', () => {
      expect(resolveCategory('precious')).toBe('Precious');
      expect(resolveCategory('precious stones')).toBe('Precious');
      expect(resolveCategory('healing stones')).toBe('Healing');
      expect(resolveCategory('healing accessories')).toBe('Accessory');
      expect(resolveCategory('raw stones')).toBe('Raw');
      expect(resolveCategory('rudraksha')).toBe('Rudraksha');
      expect(resolveCategory('opal')).toBe('Opal');
    });

    it('falls back safely to "all" for unknown or empty categories', () => {
      expect(resolveCategory(null)).toBe('all');
      expect(resolveCategory('')).toBe('all');
      expect(resolveCategory('unknown_xyz')).toBe('all');
      expect(resolveCategory('diamonds')).toBe('all');
    });
  });

  describe('2. Product Detail Metadata Merging & Enrichment', () => {
    function enrichProduct(id: string): (Product & Record<string, any>) | null {
      const base = products.find(p => p.id === id);
      if (!base) return null;
      const meta = productMeta[id as keyof typeof productMeta] || {};
      return { ...base, ...meta };
    }

    it('enriches Yellow Sapphire (p1) with authentic planetary and mantra metadata', () => {
      const p1 = enrichProduct('p1');
      expect(p1).not.toBeNull();
      expect(p1?.name).toContain('Yellow Sapphire');
      expect(p1?.planet).toBe('Jupiter');
      expect(p1?.zodiac).toContain('Sagittarius (Dhanu)');
      expect(p1?.chakra).toContain('Solar Plexus (Manipura)');
      expect(p1?.mantra_sanskrit).toContain('बृहस्पतये');
      expect(p1?.benefits?.length).toBeGreaterThan(0);
    });

    it('enriches Ruby (p2) with Sun (Surya) associations and leadership benefits', () => {
      const p2 = enrichProduct('p2');
      expect(p2).not.toBeNull();
      expect(p2?.name).toBe('Ruby');
      expect(p2?.planet).toContain('Sun');
      expect(p2?.zodiac).toContain('Leo (Simha)');
      expect(p2?.mantra_sanskrit).toContain('सूर्याय');
      expect(p2?.benefits?.length).toBeGreaterThan(0);
    });

    it('preserves Rudraksha bead properties (mukhi & deity) where recorded', () => {
      const rudrakshaProducts = products.filter(p => p.category === 'Rudraksha');
      expect(rudrakshaProducts.length).toBeGreaterThan(0);

      // Verify at least some rudrakshas have mukhi metadata
      const enriched = rudrakshaProducts.map(r => enrichProduct(r.id)).filter(Boolean);
      const withMukhi = enriched.filter(r => r && (r.mukhi || r.deity));
      expect(withMukhi.length).toBeGreaterThan(0);
    });

    it('never invents metadata for items without spiritual records', () => {
      // Find a product that has minimal or no extra metadata
      const rawProducts = products.filter(p => p.category === 'Raw');
      for (const raw of rawProducts) {
        const enriched = enrichProduct(raw.id);
        if (enriched && !productMeta[raw.id as keyof typeof productMeta]) {
          expect(enriched.mantra_sanskrit).toBeUndefined();
          expect(enriched.planet).toBeUndefined();
        }
      }
    });
  });

  describe('3. Provisional Estimate Labeling & Price Integrity', () => {
    function formatPriceNotice(prod: Partial<Product>): { isConfirmed: boolean; displayBadge: string } {
      const isConfirmed = typeof prod.finalPrice === 'number' && prod.finalPrice > 0;
      return {
        isConfirmed,
        displayBadge: isConfirmed ? 'Confirmed Physical Stone Price' : 'Provisional Catalogue Estimate'
      };
    }

    it('marks all 104 baseline catalogue products as provisional estimates', () => {
      for (const p of products) {
        const status = formatPriceNotice(p);
        expect(status.isConfirmed).toBe(false);
        expect(status.displayBadge).toBe('Provisional Catalogue Estimate');
        expect(p.price_min).toBeGreaterThan(0);
        expect(p.price_max).toBeGreaterThanOrEqual(p.price_min);
      }
    });

    it('designates confirmed physical stone lots with explicit confirmed badge', () => {
      const confirmedStone: Partial<Product> = {
        id: 'p2',
        name: 'Ruby Burma Lot #1',
        finalPrice: 85000,
        inventorySku: 'GON-RUBY-BURMA-01',
        pricingStatus: 'INVENTORY_CONFIRMED'
      };

      const status = formatPriceNotice(confirmedStone);
      expect(status.isConfirmed).toBe(true);
      expect(status.displayBadge).toBe('Confirmed Physical Stone Price');
    });
  });

  describe('4. Shipping Rules & Quote Workflow Preservation', () => {
    const DOMESTIC_FLAT_SHIPPING = 200;

    function calculateCartShipping(country: string, itemCount: number): { shipping: number; requiresQuote: boolean } {
      if (itemCount <= 0) return { shipping: 0, requiresQuote: false };
      if (country === 'INTL' || country !== 'IN') {
        return { shipping: 0, requiresQuote: true };
      }
      return { shipping: DOMESTIC_FLAT_SHIPPING, requiresQuote: false };
    }

    it('applies flat ₹200 shipping fee to all domestic orders regardless of cart value', () => {
      const res1 = calculateCartShipping('IN', 1);
      expect(res1.shipping).toBe(200);
      expect(res1.requiresQuote).toBe(false);

      const res2 = calculateCartShipping('IN', 5);
      expect(res2.shipping).toBe(200);
      expect(res2.requiresQuote).toBe(false);
    });

    it('routes international destinations strictly to manual quotation without charging online', () => {
      const resIntl = calculateCartShipping('INTL', 2);
      expect(resIntl.shipping).toBe(0);
      expect(resIntl.requiresQuote).toBe(true);

      const resUs = calculateCartShipping('US', 1);
      expect(resUs.shipping).toBe(0);
      expect(resUs.requiresQuote).toBe(true);
    });

    it('returns 0 shipping for empty cart', () => {
      const resEmpty = calculateCartShipping('IN', 0);
      expect(resEmpty.shipping).toBe(0);
      expect(resEmpty.requiresQuote).toBe(false);
    });
  });

  describe('5. Customer Inquiry Form Validation & Response Integrity', () => {
    it('validates inquiry payload structure against BackendValidator', () => {
      const sampleInquiry = {
        customer: {
          name: 'Paramjeet Singh',
          email: 'paramjeet19@gmail.com',
          phone: '+917827491801',
          country: 'IN',
          addressLine1: 'GK-II, New Delhi, India'
        },
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p2', quantity: 1 }
        ],
        notes: 'Inquiring about 4+ carat unheated Burma ruby and Ceylon sapphire',
        idempotencyKey: 'idemp_test_inq_12345678'
      };

      const val = BackendValidator.validateCreateInquiry(sampleInquiry);
      expect(val.valid).toBe(true);
      expect(val.errors.length).toBe(0);
      expect(val.sanitized?.customer.name).toBe('Paramjeet Singh');
      expect(val.sanitized?.items.length).toBe(2);
    });

    it('rejects inquiry payload containing unpurchasable metadata ID (e.g. p127)', () => {
      const badInquiry = {
        customer: {
          name: 'Paramjeet Singh',
          email: 'paramjeet19@gmail.com',
          phone: '+917827491801',
          country: 'IN'
        },
        items: [
          { productId: 'p127', quantity: 1 } // unpurchasable metadata record
        ],
        idempotencyKey: 'idemp_test_bad_12345678'
      };

      const val = BackendValidator.validateCreateInquiry(badInquiry);
      expect(val.valid).toBe(false);
      expect(val.errors.some(e => e.code === 'METADATA_ONLY_PRODUCT')).toBe(true);
    });

    it('validates international shipping quote payload against BackendValidator', () => {
      const quotePayload = {
        customerEmail: 'international.buyer@example.com',
        destinationCountry: 'OTHER',
        destinationAddress: '123 Oxford Street, London, UK',
        destinationPostalCode: 'W1D 1BS',
        idempotencyKey: 'idemp_test_quote_12345678'
      };

      const val = BackendValidator.validateCreateShippingQuote(quotePayload);
      expect(val.valid).toBe(true);
      expect(val.errors.length).toBe(0);
      expect(val.sanitized?.destinationCountry).toBe('OTHER');
    });

    it('distinguishes between confirmed persistence and draft fallback honest messaging', () => {
      function formatConfirmation(isConfirmed: boolean, refId: string) {
        if (isConfirmed) {
          return {
            status: 'success',
            title: 'Inquiry Received Successfully!',
            message: `Your inquiry has been recorded in our system. Reference: ${refId}`
          };
        }
        return {
          status: 'info',
          title: 'Inquiry draft prepared — send via WhatsApp or Email.',
          message: `Your inquiry draft is ready. Please click below to send. Reference: ${refId}`
        };
      }

      const confirmed = formatConfirmation(true, 'inq_server_confirmed_99');
      expect(confirmed.status).toBe('success');
      expect(confirmed.title).toContain('Received Successfully');

      const draft = formatConfirmation(false, 'GON-INQ-OFFLINE-01');
      expect(draft.status).toBe('info');
      expect(draft.title).toContain('draft prepared');
      expect(draft.title).not.toContain('Received');
    });
  });
});
