import { describe, it, expect, beforeEach } from 'vitest';
import { ProductCatalogue } from '../../src/catalogue/product-catalogue';
import { products } from '../../src/core/products';
import { productMeta } from '../../src/core/product-meta';
import { BackendService } from '../../src/backend/service';
import { MemoryBackendStorage } from '../../src/backend/storage';
import { RegisterInventoryInput, UpdateInventoryInput } from '../../src/backend/types';

describe('Stage 4A: Physical Inventory and Catalogue Readiness Tests', () => {
  const OWNER_SECRET = 'owner-test-secret-4a';
  let storage: MemoryBackendStorage;
  let service: BackendService;
  let catalogue: ProductCatalogue;

  beforeEach(() => {
    storage = new MemoryBackendStorage();
    service = new BackendService(storage, OWNER_SECRET);
    catalogue = new ProductCatalogue(products, productMeta);
  });

  describe('1. Catalogue Integrity and Metadata Consistency', () => {
    it('preserves exactly 104 verified products and 108 metadata records', () => {
      const prods = catalogue.getAllProducts();
      expect(prods.length).toBe(104);
      expect(Object.keys(productMeta).length).toBe(108);
    });

    it('verifies every catalogue product has non-empty description and provisional price ranges', () => {
      const prods = catalogue.getAllProducts();
      for (const p of prods) {
        expect(p.id).toMatch(/^p\d+$/);
        expect(p.name.trim().length).toBeGreaterThan(0);
        expect(p.category).toBeDefined();
        expect(p.description.trim().length).toBeGreaterThan(0);
        expect(p.price_min).toBeGreaterThan(0);
        expect(p.price_max).toBeGreaterThanOrEqual(p.price_min);
        // By default, baseline catalogue items are provisional
        expect(p.pricingStatus).toBeUndefined();
        expect(p.finalPrice).toBeUndefined();
        expect(p.inventorySku).toBeUndefined();
      }
    });

    it('strictly isolates metadata-only IDs (p127, p128, p129, p135) from purchasable catalogue', () => {
      const metadataOnlyIds = ['p127', 'p128', 'p129', 'p135'];
      for (const id of metadataOnlyIds) {
        expect(catalogue.getProductById(id)).toBeUndefined();
        expect(catalogue.isMetadataOnly(id)).toBe(true);
        expect(productMeta[id as keyof typeof productMeta]).toBeDefined();
      }
    });
  });

  describe('2. Physical Gemstone Inventory Lot Management', () => {
    it('registers a real physical gemstone lot with all gemological attributes', async () => {
      const input: RegisterInventoryInput = {
        sku: 'GON-RUBY-LOT-01',
        productId: 'p2',
        approvedSellingPrice: 75000,
        inStock: true,
        caratWeight: 4.15,
        certNumber: 'GIA-2198734',
        certStatus: 'CERTIFIED',
        certLab: 'GIA',
        notes: 'Natural unheated Burma Ruby, pigeon blood red hue',
        approvedBy: 'Lead Gemologist'
      };

      const record = await service.registerInventory(input, OWNER_SECRET);
      expect(record.sku).toBe('GON-RUBY-LOT-01');
      expect(record.productId).toBe('p2');
      expect(record.approvedSellingPrice).toBe(75000);
      expect(record.currency).toBe('INR');
      expect(record.inStock).toBe(true);
      expect(record.caratWeight).toBe(4.15);
      expect(record.certNumber).toBe('GIA-2198734');
      expect(record.certLab).toBe('GIA');
      expect(record.approvedBy).toBe('Lead Gemologist');

      const retrieved = await service.getInventorySnapshot('GON-RUBY-LOT-01');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.sku).toBe('GON-RUBY-LOT-01');
    });

    it('strictly prevents registering inventory under metadata-only product IDs', async () => {
      const metadataOnlyIds = ['p127', 'p128', 'p129', 'p135'];
      for (const id of metadataOnlyIds) {
        try {
          await service.registerInventory(
            {
              sku: `GON-LOT-${id.toUpperCase()}`,
              productId: id,
              approvedSellingPrice: 50000,
              approvedBy: 'Owner'
            },
            OWNER_SECRET
          );
          expect.fail('Should have thrown validation error for metadata-only ID');
        } catch (err: any) {
          expect(err.message).toMatch(/validation failed/i);
          expect(err.details[0].code).toBe('METADATA_ONLY_PRODUCT');
        }
      }
    });

    it('updates physical gemstone lot attributes (price, weight, certificates, stock)', async () => {
      await service.registerInventory(
        {
          sku: 'GON-SAPPHIRE-01',
          productId: 'p1',
          approvedSellingPrice: 120000,
          inStock: true,
          caratWeight: 5.5,
          certLab: 'IGI',
          certNumber: 'IGI-998811',
          notes: 'Ceylon Yellow Sapphire',
          approvedBy: 'Admin'
        },
        OWNER_SECRET
      );

      const updateInput: UpdateInventoryInput = {
        sku: 'GON-SAPPHIRE-01',
        approvedSellingPrice: 125000,
        caratWeight: 5.55,
        certLab: 'GIA',
        certNumber: 'GIA-776655',
        notes: 'Re-certified GIA Natural Ceylon Sapphire',
        updatedBy: 'Chief Gemologist'
      };

      const updated = await service.updateInventory('GON-SAPPHIRE-01', updateInput, OWNER_SECRET);
      expect(updated.approvedSellingPrice).toBe(125000);
      expect(updated.caratWeight).toBe(5.55);
      expect(updated.certLab).toBe('GIA');
      expect(updated.certNumber).toBe('GIA-776655');
      expect(updated.notes).toBe('Re-certified GIA Natural Ceylon Sapphire');
    });

    it('prevents changing price of a lot when reserved for an active pending order', async () => {
      await service.registerInventory(
        {
          sku: 'GON-EMERALD-LOCK',
          productId: 'p5',
          approvedSellingPrice: 45000,
          inStock: true,
          approvedBy: 'Admin'
        },
        OWNER_SECRET
      );

      // Create an order locking the stone
      const order = await service.createOrder({
        customer: {
          name: 'Lock Buyer',
          email: 'buyer@example.com',
          phone: '+919876543210',
          addressLine1: '123 Market St',
          city: 'Delhi',
          state: 'Delhi',
          postalCode: '110001',
          country: 'IN'
        },
        items: [{ productId: 'p5', inventorySku: 'GON-EMERALD-LOCK', quantity: 1 }],
        idempotencyKey: 'idemp_lock_sku_test'
      });

      expect(order.status).toBe('PENDING_PAYMENT');

      // Attempting to change price must fail with conflict
      await expect(
        service.updateInventory(
          'GON-EMERALD-LOCK',
          { sku: 'GON-EMERALD-LOCK', approvedSellingPrice: 50000, updatedBy: 'Admin' },
          OWNER_SECRET
        )
      ).rejects.toThrow(/pending order\(s\) exist/i);
    });
  });

  describe('3. Purchase-Readiness & Fail-Closed Gating', () => {
    it('fails closed when attempting to order unconfirmed catalogue products without inventory SKU', async () => {
      await expect(
        service.createOrder({
          customer: {
            name: 'Buyer',
            email: 'buyer@example.com',
            phone: '+919876543210',
            addressLine1: '123 Market St',
            city: 'Delhi',
            state: 'Delhi',
            postalCode: '110001',
            country: 'IN'
          },
          items: [{ productId: 'p1', inventorySku: 'NON-EXISTENT-SKU', quantity: 1 }],
          idempotencyKey: 'idemp_fail_closed_test'
        })
      ).rejects.toThrow(/no approved fixed selling price or is out of stock|not found/i);
    });

    it('preserves inquiry-only workflow for provisional gemstone selections', async () => {
      const inq = await service.createInquiry({
        customer: {
          name: 'Inquiry Customer',
          email: 'inq@example.com',
          phone: '+919876543299',
          country: 'IN'
        },
        items: [
          { productId: 'p1', quantity: 1 },
          { productId: 'p2', quantity: 1 }
        ],
        customerNotes: 'Looking for 4+ carat natural ruby and pukhraj',
        idempotencyKey: 'idemp_inq_flow_test'
      });

      expect(inq.id).toMatch(/^inq_/i);
      expect(inq.status).toBe('PENDING_REVIEW');
      expect(inq.items.length).toBe(2);
      expect(inq.items[0]?.productId).toBe('p1');
      expect(inq.items[1]?.productId).toBe('p2');
    });
  });
});
