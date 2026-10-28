/// <reference types="vitest" />
import { defineConfig, Plugin } from 'vite';
import { resolve, join, relative } from 'path';
import * as fs from 'fs';

/**
 * Dynamically discovers all HTML entry points in the project root and subdirectories
 * (excluding node_modules, dist, .git, and tests).
 */
function discoverHtmlEntries(rootDir: string): Record<string, string> {
  const entries: Record<string, string> = {};

  function scan(dir: string) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (
        item.name === 'node_modules' ||
        item.name === 'dist' ||
        item.name === '.git' ||
        item.name === 'tests' ||
        item.name === 'src'
      ) {
        continue;
      }
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        scan(fullPath);
      } else if (item.isFile() && item.name.endsWith('.html')) {
        const rel = relative(rootDir, fullPath);
        const key = rel.replace(/\.html$/, '').replace(/[\\/]/g, '_');
        entries[key] = fullPath;
      }
    }
  }

  scan(rootDir);
  return entries;
}

/**
 * Vite plugin to preserve static asset directories (images, css, js, files),
 * root deployment metadata (CNAME, robots.txt, etc.), and resolve legacy
 * path mismatches in dist without mutating source files.
 */
function preserveStaticAssetsPlugin(): Plugin {
  return {
    name: 'preserve-static-assets',
    apply: 'build',
    closeBundle() {
      const rootDir = process.cwd();
      const outDir = resolve(rootDir, 'dist');
      if (!fs.existsSync(outDir)) return;

      // 1. Copy static directories
      const dirsToCopy = ['images', 'css', 'js', 'files'];
      for (const dir of dirsToCopy) {
        const srcDir = resolve(rootDir, dir);
        const destDir = resolve(outDir, dir);
        if (fs.existsSync(srcDir)) {
          fs.cpSync(srcDir, destDir, { recursive: true });
        }
      }

      // 2. Copy root deployment metadata and configuration scripts
      const filesToCopy = [
        'CNAME',
        'robots.txt',
        'sitemap.xml',
        'manifest.json',
        'gn-config.js',
        'gn-utils.js'
      ];
      for (const file of filesToCopy) {
        const srcFile = resolve(rootDir, file);
        const destFile = resolve(outDir, file);
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, destFile);
        }
      }

      // 3. Resolve legacy asset path mismatches in dist/ (read-only for src):
      // a. Copy gn-config.js and gn-utils.js to dist/js/ for pages referencing js/gn-config.js
      const distJsDir = resolve(outDir, 'js');
      if (fs.existsSync(distJsDir)) {
        const gnConfigSrc = resolve(rootDir, 'gn-config.js');
        const gnUtilsSrc = resolve(rootDir, 'gn-utils.js');
        if (fs.existsSync(gnConfigSrc)) {
          fs.copyFileSync(gnConfigSrc, resolve(distJsDir, 'gn-config.js'));
        }
        if (fs.existsSync(gnUtilsSrc)) {
          fs.copyFileSync(gnUtilsSrc, resolve(distJsDir, 'gn-utils.js'));
        }
      }

      // b. Copy GreatVibes font to dist/fonts/ for header.html referencing /fonts/GreatVibes-Regular.ttf
      const fontSrc = resolve(rootDir, 'css/fonts/GreatVibes-Regular.ttf');
      const fontDestDir = resolve(outDir, 'fonts');
      if (fs.existsSync(fontSrc)) {
        if (!fs.existsSync(fontDestDir)) fs.mkdirSync(fontDestDir, { recursive: true });
        fs.copyFileSync(fontSrc, resolve(fontDestDir, 'GreatVibes-Regular.ttf'));
      }

      // c. Copy gonresponsive.css to dist/css/gon-responsive.css (hyphenated reference compatibility)
      const gonCssSrc = resolve(rootDir, 'css/gonresponsive.css');
      const gonCssDest = resolve(outDir, 'css/gon-responsive.css');
      if (fs.existsSync(gonCssSrc)) {
        fs.copyFileSync(gonCssSrc, gonCssDest);
      }


      // e. Copy logo-v2.png to dist/images/logo.png for favicon references
      const logoSrc = resolve(rootDir, 'images/logo-v2.png');
      const logoDest = resolve(outDir, 'images/logo.png');
      if (fs.existsSync(logoSrc)) {
        fs.copyFileSync(logoSrc, logoDest);
      }

      // f. Copy hero-bg.jpg to dist/images/hero.jpg for astrology.consultation.html reference
      const heroSrc = resolve(rootDir, 'images/hero-bg.jpg');
      const heroDest = resolve(outDir, 'images/hero.jpg');
      if (fs.existsSync(heroSrc)) {
        fs.copyFileSync(heroSrc, heroDest);
      }
    }
  };
}

const htmlEntries = discoverHtmlEntries(__dirname);

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        ...htmlEntries,
        'gemsofnature-core': resolve(__dirname, 'src/index.ts'),
        'gn-currency': resolve(__dirname, 'src/client/currency-adapter.ts'),
        'gn-cart-badge': resolve(__dirname, 'src/client/cart-badge-adapter.ts')
      },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'gemsofnature-core') {
            return 'gemsofnature-core.js';
          }
          if (chunkInfo.name === 'gn-currency') {
            return 'gn-currency.js';
          }
          if (chunkInfo.name === 'gn-cart-badge') {
            return 'gn-cart-badge.js';
          }
          return 'assets/[name]-[hash].js';
        }
      }
    }
  },
  plugins: [preserveStaticAssetsPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});

