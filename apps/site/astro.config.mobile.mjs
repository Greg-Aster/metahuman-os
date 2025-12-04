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

  // Build configuration
  build: {
    // Output to dist/ directory
    format: 'directory',
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
        // Exclude API routes from the build (they're server-only)
        external: [
          /^node:/,
          'async_hooks',
        ],
      },
    },
  },
});
