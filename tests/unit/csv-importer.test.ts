import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseInventoryCsv,
  validateInventoryBatch,
  generateInventoryCsvTemplate,
  INVENTORY_CSV_HEADERS,
  SAMPLE_TEST_INVENTORY_CSV
} from '../../src/inventory/csv-importer';
import { BackendService } from '../../src/backend/service';
import { MemoryBackendStorage } from '../../src/backend/storage';

describe('Stage 4B: Physical Inventory CSV Importer Unit Tests', () => {
  const OWNER_SECRET = 'owner-test-secret-4b';
  let storage: MemoryBackendStorage;
  let service: BackendService;

  beforeEach(() => {
    storage = new MemoryBackendStorage();
    service = new BackendService(storage, OWNER_SECRET);
  });

  describe('1. CSV Parsing (parseInventoryCsv)', () => {
    it('handles empty or whitespace-only CSV input safely', () => {
      const res1 = parseInventoryCsv('');
      expect(res1.parseErrors.length).toBeGreaterThan(0);
      expect(res1.rawRows.length).toBe(0);

      const res2 = parseInventoryCsv('   \n  \n');
      expect(res2.parseErrors.length).toBeGreaterThan(0);
      expect(res2.rawRows.length).toBe(0);
    });

    it('ignores comments and blank lines', () => {
      const csv = `# Comment line 1\n# Comment line 2\nsku,product_id,approved_price_inr\n\nLOT-01,p1,50000\n`;
      const res = parseInventoryCsv(csv);
      expect(res.parseErrors.length).toBe(0);
      expect(res.rawRows.length).toBe(1);
      expect(res.rawRows[0]?.data.sku).toBe('LOT-01');
      expect(res.rawRows[0]?.data.productId).toBe('p1');
      expect(res.rawRows[0]?.data.approvedSellingPrice).toBe('50000');
    });

    it('correctly handles quoted cells with embedded commas', () => {
      const csv = `sku,product_id,approved_price_inr,notes\nLOT-02,p2,75000,"Burma, unheated, vivid red"\n`;
      const res = parseInventoryCsv(csv);
      expect(res.rawRows.length).toBe(1);
      expect(res.rawRows[0]?.data.notes).toBe('Burma, unheated, vivid red');
    });

    it('correctly handles escaped quotes within quoted cells', () => {
      const csv = `sku,product_id,approved_price_inr,notes\nLOT-03,p3,90000,"Burma ""Pigeon Blood"" ruby"\n`;
      const res = parseInventoryCsv(csv);
      expect(res.rawRows.length).toBe(1);
      expect(res.rawRows[0]?.data.notes).toBe('Burma "Pigeon Blood" ruby');
    });

    it('supports CRLF line endings from Windows file exports', () => {
      const csv = "sku,product_id,approved_price_inr\r\nLOT-04,p4,15000\r\nLOT-05,p5,25000\r\n";
      const res = parseInventoryCsv(csv);
      expect(res.rawRows.length).toBe(2);
      expect(res.rawRows[0]?.data.sku).toBe('LOT-04');
      expect(res.rawRows[1]?.data.sku).toBe('LOT-05');
    });

    it('normalizes flexible header name variations', () => {
      const csv = `SKU,Product,Approved_Price_INR,Carat,Ratti,Stock,Lab,Cert,Provenance\nLOT-06,p6,30000,3.5,3.85,true,GIA,GIA-123,Ceylon\n`;
      const res = parseInventoryCsv(csv);
      const row = res.rawRows[0]?.data;
      expect(row).toBeDefined();
      if (!row) return;
      expect(row.sku).toBe('LOT-06');
      expect(row.productId).toBe('p6');
      expect(row.approvedSellingPrice).toBe('30000');
      expect(row.caratWeight).toBe('3.5');
      expect(row.rattiWeight).toBe('3.85');
      expect(row.inStock).toBe('true');
      expect(row.certLab).toBe('GIA');
      expect(row.certNumber).toBe('GIA-123');
      expect(row.origin).toBe('Ceylon');
    });
  });

  describe('2. Batch Row Validation (validateInventoryBatch)', () => {
    it('validates a correct inventory row successfully', () => {
      const rows = [
        {
          rowNumber: 2,
          data: {
            sku: 'GON-RUBY-001',
            productId: 'p2',
            approvedSellingPrice: '75000',
            caratWeight: '4.15',
            rattiWeight: '4.55',
            inStock: 'true',
            certLab: 'GIA',
            certNumber: 'GIA-2198734',
            origin: 'Burma',
            notes: 'Finest natural ruby'
          }
        }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(true);
      expect(res.errors.length).toBe(0);
      expect(res.validRows.length).toBe(1);

      const valid = res.validRows[0];
      expect(valid).toBeDefined();
      if (!valid) return;
      expect(valid.sku).toBe('GON-RUBY-001');
      expect(valid.productId).toBe('p2');
      expect(valid.approvedSellingPrice).toBe(75000);
      expect(valid.caratWeight).toBe(4.15);
      expect(valid.rattiWeight).toBe(4.55);
      expect(valid.inStock).toBe(true);
      expect(valid.certLab).toBe('GIA');
      expect(valid.certNumber).toBe('GIA-2198734');
      expect(valid.certStatus).toBe('CERTIFIED');
      expect(valid.origin).toBe('Burma');
    });

    it('rejects missing or invalid SKU format', () => {
      const rows = [
        { rowNumber: 2, data: { sku: '', productId: 'p1', approvedSellingPrice: '10000' } },
        { rowNumber: 3, data: { sku: 'AB', productId: 'p1', approvedSellingPrice: '10000' } }, // too short
        { rowNumber: 4, data: { sku: 'INVALID SKU!', productId: 'p1', approvedSellingPrice: '10000' } } // illegal characters
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBe(3);
      expect(res.errors[0]?.code).toBe('MISSING_SKU');
      expect(res.errors[1]?.code).toBe('INVALID_SKU');
      expect(res.errors[2]?.code).toBe('INVALID_SKU');
    });

    it('detects duplicate SKUs within the same CSV batch', () => {
      const rows = [
        { rowNumber: 2, data: { sku: 'GON-DUP-01', productId: 'p1', approvedSellingPrice: '10000' } },
        { rowNumber: 3, data: { sku: 'GON-DUP-01', productId: 'p2', approvedSellingPrice: '20000' } }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      const dupError = res.errors.find(e => e.code === 'DUPLICATE_SKU_IN_BATCH');
      expect(dupError).toBeDefined();
      expect(dupError?.rowNumber).toBe(3);
      expect(res.validRows.length).toBe(1);
    });

    it('detects duplicate SKUs already registered in database', () => {
      const existingDbSkus = new Set(['GON-EXISTING-99']);
      const rows = [
        { rowNumber: 2, data: { sku: 'GON-EXISTING-99', productId: 'p1', approvedSellingPrice: '10000' } }
      ];

      const res = validateInventoryBatch(rows, existingDbSkus);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]?.code).toBe('SKU_ALREADY_EXISTS');
      expect(res.validRows.length).toBe(0);
    });

    it('strictly rejects metadata-only product IDs (p127, p128, p129, p135)', () => {
      const metadataIds = ['p127', 'p128', 'p129', 'p135'];
      const rows = metadataIds.map((id, index) => ({
        rowNumber: index + 2,
        data: { sku: `GON-META-0${index}`, productId: id, approvedSellingPrice: '50000' }
      }));

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBe(4);
      for (const err of res.errors) {
        expect(err.code).toBe('METADATA_ONLY_PRODUCT');
        expect(err.message).toContain('unpurchasable metadata record');
      }
      expect(res.validRows.length).toBe(0);
    });

    it('rejects unknown product IDs not in catalogue', () => {
      const rows = [
        { rowNumber: 2, data: { sku: 'GON-UNKNOWN-01', productId: 'p999', approvedSellingPrice: '10000' } }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      expect(res.errors[0]?.code).toBe('UNKNOWN_PRODUCT');
      expect(res.errors[0]?.message).toContain('not found in active 104-item catalogue');
    });

    it('rejects missing, non-positive, or non-integer approved selling prices', () => {
      const rows = [
        { rowNumber: 2, data: { sku: 'GON-PRC-01', productId: 'p1', approvedSellingPrice: '' } },
        { rowNumber: 3, data: { sku: 'GON-PRC-02', productId: 'p1', approvedSellingPrice: '0' } },
        { rowNumber: 4, data: { sku: 'GON-PRC-03', productId: 'p1', approvedSellingPrice: '-500' } },
        { rowNumber: 5, data: { sku: 'GON-PRC-04', productId: 'p1', approvedSellingPrice: '12500.50' } },
        { rowNumber: 6, data: { sku: 'GON-PRC-05', productId: 'p1', approvedSellingPrice: 'invalid' } }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBe(5);
      expect(res.errors[0]?.code).toBe('MISSING_PRICE');
      expect(res.errors[1]?.code).toBe('INVALID_PRICE');
      expect(res.errors[2]?.code).toBe('INVALID_PRICE');
      expect(res.errors[3]?.code).toBe('INVALID_PRICE');
      expect(res.errors[4]?.code).toBe('INVALID_PRICE');
    });

    it('validates carat and ratti weight limits accurately', () => {
      const rows: { rowNumber: number; data: Record<string, string> }[] = [
        { rowNumber: 2, data: { sku: 'GON-WT-01', productId: 'p1', approvedSellingPrice: '10000', caratWeight: '-1' } },
        { rowNumber: 3, data: { sku: 'GON-WT-02', productId: 'p1', approvedSellingPrice: '10000', caratWeight: '1500' } },
        { rowNumber: 4, data: { sku: 'GON-WT-03', productId: 'p1', approvedSellingPrice: '10000', rattiWeight: '-0.5' } },
        { rowNumber: 5, data: { sku: 'GON-WT-04', productId: 'p1', approvedSellingPrice: '10000', rattiWeight: '2000' } }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(false);
      expect(res.errors.length).toBe(4);
      expect(res.errors[0]?.code).toBe('INVALID_CARAT');
      expect(res.errors[1]?.code).toBe('INVALID_CARAT');
      expect(res.errors[2]?.code).toBe('INVALID_RATTI');
      expect(res.errors[3]?.code).toBe('INVALID_RATTI');
    });

    it('correctly maps boolean stock status indicators', () => {
      const rows = [
        { rowNumber: 2, data: { sku: 'GON-STK-01', productId: 'p1', approvedSellingPrice: '10000', inStock: 'true' } },
        { rowNumber: 3, data: { sku: 'GON-STK-02', productId: 'p1', approvedSellingPrice: '10000', inStock: 'false' } },
        { rowNumber: 4, data: { sku: 'GON-STK-03', productId: 'p1', approvedSellingPrice: '10000', inStock: 'out_of_stock' } },
        { rowNumber: 5, data: { sku: 'GON-STK-04', productId: 'p1', approvedSellingPrice: '10000', inStock: '0' } },
        { rowNumber: 6, data: { sku: 'GON-STK-05', productId: 'p1', approvedSellingPrice: '10000', inStock: '' } }
      ];

      const res = validateInventoryBatch(rows);
      expect(res.isValid).toBe(true);
      expect(res.validRows[0]?.inStock).toBe(true);
      expect(res.validRows[1]?.inStock).toBe(false);
      expect(res.validRows[2]?.inStock).toBe(false);
      expect(res.validRows[3]?.inStock).toBe(false);
      expect(res.validRows[4]?.inStock).toBe(true); // default true
    });
  });

  describe('3. Template and Sample Test Inventory Consistency', () => {
    it('generates a valid CSV template containing all mandatory and gemological headers', () => {
      const tpl = generateInventoryCsvTemplate();
      expect(tpl).toContain('sku,product_id,approved_price_inr');
      for (const h of INVENTORY_CSV_HEADERS) {
        expect(tpl).toContain(h);
      }

      const parsed = parseInventoryCsv(tpl);
      expect(parsed.parseErrors.length).toBe(0);
      expect(parsed.rawRows.length).toBeGreaterThan(0);
    });

    it('verifies SAMPLE_TEST_INVENTORY_CSV is clearly labelled as non-real test data and parses cleanly', () => {
      expect(SAMPLE_TEST_INVENTORY_CSV).toContain('[SAMPLE TEST DATA - NOT REAL INVENTORY - FOR TESTING PURPOSES ONLY]');
      const parsed = parseInventoryCsv(SAMPLE_TEST_INVENTORY_CSV);
      expect(parsed.parseErrors.length).toBe(0);
      expect(parsed.rawRows.length).toBe(3);

      const validation = validateInventoryBatch(parsed.rawRows);
      expect(validation.isValid).toBe(true);
      expect(validation.validRows.length).toBe(3);

      for (const row of validation.validRows) {
        expect(row.sku).toMatch(/^TEST-/);
        expect(row.approvedSellingPrice).toBeGreaterThan(0);
        expect(row.caratWeight).toBeGreaterThan(0);
        expect(row.rattiWeight).toBeGreaterThan(0);
      }
    });
  });

  describe('4. BackendService Batch Validation & Import Integration', () => {
    it('validates a batch CSV via service without persisting changes', async () => {
      const res = await service.validateInventoryBatch(SAMPLE_TEST_INVENTORY_CSV, OWNER_SECRET);
      expect(res.isValid).toBe(true);
      expect(res.validRows.length).toBe(3);

      // Verify no records were saved yet
      const list = await storage.listInventorySnapshots();
      expect(list.total).toBe(0);
    });

    it('imports valid rows via service and updates persistence', async () => {
      const importRes = await service.importInventoryBatch(SAMPLE_TEST_INVENTORY_CSV, OWNER_SECRET);
      expect(importRes.importedCount).toBe(3);
      expect(importRes.failedCount).toBe(0);
      expect(importRes.results.every(r => r.status === 'SUCCESS')).toBe(true);

      const list = await storage.listInventorySnapshots();
      expect(list.total).toBe(3);

      const ruby = await storage.getInventorySnapshotBySku('TEST-RUBY-001');
      expect(ruby).not.toBeNull();
      expect(ruby?.approvedSellingPrice).toBe(75000);
      expect(ruby?.caratWeight).toBe(4.15);
      expect(ruby?.rattiWeight).toBe(4.55);
      expect(ruby?.origin).toBe('Burma');
      expect(ruby?.certLab).toBe('GIA');
    });

    it('rejects duplicate SKUs if re-importing the same batch', async () => {
      // First import
      await service.importInventoryBatch(SAMPLE_TEST_INVENTORY_CSV, OWNER_SECRET);

      // Second import attempt should report errors during validation
      const validation = await service.validateInventoryBatch(SAMPLE_TEST_INVENTORY_CSV, OWNER_SECRET);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.length).toBe(3);
      for (const err of validation.errors) {
        expect(err.code).toBe('SKU_ALREADY_EXISTS');
      }
    });

    it('rejects batch import if all rows have errors', async () => {
      const invalidCsv = `sku,product_id,approved_price_inr\np127_sku,p127,1000\n`; // p127 is metadata-only
      await expect(service.importInventoryBatch(invalidCsv, OWNER_SECRET)).rejects.toThrow(
        /Batch import failed: all 1 row\(s\) contain validation errors/
      );
    });
  });
});
