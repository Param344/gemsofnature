// tests/integration/runtime-server.test.ts
// Live HTTP server runtime verification of the dist build output

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = path.resolve(__dirname, '../../dist');

// Simple MIME map for local server
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

describe('Runtime HTTP Server Verification (dist)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Launch server on random available port
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
      let filePath = path.join(DIST_DIR, decodeURIComponent(parsedUrl.pathname));

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(filePath).pipe(res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function fetchUrl(targetPath: string): Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const fullUrl = new URL(targetPath, baseUrl).toString();
      http.get(fullUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, text: data, headers: res.headers });
        });
      }).on('error', reject);
    });
  }

  const allPages = [
    'about.html',
    'astrology.consultation.html',
    'checkout.html',
    'contact.html',
    'footer.html',
    'header.html',
    'index.html',
    'shop.html',
    'shop-ecom.html',
    'terms-and-conditions.html',
    'guides/chakras-stones.html',
    'guides/faq.html',
    'guides/gemstone-basics.html',
    'guides/how-to-choose.html',
    'guides/how-to-wear-care.html',
    'guides/privacy-policy.html',
    'guides/returns-refunds.html',
    'guides/rudraksha-guide.html',
    'guides/shipping-policy.html',
    'guides/terms-conditions.html'
  ];

  it('serves all 20 HTML entry points with HTTP 200 OK', async () => {
    for (const page of allPages) {
      const resp = await fetchUrl(`/${page}`);
      expect(resp.status, `Failed to load /${page}`).toBe(200);
      expect(resp.text.length, `Empty content for /${page}`).toBeGreaterThan(0);
    }
  });

  it('verifies layout.js dynamic partial fetch endpoints (/header.html and /footer.html)', async () => {
    const headerResp = await fetchUrl('/header.html');
    expect(headerResp.status).toBe(200);
    expect(headerResp.text).toContain('id="site-header"');
    expect(headerResp.text).toContain('/fonts/GreatVibes-Regular.ttf');

    const footerResp = await fetchUrl('/footer.html');
    expect(footerResp.status).toBe(200);
    expect(footerResp.text).toContain('id="site-footer"');
  });

  it('serves core scripts and stylesheets with HTTP 200', async () => {
    const runtimeAssets = [
      '/js/layout.js',
      '/js/products.js',
      '/js/product-meta.js',
      '/js/script.js',
      '/js/ai-chat.js',
      '/gn-config.js',
      '/gn-utils.js',
      '/js/gn-config.js',
      '/js/gn-utils.js',
      '/css/gon-responsive.css',
      '/css/gonresponsive.css',
      '/css/gon-design-system.css',
      '/css/gon-tailwind.css',
      '/css/index-mobile.css',
      '/css/shop-ecom-mobile.css',
      '/fonts/GreatVibes-Regular.ttf',
      '/images/logo.png',
      '/images/hero.jpg',
      '/gn-currency.js'
    ];

    for (const asset of runtimeAssets) {
      const resp = await fetchUrl(asset);
      expect(resp.status, `Asset ${asset} should return HTTP 200`).toBe(200);
    }
  });

  it('verifies exact 404 behavior for unresolved legacy V1 assets without dummy suppression', async () => {
    const unresolvedAssets = [
      '/css/styles.css',
      '/images/team-param.jpg',
      '/images/team-2.jpg',
      '/images/team-3.jpg',
      '/images/placeholder.jpg',
      '/images/grs.png'
    ];

    for (const asset of unresolvedAssets) {
      const resp = await fetchUrl(asset);
      expect(
        resp.status,
        `Expected ${asset} to return 404 (unresolved legacy reference, no fake placeholder)`
      ).toBe(404);
    }
  });

  it('verifies internal navigation links resolve to valid endpoints', async () => {
    const indexResp = await fetchUrl('/index.html');
    const links: string[] = [];
    for (const match of indexResp.text.matchAll(/href=[\"']([^\"'#]+)[\"']/g)) {
      const href = match[1];
      if (typeof href === 'string') {
        links.push(href);
      }
    }

    const localLinks = links.filter((l: string) => (
      !l.startsWith('http://') &&
      !l.startsWith('https://') &&
      !l.startsWith('mailto:') &&
      !l.startsWith('tel:') &&
      !l.endsWith('.css') &&
      !l.endsWith('.png') &&
      !l.endsWith('.jpg')
    ));

    for (const link of localLinks) {
      const resp = await fetchUrl(link);
      expect(resp.status, `Navigation link ${link} should resolve to 200`).toBe(200);
    }
  });
});
