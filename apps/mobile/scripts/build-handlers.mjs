#!/usr/bin/env node
/**
 * Build mobile handlers bundle
 *
 * Compiles the mobile handlers from @metahuman/core into a single
 * JavaScript file that can run in nodejs-mobile.
 */

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.dirname(__dirname);
const ROOT = path.resolve(MOBILE_DIR, '../..');
const CORE_DIR = path.join(ROOT, 'packages/core');
const OUTPUT_DIR = path.join(MOBILE_DIR, 'nodejs-project/dist');
const SHIMS_DIR = path.join(MOBILE_DIR, 'nodejs-project/shims');

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('[build-handlers] Building mobile handlers bundle...');
console.log('[build-handlers] Entry:', path.join(CORE_DIR, 'src/mobile-handlers/index.ts'));
console.log('[build-handlers] Output:', path.join(OUTPUT_DIR, 'handlers.js'));

/**
 * Plugin to handle import.meta.url in CommonJS bundle
 *
 * Node.js v12 (used by nodejs-mobile) doesn't support import.meta in CJS.
 * This plugin replaces import.meta.url with __filename equivalent.
 */
const importMetaUrlPlugin = {
  name: 'import-meta-url',
  setup(build) {
    // Replace import.meta.url with a CommonJS-compatible polyfill
    build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
      const contents = await fs.promises.readFile(args.path, 'utf8');

      // Only process files that use import.meta.url
      if (!contents.includes('import.meta.url')) {
        return null; // Let esbuild handle normally
      }

      // Replace import.meta.url with require('url').pathToFileURL(__filename).href
      // This works in CommonJS where __filename is available
      const transformed = contents.replace(
        /import\.meta\.url/g,
        `(typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : '')`
      );

      // Determine loader based on extension
      const ext = path.extname(args.path);
      let loader = 'ts';
      if (ext === '.js' || ext === '.mjs') loader = 'js';
      else if (ext === '.tsx') loader = 'tsx';
      else if (ext === '.jsx') loader = 'jsx';

      return { contents: transformed, loader };
    });
  }
};

try {
  const result = await esbuild.build({
    entryPoints: [path.join(CORE_DIR, 'src/mobile-handlers/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node12', // nodejs-mobile uses Node.js v12
    format: 'cjs', // CommonJS for require() compatibility
    outfile: path.join(OUTPUT_DIR, 'handlers.js'),

    // Plugin to handle import.meta.url
    plugins: [importMetaUrlPlugin],

    // External packages that should NOT be bundled
    external: [
      'cordova-bridge', // Provided by nodejs-mobile runtime
    ],

    // Resolve paths
    alias: {
      '@metahuman/core': CORE_DIR + '/src',
      // Node.js v12 has fs.promises but not the 'fs/promises' module
      'fs/promises': path.join(SHIMS_DIR, 'fs-promises.js'),
    },

    // Source maps for debugging
    sourcemap: true,

    // Minify for smaller bundle size
    minify: false, // Keep readable for debugging

    // Tree-shaking
    treeShaking: true,

    // Show bundle size
    metafile: true,

    // Log level
    logLevel: 'info',
  });

  // Analyze bundle
  const text = await esbuild.analyzeMetafile(result.metafile);
  console.log('\n[build-handlers] Bundle analysis:');
  console.log(text);

  // Show output file size
  const stats = fs.statSync(path.join(OUTPUT_DIR, 'handlers.js'));
  console.log(`[build-handlers] Bundle size: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log('[build-handlers] Build complete!');

} catch (error) {
  console.error('[build-handlers] Build failed:', error);
  process.exit(1);
}
