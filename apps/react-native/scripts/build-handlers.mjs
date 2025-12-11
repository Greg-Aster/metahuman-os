#!/usr/bin/env node
/**
 * Build mobile bundles for React Native
 *
 * Compiles the unified API layer from @metahuman/core into JavaScript
 * that can run in nodejs-mobile-react-native (Node.js 18).
 *
 * SAME CODE AS WEB SERVER - no polyfills needed!
 *
 * Outputs:
 * - handlers.js: Mobile-specific handlers (agents, scheduler)
 * - http-adapter.js: Unified HTTP adapter (SAME as web uses)
 */

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RN_DIR = path.dirname(__dirname);
// apps/react-native/ -> apps/ -> metahuman/ (two levels up, not three)
const ROOT = path.resolve(RN_DIR, '../..');
const CORE_DIR = path.join(ROOT, 'packages/core');
const OUTPUT_DIR = path.join(RN_DIR, 'nodejs-assets/nodejs-project/dist');

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('[build-handlers] Building mobile handlers bundle for React Native...');
console.log('[build-handlers] Target: Node.js 18 (native fetch, AbortController, fs/promises)');
console.log('[build-handlers] Entry:', path.join(CORE_DIR, 'src/mobile-handlers/index.ts'));
console.log('[build-handlers] Output:', path.join(OUTPUT_DIR, 'handlers.js'));

/**
 * Plugin to handle import.meta.url in CommonJS bundle
 *
 * Even in Node.js 18, we bundle as CJS for compatibility with nodejs-mobile.
 * This plugin replaces import.meta.url with __filename equivalent.
 */
const importMetaUrlPlugin = {
  name: 'import-meta-url',
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
      const contents = await fs.promises.readFile(args.path, 'utf8');

      if (!contents.includes('import.meta.url')) {
        return null;
      }

      const transformed = contents.replace(
        /import\.meta\.url/g,
        `(typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : 'file://' + (process.env.METAHUMAN_ROOT || '/data/local/tmp') + '/main.js')`
      );

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
    target: 'node18', // nodejs-mobile-react-native uses Node.js 18!
    format: 'cjs',
    outfile: path.join(OUTPUT_DIR, 'handlers.js'),
    plugins: [importMetaUrlPlugin],

    // External packages - rn-bridge instead of cordova-bridge
    external: [
      'rn-bridge', // Provided by nodejs-mobile-react-native runtime
    ],

    alias: {
      '@metahuman/core': CORE_DIR + '/src',
      // No fs/promises shim needed - Node.js 18 has native support!
    },

    sourcemap: true,
    minify: false,
    treeShaking: true,
    metafile: true,
    logLevel: 'info',
  });

  const text = await esbuild.analyzeMetafile(result.metafile);
  console.log('\n[build-handlers] Bundle analysis:');
  console.log(text);

  const stats = fs.statSync(path.join(OUTPUT_DIR, 'handlers.js'));
  console.log(`[build-handlers] handlers.js: ${(stats.size / 1024).toFixed(1)} KB`);

} catch (error) {
  console.error('[build-handlers] handlers.js build failed:', error);
  process.exit(1);
}

// =============================================================================
// Build 2: Unified HTTP Adapter (SAME CODE AS WEB)
// =============================================================================

console.log('\n[build-handlers] Building unified HTTP adapter...');
console.log('[build-handlers] Entry:', path.join(CORE_DIR, 'src/api/adapters/http.ts'));
console.log('[build-handlers] Output:', path.join(OUTPUT_DIR, 'http-adapter.js'));

try {
  const result2 = await esbuild.build({
    entryPoints: [path.join(CORE_DIR, 'src/api/adapters/http.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18', // Node.js 18!
    format: 'cjs',
    outfile: path.join(OUTPUT_DIR, 'http-adapter.js'),
    plugins: [importMetaUrlPlugin],
    external: ['rn-bridge'],
    alias: {
      '@metahuman/core': CORE_DIR + '/src',
    },
    sourcemap: true,
    minify: false,
    treeShaking: true,
    metafile: true,
    logLevel: 'info',
  });

  const text2 = await esbuild.analyzeMetafile(result2.metafile);
  console.log('\n[build-handlers] HTTP adapter analysis:');
  console.log(text2);

  const stats2 = fs.statSync(path.join(OUTPUT_DIR, 'http-adapter.js'));
  console.log(`[build-handlers] http-adapter.js: ${(stats2.size / 1024).toFixed(1)} KB`);

} catch (error) {
  console.error('[build-handlers] http-adapter.js build failed:', error);
  process.exit(1);
}

console.log('\n[build-handlers] ✅ All builds complete (Node.js 18 target)!');
console.log('[build-handlers] No polyfills needed - native fetch, AbortController, fs/promises');
