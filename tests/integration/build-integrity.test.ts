// tests/integration/build-integrity.test.ts
// Build integration and migration readiness verification for Gems of Nature V2

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT_DIR = path.resolve(__dirname, '../../');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

describe('Vite Multi-Page Build Integrity Checks', () => {
  let sourceHtmlFiles: string[] = [];

  beforeAll(() => {
    // Dynamically discover all HTML files from source repository
    function findHtml(dir: string): string[] {
      let results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '.git' ||
          entry.name === 'tests' ||
          entry.name === 'src'
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(findHtml(full));
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
          results.push(path.relative(ROOT_DIR, full));
        }
      }
      return results;
    }

    sourceHtmlFiles = findHtml(ROOT_DIR).sort();
  });

  it('verifies dist directory exists from build', () => {
    expect(fs.existsSync(DIST_DIR)).toBe(true);
  });

  it('discovers and verifies every source HTML file appears in dist build output', () => {
    expect(sourceHtmlFiles.length).toBeGreaterThan(0);
    // Verified 21 files dynamically discovered (including owner.html)
    expect(sourceHtmlFiles.length).toBe(21);

    for (const relPath of sourceHtmlFiles) {
      const distPath = path.join(DIST_DIR, relPath);
      expect(
        fs.existsSync(distPath),
        `Expected ${relPath} to exist in dist at ${distPath}`
      ).toBe(true);

      const stats = fs.statSync(distPath);
      expect(stats.size).toBeGreaterThan(0);
    }
  });

  it('preserves all nested guide pages under dist/guides/', () => {
    const guideFiles = sourceHtmlFiles.filter((f) => f.startsWith('guides/'));
    expect(guideFiles.length).toBe(10);

    for (const file of guideFiles) {
      const distFile = path.join(DIST_DIR, file);
      expect(fs.existsSync(distFile)).toBe(true);
      const content = fs.readFileSync(distFile, 'utf8');
      expect(content.length).toBeGreaterThan(500);
    }
  });

  it('preserves header.html and footer.html layout fragments', () => {
    const headerPath = path.join(DIST_DIR, 'header.html');
    const footerPath = path.join(DIST_DIR, 'footer.html');

    expect(fs.existsSync(headerPath)).toBe(true);
    expect(fs.existsSync(footerPath)).toBe(true);

    const headerContent = fs.readFileSync(headerPath, 'utf8');
    const footerContent = fs.readFileSync(footerPath, 'utf8');

    // Ensure fragments were not wrapped into full html docs
    expect(headerContent.includes('id="site-header"')).toBe(true);
    expect(footerContent.includes('id="site-footer"')).toBe(true);
  });

  it('generates the TypeScript gemsofnature-core.js bundle in dist', () => {
    const coreBundle = path.join(DIST_DIR, 'gemsofnature-core.js');
    expect(fs.existsSync(coreBundle)).toBe(true);

    const stats = fs.statSync(coreBundle);
    // TypeScript domain code and catalogue should produce a bundle > 50KB
    expect(stats.size).toBeGreaterThan(50000);

    const content = fs.readFileSync(coreBundle, 'utf8');
    // Ensure core classes and exports are present
    expect(content.includes('CartValidator')).toBe(true);
    expect(content.includes('PriceCalculator')).toBe(true);
    expect(content.includes('CartManager')).toBe(true);
    expect(content.includes('GN_CONFIG')).toBe(true);
  });

  it('generates the TypeScript gn-currency.js client adapter bundle in dist', () => {
    const currencyBundle = path.join(DIST_DIR, 'gn-currency.js');
    expect(fs.existsSync(currencyBundle)).toBe(true);

    const stats = fs.statSync(currencyBundle);
    expect(stats.size).toBeGreaterThan(100);

    const content = fs.readFileSync(currencyBundle, 'utf8');
    expect(
      content.includes('initCurrencyAdapter') ||
      content.includes('CurrencyFormatter') ||
      content.includes('currency-adapter')
    ).toBe(true);
  });


  it('preserves static asset directories: images, css, js, files', () => {
    const directories = ['images', 'css', 'js', 'files'];
    for (const dir of directories) {
      const fullPath = path.join(DIST_DIR, dir);
      expect(fs.existsSync(fullPath), `Directory ${dir} should exist in dist`).toBe(true);
      const items = fs.readdirSync(fullPath);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('preserves legacy JavaScript scripts intact in dist/js and dist root', () => {
    const expectedScripts = [
      'dist/js/layout.js',
      'dist/js/products.js',
      'dist/js/product-meta.js',
      'dist/js/script.js',
      'dist/js/ai-chat.js',
      'dist/gn-config.js',
      'dist/gn-utils.js',
      // Compatibility path for pages referencing js/gn-config.js
      'dist/js/gn-config.js',
      'dist/js/gn-utils.js'
    ];

    for (const script of expectedScripts) {
      const fullPath = path.join(ROOT_DIR, script);
      expect(fs.existsSync(fullPath), `Script ${script} should exist in dist`).toBe(true);
    }
  });

  it('preserves deployment metadata files: CNAME, robots.txt, sitemap.xml, manifest.json', () => {
    const files = ['CNAME', 'robots.txt', 'sitemap.xml', 'manifest.json'];
    for (const file of files) {
      const distPath = path.join(DIST_DIR, file);
      expect(fs.existsSync(distPath), `${file} should exist in dist`).toBe(true);
      const content = fs.readFileSync(distPath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('resolves legacy asset path mismatches in dist with real assets', () => {
    // 1. Hyphenated responsive css compatibility (from real css/gonresponsive.css)
    expect(fs.existsSync(path.join(DIST_DIR, 'css/gon-responsive.css'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, 'css/gonresponsive.css'))).toBe(true);

    // 2. GreatVibes font at /fonts/ (from real css/fonts/GreatVibes-Regular.ttf)
    expect(fs.existsSync(path.join(DIST_DIR, 'fonts/GreatVibes-Regular.ttf'))).toBe(true);

    // 3. Logo favicon fallback (from real images/logo-v2.png)
    expect(fs.existsSync(path.join(DIST_DIR, 'images/logo.png'))).toBe(true);

    // 4. Hero image fallback (from real images/hero-bg.jpg)
    expect(fs.existsSync(path.join(DIST_DIR, 'images/hero.jpg'))).toBe(true);
  });

  it('verifies customer-facing branding and email integrity across pages in dist', () => {
    const indexHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
    const contactHtml = fs.readFileSync(path.join(DIST_DIR, 'contact.html'), 'utf8');
    const privacyHtml = fs.readFileSync(path.join(DIST_DIR, 'guides/privacy-policy.html'), 'utf8');
    const termsHtml = fs.readFileSync(path.join(DIST_DIR, 'guides/terms-conditions.html'), 'utf8');
    const checkoutHtml = fs.readFileSync(path.join(DIST_DIR, 'checkout.html'), 'utf8');

    // Brand name
    expect(indexHtml.includes('Gems of Nature')).toBe(true);

    // Exact email addresses preserved from V1 baseline without modification
    expect(contactHtml.includes('Paramjeet.singh@outlook.in')).toBe(true);
    expect(privacyHtml.includes('info@gemsofnature.shop')).toBe(true);
    expect(termsHtml.includes('support@gemsofnature.shop')).toBe(true);
    expect(checkoutHtml.includes('paramjeet19@gmail.com')).toBe(true);
  });
});

