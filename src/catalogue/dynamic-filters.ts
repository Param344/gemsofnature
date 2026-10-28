// src/catalogue/dynamic-filters.ts
// Stage 4B: Dynamic catalogue filter evaluation, attribute extractors, and availability auditing

import type { Product } from '../types/product';

export interface FilterAvailability {
  readonly hasPrice: boolean;
  readonly hasPpc: boolean;
  readonly hasCarat: boolean;
  readonly hasRatti: boolean;
  readonly hasCert: boolean;
  readonly hasOrigin: boolean;
  readonly uniqueCerts: readonly string[];
  readonly uniqueOrigins: readonly string[];
}

export interface FilterCriteria {
  readonly category?: string;
  readonly search?: string;
  readonly priceMin?: number | null;
  readonly priceMax?: number | null;
  readonly ppcMin?: number | null;
  readonly ppcMax?: number | null;
  readonly caratMin?: number | null;
  readonly caratMax?: number | null;
  readonly rattiMin?: number | null;
  readonly rattiMax?: number | null;
  readonly certs?: readonly string[];
  readonly origins?: readonly string[];
  readonly sortBy?: 'featured' | 'price-asc' | 'price-desc' | 'name-asc' | 'weight-asc' | 'weight-desc';
}

/**
 * Extracts numeric carat weight from product or confirmed physical lot.
 */
export function getCaratWeight(p: Partial<Product> | null | undefined): number | null {
  if (!p) return null;
  if (typeof (p as any).caratWeight === 'number' && !isNaN((p as any).caratWeight)) {
    return (p as any).caratWeight;
  }
  if (typeof (p as any).carat_weight === 'number' && !isNaN((p as any).carat_weight)) {
    return (p as any).carat_weight;
  }
  if ((p as any).weight && typeof (p as any).weight === 'string') {
    const match = (p as any).weight.match(/([\d.]+)\s*(?:ct|carat)/i);
    if (match) {
      const val = parseFloat(match[1]);
      return isNaN(val) ? null : val;
    }
  }
  return null;
}

/**
 * Extracts numeric ratti weight from product or confirmed physical lot.
 */
export function getRattiWeight(p: Partial<Product> | null | undefined): number | null {
  if (!p) return null;
  if (typeof (p as any).rattiWeight === 'number' && !isNaN((p as any).rattiWeight)) {
    return (p as any).rattiWeight;
  }
  if (typeof (p as any).ratti_weight === 'number' && !isNaN((p as any).ratti_weight)) {
    return (p as any).ratti_weight;
  }
  if ((p as any).weight && typeof (p as any).weight === 'string') {
    const match = (p as any).weight.match(/([\d.]+)\s*(?:ratti)/i);
    if (match) {
      const val = parseFloat(match[1]);
      return isNaN(val) ? null : val;
    }
  }
  return null;
}

/**
 * Calculates price per carat if both effective price and carat weight are valid.
 */
export function getPricePerCarat(p: Partial<Product> | null | undefined): number | null {
  if (!p) return null;
  const wt = getCaratWeight(p);
  if (!wt || wt <= 0) return null;

  let price: number | null = null;
  if (typeof (p as any).finalPrice === 'number' && (p as any).finalPrice > 0) {
    price = (p as any).finalPrice;
  } else if (typeof (p as any).approvedSellingPrice === 'number' && (p as any).approvedSellingPrice > 0) {
    price = (p as any).approvedSellingPrice;
  } else if (typeof p.price_min === 'number' && p.price_min > 0) {
    price = p.price_min;
  }

  if (price == null || price <= 0) return null;
  return Math.round(price / wt);
}

/**
 * Extracts certificate laboratory or status.
 */
export function getCertification(p: Partial<Product> | null | undefined): string | null {
  if (!p) return null;
  if ((p as any).certLab && typeof (p as any).certLab === 'string') {
    return String((p as any).certLab).trim();
  }
  if ((p as any).cert_lab && typeof (p as any).cert_lab === 'string') {
    return String((p as any).cert_lab).trim();
  }
  if ((p as any).certification && typeof (p as any).certification === 'string') {
    return String((p as any).certification).trim();
  }
  if ((p as any).certStatus === 'CERTIFIED' || (p as any).certNumber) {
    return 'Certified';
  }
  return null;
}

/**
 * Extracts geographic provenance/origin.
 */
export function getOrigin(p: Partial<Product> | null | undefined): string | null {
  if (!p || !(p as any).origin) return null;
  return String((p as any).origin).trim();
}

/**
 * Resolves effective price for comparison and sorting.
 */
export function getProductEffectivePrice(p: Partial<Product> | null | undefined): number {
  if (!p) return 0;
  if (typeof (p as any).finalPrice === 'number') return (p as any).finalPrice;
  if (typeof (p as any).approvedSellingPrice === 'number') return (p as any).approvedSellingPrice;
  if (typeof p.price_min === 'number') return p.price_min;
  if (typeof p.price_max === 'number') return p.price_max;
  return 0;
}

/**
 * Audits a given dataset to verify which filter dimensions are populated.
 */
export function auditFilterAvailability(products: readonly Partial<Product>[]): FilterAvailability {
  const uniqueCerts = Array.from(new Set(products.map(p => getCertification(p)).filter((c): c is string => Boolean(c))));
  const uniqueOrigins = Array.from(new Set(products.map(p => getOrigin(p)).filter((o): o is string => Boolean(o))));

  return {
    hasPrice: products.some(p => getProductEffectivePrice(p) > 0),
    hasPpc: products.some(p => getPricePerCarat(p) != null),
    hasCarat: products.some(p => getCaratWeight(p) != null),
    hasRatti: products.some(p => getRattiWeight(p) != null),
    hasCert: uniqueCerts.length > 0,
    hasOrigin: uniqueOrigins.length > 0,
    uniqueCerts,
    uniqueOrigins
  };
}

/**
 * Pure filter evaluator that runs all criteria conjunctively.
 */
export function filterProducts<T extends Partial<Product>>(
  products: readonly T[],
  criteria: FilterCriteria
): T[] {
  let result = [...products];

  // 1. Category Filter
  if (criteria.category && criteria.category !== 'all') {
    const cat = criteria.category.toLowerCase();
    result = result.filter(p => (p.category || '').toLowerCase() === cat);
  }

  // 2. Search Text
  if (criteria.search && criteria.search.trim()) {
    const q = criteria.search.toLowerCase().trim();
    result = result.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      ((p as any).origin || '').toLowerCase().includes(q) ||
      ((p as any).certLab || '').toLowerCase().includes(q)
    );
  }

  // 3. Price Filter (using effective price or provisional min/max)
  if (criteria.priceMin != null || criteria.priceMax != null) {
    result = result.filter(p => {
      const min = typeof p.price_min === 'number' ? p.price_min : getProductEffectivePrice(p);
      const max = typeof p.price_max === 'number' ? p.price_max : min;
      if (criteria.priceMin != null && max < criteria.priceMin) return false;
      if (criteria.priceMax != null && min > criteria.priceMax) return false;
      return true;
    });
  }

  // 4. Price Per Carat Filter
  if (criteria.ppcMin != null || criteria.ppcMax != null) {
    result = result.filter(p => {
      const ppc = getPricePerCarat(p);
      if (ppc == null) return false;
      if (criteria.ppcMin != null && ppc < criteria.ppcMin) return false;
      if (criteria.ppcMax != null && ppc > criteria.ppcMax) return false;
      return true;
    });
  }

  // 5. Carat Weight Filter
  if (criteria.caratMin != null || criteria.caratMax != null) {
    result = result.filter(p => {
      const wt = getCaratWeight(p);
      if (wt == null) return false;
      if (criteria.caratMin != null && wt < criteria.caratMin) return false;
      if (criteria.caratMax != null && wt > criteria.caratMax) return false;
      return true;
    });
  }

  // 6. Ratti Weight Filter
  if (criteria.rattiMin != null || criteria.rattiMax != null) {
    result = result.filter(p => {
      const rt = getRattiWeight(p);
      if (rt == null) return false;
      if (criteria.rattiMin != null && rt < criteria.rattiMin) return false;
      if (criteria.rattiMax != null && rt > criteria.rattiMax) return false;
      return true;
    });
  }

  // 7. Certification Filter
  if (criteria.certs && criteria.certs.length > 0) {
    result = result.filter(p => {
      const cert = getCertification(p);
      return cert != null && criteria.certs!.includes(cert);
    });
  }

  // 8. Origin Filter
  if (criteria.origins && criteria.origins.length > 0) {
    result = result.filter(p => {
      const origin = getOrigin(p);
      return origin != null && criteria.origins!.includes(origin);
    });
  }

  // 9. Sorting
  if (criteria.sortBy) {
    switch (criteria.sortBy) {
      case 'price-asc':
        result.sort((a, b) => getProductEffectivePrice(a) - getProductEffectivePrice(b));
        break;
      case 'price-desc':
        result.sort((a, b) => getProductEffectivePrice(b) - getProductEffectivePrice(a));
        break;
      case 'name-asc':
        result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'weight-asc':
        result.sort((a, b) => (getCaratWeight(a) || 0) - (getCaratWeight(b) || 0));
        break;
      case 'weight-desc':
        result.sort((a, b) => (getCaratWeight(b) || 0) - (getCaratWeight(a) || 0));
        break;
      case 'featured':
      default:
        // maintain stable ordering
        break;
    }
  }

  return result;
}
