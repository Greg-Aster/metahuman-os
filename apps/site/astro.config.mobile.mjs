/**
 * Astro Configuration for Mobile (Capacitor) Builds
 *
 * This config creates a static build that can be bundled into the APK.
 * Key differences from the server config:
 * - output: 'static' - Pre-renders all pages
 * - No Node adapter - Works without a server
 * - API routes excluded - Mobile uses remote API
 */

import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import svelte from '@astrojs/svelte';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Custom Vite plugin to externalize @metahuman/core for CLIENT builds
 * This prevents Node.js code from leaking into browser bundles
 */
function externalizeMetahumanCoreForClient() {
  return {
    name: 'externalize-metahuman-core-for-client',
    enforce: 'pre',
    resolveId(id, _importer, options) {
      // Only externalize for non-SSR (client) builds
      if (!options?.ssr && (id.startsWith('@metahuman/core') || id.startsWith('@metahuman/'))) {
        // ALLOW browser-safe schemas to be bundled for client
        if (id.includes('/nodes/schemas') || id.includes('/nodes/types')) {
          return null; // Let Vite bundle this normally
        }
        // Return external with empty module to prevent bundling
        return { id, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  integrations: [
    tailwind({ applyBaseStyles: true }),
    svelte({
      compilerOptions: {
        hydratable: true,
      },
    })
  ],

  // Static output for mobile - no server required
  output: 'static',

  // CRITICAL: Use relative paths for WebView file:// loading
  // Without this, assets reference absolute paths like /_astro/ which don't work
  // with file:///android_asset/www/index.html
  base: './',

  // Output directly to mobile/www folder (separation of concerns)
  // This way the mobile build never touches the server's dist folder
  outDir: '../mobile/www',

  // Build configuration
  build: {
    format: 'directory',
    // CRITICAL: Use 'assets' instead of '_astro' because Android AAPT
    // ignores files/folders starting with underscore when packaging APK assets
    assets: 'assets',
  },

  // Exclude API routes from static build - mobile uses HTTP server
  // The redirects force Astro to not generate these as static pages
  redirects: {
    // Redirect all API routes - this effectively tells Astro to skip them
  },

  vite: {
    plugins: [externalizeMetahumanCoreForClient()],
    logLevel: 'warn',
    clearScreen: false,
    resolve: {
      alias: {
        '@brain': path.join(repoRoot, 'brain'),
      }
    },
    optimizeDeps: {
      exclude: ['@metahuman/core'],
    },
    build: {
      rollupOptions: {
        // Exclude Node.js built-ins from the build (they're server-only)
        // NOTE: @capacitor modules MUST be bundled - they contain the JS bridge code
        external: [
          /^node:/,
          'async_hooks',
        ],
      },
    },
  },
});
