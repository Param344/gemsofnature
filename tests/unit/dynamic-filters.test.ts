import { describe, it, expect } from 'vitest';
import { products } from '../../src/core/products';
import type { Product } from '../../src/types/product';
import {
  getCaratWeight,
  getRattiWeight,
  getPricePerCarat,
  getCertification,
  getOrigin,
  getProductEffectivePrice,
  auditFilterAvailability,
  filterProducts
} from '../../src/catalogue/dynamic-filters';

describe('Stage 4B: Dynamic Catalogue Filters Unit Tests', () => {
  describe('1. Attribute Extractors', () => {
    it('extracts carat weight from physical lot attributes and text patterns', () => {
      expect(getCaratWeight(null)).toBeNull();
      expect(getCaratWeight({})).toBeNull();
      expect(getCaratWeight({ caratWeight: 4.25 })).toBe(4.25);
      expect(getCaratWeight({ weight: '5.10 ct' } as any)).toBe(5.1);
      expect(getCaratWeight({ weight: 'approx 3.4 Carats' } as any)).toBe(3.4);
    });

    it('extracts ratti weight accurately', () => {
      expect(getRattiWeight(null)).toBeNull();
      expect(getRattiWeight({})).toBeNull();
      expect(getRattiWeight({ rattiWeight: 4.67 })).toBe(4.67);
      expect(getRattiWeight({ weight: '5.25 Ratti' } as any)).toBe(5.25);
    });

    it('calculates price per carat (PPC) correctly', () => {
      expect(getPricePerCarat(null)).toBeNull();
      expect(getPricePerCarat({ price_min: 50000 })).toBeNull(); // No carat weight
      expect(getPricePerCarat({ caratWeight: 5.0 })).toBeNull(); // No price
      expect(getPricePerCarat({ finalPrice: 100000, caratWeight: 5.0 })).toBe(20000);
      expect(getPricePerCarat({ approvedSellingPrice: 75000, caratWeight: 3.0 } as any)).toBe(25000);
    });

    it('extracts certification laboratories and origins', () => {
      expect(getCertification(null)).toBeNull();
      expect(getCertification({ certLab: 'GIA' })).toBe('GIA');
      expect(getCertification({ certNumber: 'IGI-123' } as any)).toBe('Certified');

      expect(getOrigin(null)).toBeNull();
      expect(getOrigin({ origin: 'Burma' })).toBe('Burma');
      expect(getOrigin({ origin: '  Ceylon ' })).toBe('Ceylon');
    });

    it('computes effective product price with appropriate fallbacks', () => {
      expect(getProductEffectivePrice(null)).toBe(0);
      expect(getProductEffectivePrice({ finalPrice: 15000 })).toBe(15000);
      expect(getProductEffectivePrice({ approvedSellingPrice: 25000 } as any)).toBe(25000);
      expect(getProductEffectivePrice({ price_min: 30000, price_max: 50000 })).toBe(30000);
    });
  });

  describe('2. Filter Availability Audit on Baseline Catalogue', () => {
    it('audits the baseline 104 products and confirms provisional pricing without unverified lot filters', () => {
      const avail = auditFilterAvailability(products);

      // Baseline products all have provisional price ranges
      expect(avail.hasPrice).toBe(true);

      // Baseline products do not have physical lot gemological records;
      // filters must report false to prevent misleading empty filter results!
      expect(avail.hasPpc).toBe(false);
      expect(avail.hasCarat).toBe(false);
      expect(avail.hasRatti).toBe(false);
      expect(avail.hasCert).toBe(false);
      expect(avail.hasOrigin).toBe(false);
      expect(avail.uniqueCerts.length).toBe(0);
      expect(avail.uniqueOrigins.length).toBe(0);
    });

    it('dynamically activates filters when physical lots with verified attributes exist', () => {
      const testLots: Product[] = [
        ...products.slice(0, 5),
        {
          id: 'p2',
          name: 'Ruby Lot #1',
          category: 'Precious',
          image: 'images/products/ruby.jpg',
          price_min: 40000,
          price_max: 600000,
          finalPrice: 80000,
          caratWeight: 4.0,
          rattiWeight: 4.4,
          certLab: 'GIA',
          certNumber: 'GIA-001',
          origin: 'Burma',
          description: 'Ruby test lot'
        },
        {
          id: 'p1',
          name: 'Yellow Sapphire Lot #1',
          category: 'Precious',
          image: 'images/products/yellow-sapphire.jpg',
          price_min: 40000,
          price_max: 200000,
          finalPrice: 120000,
          caratWeight: 6.0,
          rattiWeight: 6.6,
          certLab: 'IGI',
          certNumber: 'IGI-002',
          origin: 'Ceylon',
          description: 'Sapphire test lot'
        }
      ];

      const avail = auditFilterAvailability(testLots);
      expect(avail.hasPrice).toBe(true);
      expect(avail.hasPpc).toBe(true);
      expect(avail.hasCarat).toBe(true);
      expect(avail.hasRatti).toBe(true);
      expect(avail.hasCert).toBe(true);
      expect(avail.hasOrigin).toBe(true);
      expect(avail.uniqueCerts).toEqual(expect.arrayContaining(['GIA', 'IGI']));
      expect(avail.uniqueOrigins).toEqual(expect.arrayContaining(['Burma', 'Ceylon']));
    });
  });

  describe('3. Dynamic Filtering Evaluation (filterProducts)', () => {
    const sampleItems: Product[] = [
      {
        id: 'p1',
        name: 'Yellow Sapphire Ceylon',
        category: 'Precious',
        image: 'images/p1.jpg',
        price_min: 40000,
        price_max: 200000,
        finalPrice: 120000,
        caratWeight: 6.0,
        rattiWeight: 6.6,
        certLab: 'IGI',
        origin: 'Ceylon',
        description: 'Investment-grade Pukhraj'
      },
      {
        id: 'p2',
        name: 'Burma Ruby Unheated',
        category: 'Precious',
        image: 'images/p2.jpg',
        price_min: 40000,
        price_max: 600000,
        finalPrice: 80000,
        caratWeight: 4.0,
        rattiWeight: 4.4,
        certLab: 'GIA',
        origin: 'Burma',
        description: 'Vivid red ruby'
      },
      {
        id: 'p5',
        name: 'Zambian Emerald',
        category: 'Precious',
        image: 'images/p5.jpg',
        price_min: 30000,
        price_max: 300000,
        finalPrice: 45000,
        caratWeight: 3.0,
        rattiWeight: 3.3,
        certLab: 'GJEPC',
        origin: 'Zambia',
        description: 'Natural green emerald'
      },
      {
        id: 'p10',
        name: 'Provisional Opal Stone',
        category: 'Opal',
        image: 'images/p10.jpg',
        price_min: 5000,
        price_max: 15000,
        description: 'Provisional catalogue item without physical lot'
      }
    ];

    it('filters by category accurately', () => {
      const resPrecious = filterProducts(sampleItems, { category: 'Precious' });
      expect(resPrecious.length).toBe(3);
      expect(resPrecious.every(p => p.category === 'Precious')).toBe(true);

      const resOpal = filterProducts(sampleItems, { category: 'Opal' });
      expect(resOpal.length).toBe(1);
      expect(resOpal[0]?.id).toBe('p10');
    });

    it('filters by search keyword across name, description, origin, and cert lab', () => {
      const resCeylon = filterProducts(sampleItems, { search: 'ceylon' });
      expect(resCeylon.length).toBe(1);
      expect(resCeylon[0]?.id).toBe('p1');

      const resGia = filterProducts(sampleItems, { search: 'GIA' });
      expect(resGia.length).toBe(1);
      expect(resGia[0]?.id).toBe('p2');
    });

    it('filters by price per carat (PPC)', () => {
      // PPCs:
      // p1: 120000 / 6.0 = 20000
      // p2: 80000 / 4.0 = 20000
      // p5: 45000 / 3.0 = 15000
      // p10: null
      const res = filterProducts(sampleItems, { ppcMin: 18000, ppcMax: 22000 });
      expect(res.length).toBe(2);
      expect(res.map(p => p.id)).toEqual(['p1', 'p2']);
    });

    it('filters by carat weight range', () => {
      const res = filterProducts(sampleItems, { caratMin: 3.5, caratMax: 5.0 });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe('p2');
    });

    it('filters by ratti weight range', () => {
      const res = filterProducts(sampleItems, { rattiMin: 6.0 });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe('p1');
    });

    it('filters by certification laboratory', () => {
      const res = filterProducts(sampleItems, { certs: ['GIA', 'GJEPC'] });
      expect(res.length).toBe(2);
      expect(res.map(p => p.id)).toEqual(['p2', 'p5']);
    });

    it('filters by origin', () => {
      const res = filterProducts(sampleItems, { origins: ['Burma'] });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe('p2');
    });

    it('combines multiple filter criteria conjunctively', () => {
      const res = filterProducts(sampleItems, {
        category: 'Precious',
        caratMin: 3.5,
        origins: ['Burma'],
        certs: ['GIA']
      });
      expect(res.length).toBe(1);
      expect(res[0]?.id).toBe('p2');
    });

    it('sorts results correctly by price and weight', () => {
      const sortedByPriceAsc = filterProducts(sampleItems, { sortBy: 'price-asc' });
      expect(sortedByPriceAsc[0]?.id).toBe('p10'); // price_min 5000
      expect(sortedByPriceAsc[sortedByPriceAsc.length - 1]?.id).toBe('p1'); // 120000

      const sortedByWeightDesc = filterProducts(sampleItems, { sortBy: 'weight-desc' });
      expect(sortedByWeightDesc[0]?.id).toBe('p1'); // 6.0 ct
      expect(sortedByWeightDesc[1]?.id).toBe('p2'); // 4.0 ct
      expect(sortedByWeightDesc[2]?.id).toBe('p5'); // 3.0 ct
    });
  });
});
