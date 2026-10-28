// src/inventory/csv-importer.ts
// Stage 4B: Physical gemstone inventory CSV intake, row validation, batch preview, and template generation

import { products } from '../core/products';
import { BackendValidator } from '../backend/validator';
import { RegisterInventoryInput } from '../backend/types';

export interface CsvInventoryRow extends RegisterInventoryInput {
  readonly rowNumber: number;
}

export interface RowValidationError {
  readonly rowNumber: number;
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface BatchValidationResult {
  readonly totalRows: number;
  readonly validRows: readonly CsvInventoryRow[];
  readonly errors: readonly RowValidationError[];
  readonly isValid: boolean;
}

export interface ParsedCsvResult {
  readonly headers: readonly string[];
  readonly rawRows: readonly { readonly rowNumber: number; readonly data: Record<string, string> }[];
  readonly parseErrors: readonly string[];
}

/**
 * Standard CSV Template with gemological headers and explicit instructions.
 */
export const INVENTORY_CSV_HEADERS: readonly string[] = Object.freeze([
  'sku',
  'product_id',
  'approved_price_inr',
  'carat_weight',
  'ratti_weight',
  'in_stock',
  'cert_lab',
  'cert_number',
  'origin',
  'notes'
]);

/**
 * Clearly labelled sample test data for testing and mock previews only.
 * NEVER treat this as real or confirmed physical inventory.
 */
export const SAMPLE_TEST_INVENTORY_CSV = `# [SAMPLE TEST DATA - NOT REAL INVENTORY - FOR TESTING PURPOSES ONLY]
sku,product_id,approved_price_inr,carat_weight,ratti_weight,in_stock,cert_lab,cert_number,origin,notes
TEST-RUBY-001,p2,75000,4.15,4.55,true,GIA,GIA-2198734,Burma,"Sample natural unheated Burma Ruby"
TEST-SAPPHIRE-001,p1,120000,5.50,6.04,true,IGI,IGI-998811,Ceylon,"Sample natural Ceylon Yellow Sapphire"
TEST-EMERALD-001,p5,45000,3.20,3.51,true,GJEPC,GJEPC-554422,Zambia,"Sample natural Zambian Emerald"
`;

/**
 * Robust CSV parser that handles quotes, escaped quotes (""), commas, and CRLF / LF line endings.
 */
export function parseInventoryCsv(csvText: string): ParsedCsvResult {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rawRows: [], parseErrors: ['CSV content is empty or invalid.'] };
  }

  let currentField = '';
  let insideQuotes = false;
  let currentLine: string[] = [];
  const parseErrors: string[] = [];

  // Parse characters into cells and lines
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      currentLine.push(currentField.trim());
      // Skip empty or comment lines
      const lineStr = currentLine.join('').trim();
      if (lineStr && !currentLine[0]?.startsWith('#')) {
        rows.push(currentLine);
      }
      currentLine = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Push final field / line if exists
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    const lineStr = currentLine.join('').trim();
    if (lineStr && !currentLine[0]?.startsWith('#')) {
      rows.push(currentLine);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rawRows: [], parseErrors: ['No valid data rows found in CSV.'] };
  }

  // First row is headers
  const headerRow = rows[0];
  if (!headerRow) {
    return { headers: [], rawRows: [], parseErrors: ['No valid header row found in CSV.'] };
  }
  const rawHeaders = headerRow.map(h => normalizeHeader(h));
  const validDataRows: { rowNumber: number; data: Record<string, string> }[] = [];

  for (let r = 1; r < rows.length; r++) {
    const rowCells = rows[r];
    if (!rowCells) continue;
    const rowData: Record<string, string> = {};

    for (let c = 0; c < rawHeaders.length; c++) {
      const header = rawHeaders[c];
      if (header) {
        const cellVal = rowCells[c];
        rowData[header] = (cellVal !== undefined && cellVal !== null) ? cellVal : '';
      }
    }

    validDataRows.push({
      rowNumber: r + 1, // 1-based index including header
      data: rowData
    });
  }

  return {
    headers: rawHeaders,
    rawRows: validDataRows,
    parseErrors
  };
}

/**
 * Normalizes header keys to canonical attribute names.
 */
function normalizeHeader(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (clean === 'sku') return 'sku';
  if (clean === 'productid' || clean === 'product' || clean === 'catalogueid') return 'productId';
  if (clean === 'approvedpriceinr' || clean === 'approvedprice' || clean === 'price' || clean === 'priceinr') return 'approvedSellingPrice';
  if (clean === 'caratweight' || clean === 'carat' || clean === 'weight') return 'caratWeight';
  if (clean === 'rattiweight' || clean === 'ratti') return 'rattiWeight';
  if (clean === 'instock' || clean === 'stock' || clean === 'available') return 'inStock';
  if (clean === 'certlab' || clean === 'laboratory' || clean === 'lab') return 'certLab';
  if (clean === 'certnumber' || clean === 'cert' || clean === 'certificatenumber') return 'certNumber';
  if (clean === 'certstatus') return 'certStatus';
  if (clean === 'origin' || clean === 'provenance') return 'origin';
  if (clean === 'notes' || clean === 'description' || clean === 'provenancenotes') return 'notes';
  if (clean === 'approvedby' || clean === 'author') return 'approvedBy';
  return clean;
}

/**
 * Validates an entire batch of parsed CSV rows against all gemological, pricing, and catalogue rules.
 */
export function validateInventoryBatch(
  rawRows: readonly { readonly rowNumber: number; readonly data: Record<string, string> }[],
  existingDbSkus: ReadonlySet<string> = new Set(),
  defaultApprovedBy = 'Owner Admin'
): BatchValidationResult {
  const errors: RowValidationError[] = [];
  const validRows: CsvInventoryRow[] = [];
  const seenBatchSkus = new Set<string>();

  const catalogueProductIds = new Set(products.map(p => p.id));

  for (const { rowNumber, data } of rawRows) {
    let rowHasError = false;

    // 1. SKU validation
    const rawSku = (data.sku || '').trim().toUpperCase();
    if (!rawSku) {
      errors.push({
        rowNumber,
        field: 'sku',
        message: 'Missing mandatory SKU identifier.',
        code: 'MISSING_SKU'
      });
      rowHasError = true;
    } else if (!/^[A-Z0-9_-]{3,50}$/.test(rawSku)) {
      errors.push({
        rowNumber,
        field: 'sku',
        message: `Invalid SKU format '${rawSku}'. Must be 3-50 uppercase alphanumeric characters, dashes, or underscores.`,
        code: 'INVALID_SKU'
      });
      rowHasError = true;
    } else if (seenBatchSkus.has(rawSku)) {
      errors.push({
        rowNumber,
        field: 'sku',
        message: `Duplicate SKU '${rawSku}' detected within the same import file.`,
        code: 'DUPLICATE_SKU_IN_BATCH'
      });
      rowHasError = true;
    } else if (existingDbSkus.has(rawSku)) {
      errors.push({
        rowNumber,
        field: 'sku',
        message: `SKU '${rawSku}' already exists in registered database inventory.`,
        code: 'SKU_ALREADY_EXISTS'
      });
      rowHasError = true;
    } else {
      seenBatchSkus.add(rawSku);
    }

    // 2. Product ID validation
    const rawProductId = (data.productId || '').trim();
    if (!rawProductId) {
      errors.push({
        rowNumber,
        field: 'product_id',
        message: 'Missing mandatory catalogue product ID.',
        code: 'MISSING_PRODUCT_ID'
      });
      rowHasError = true;
    } else if (BackendValidator.METADATA_ONLY_IDS.includes(rawProductId)) {
      errors.push({
        rowNumber,
        field: 'product_id',
        message: `Product ID '${rawProductId}' is an unpurchasable metadata record.`,
        code: 'METADATA_ONLY_PRODUCT'
      });
      rowHasError = true;
    } else if (!catalogueProductIds.has(rawProductId)) {
      errors.push({
        rowNumber,
        field: 'product_id',
        message: `Product ID '${rawProductId}' not found in active 104-item catalogue.`,
        code: 'UNKNOWN_PRODUCT'
      });
      rowHasError = true;
    }

    // 3. Approved Selling Price validation
    const rawPrice = (data.approvedSellingPrice || '').trim().replace(/,/g, '');
    let price = 0;
    if (!rawPrice) {
      errors.push({
        rowNumber,
        field: 'approved_price_inr',
        message: 'Missing mandatory approved selling price in INR.',
        code: 'MISSING_PRICE'
      });
      rowHasError = true;
    } else {
      const numPrice = Number(rawPrice);
      if (!Number.isInteger(numPrice) || numPrice <= 0 || !Number.isFinite(numPrice)) {
        errors.push({
          rowNumber,
          field: 'approved_price_inr',
          message: `Approved selling price '${rawPrice}' must be a positive integer in INR.`,
          code: 'INVALID_PRICE'
        });
        rowHasError = true;
      } else {
        price = numPrice;
      }
    }

    // 4. Carat Weight validation (optional)
    const rawCarat = (data.caratWeight || '').trim();
    let caratWeight: number | undefined;
    if (rawCarat) {
      const numCarat = Number(rawCarat);
      if (!Number.isFinite(numCarat) || numCarat <= 0 || numCarat > 1000) {
        errors.push({
          rowNumber,
          field: 'carat_weight',
          message: `Carat weight '${rawCarat}' must be a positive number up to 1000.`,
          code: 'INVALID_CARAT'
        });
        rowHasError = true;
      } else {
        caratWeight = Math.round(numCarat * 100) / 100;
      }
    }

    // 5. Ratti Weight validation (optional)
    const rawRatti = (data.rattiWeight || '').trim();
    let rattiWeight: number | undefined;
    if (rawRatti) {
      const numRatti = Number(rawRatti);
      if (!Number.isFinite(numRatti) || numRatti <= 0 || numRatti > 1000) {
        errors.push({
          rowNumber,
          field: 'ratti_weight',
          message: `Ratti weight '${rawRatti}' must be a positive number up to 1000.`,
          code: 'INVALID_RATTI'
        });
        rowHasError = true;
      } else {
        rattiWeight = Math.round(numRatti * 100) / 100;
      }
    }

    // 6. In Stock parsing (defaults to true)
    const rawStock = (data.inStock || '').trim().toLowerCase();
    let inStock = true;
    if (rawStock === 'false' || rawStock === '0' || rawStock === 'out_of_stock' || rawStock === 'no') {
      inStock = false;
    }

    // 7. Cert details
    const certNumber = (data.certNumber || '').trim().slice(0, 50) || undefined;
    const certLab = (data.certLab || '').trim().slice(0, 50) || undefined;
    const certStatus = certNumber ? 'CERTIFIED' : 'UNCERTIFIED';

    // 8. Origin and Notes
    const origin = (data.origin || '').trim().slice(0, 100) || undefined;
    const notes = (data.notes || '').trim().slice(0, 1000) || undefined;
    const approvedBy = (data.approvedBy || '').trim().slice(0, 100) || defaultApprovedBy;

    if (!rowHasError) {
      validRows.push({
        rowNumber,
        sku: rawSku,
        productId: rawProductId,
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
      });
    }
  }

  return {
    totalRows: rawRows.length,
    validRows,
    errors,
    isValid: errors.length === 0
  };
}

/**
 * Generates an empty, annotated CSV template string for owner download.
 */
export function generateInventoryCsvTemplate(): string {
  return [
    '# Gems of Nature - Physical Gemstone Inventory Registration Template',
    '# Mandatory fields: sku, product_id, approved_price_inr',
    '# Optional fields: carat_weight, ratti_weight, in_stock (true/false), cert_lab (GIA/IGI/GJEPC), cert_number, origin, notes',
    '# Note: Product IDs must belong to the active 104 catalogue products. Metadata IDs (p127-p135) are unpurchasable.',
    INVENTORY_CSV_HEADERS.join(','),
    'GON-RUBY-LOT-01,p2,75000,4.15,4.55,true,GIA,GIA-2198734,Burma,"Natural unheated Burma Ruby"',
    'GON-SAPPHIRE-LOT-01,p1,120000,5.50,6.04,true,IGI,IGI-998811,Ceylon,"Natural unheated Yellow Sapphire (Pukhraj)"'
  ].join('\n');
}
