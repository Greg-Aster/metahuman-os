import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import svelte from '@astrojs/svelte';
import node from '@astrojs/node';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// HTTPS certificates for mobile microphone access (requires secure context)
const certsDir = path.join(repoRoot, 'certs');
const httpsConfig = fs.existsSync(path.join(certsDir, 'cert.pem')) ? {
  key: fs.readFileSync(path.join(certsDir, 'key.pem')),
  cert: fs.readFileSync(path.join(certsDir, 'cert.pem')),
} : undefined;

/**
 * Custom Vite plugin to externalize @metahuman/core only for CLIENT builds
 * This prevents Node.js code from leaking into browser bundles
 * while allowing normal bundling for SSR builds
 */
function externalizeMetahumanCoreForClient() {
  return {
    name: 'externalize-metahuman-core-for-client',
    enforce: 'pre',
    resolveId(id, _importer, options) {
      // Only externalize for non-SSR (client) builds
      if (!options?.ssr && (id.startsWith('@metahuman/core') || id.startsWith('@metahuman/'))) {
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
      // Ensure Svelte components are compiled for both SSR and client
      compilerOptions: {
        hydratable: true,
      },
    })
  ],
  adapter: node({
    mode: 'standalone'
  }),
  server: {
    host: true,
  },
  output: 'server',
  vite: {
    plugins: [externalizeMetahumanCoreForClient()],
    logLevel: 'warn', // Show warnings and errors, allow console.log from API handlers
    clearScreen: false, // Don't clear terminal on restart
    resolve: {
      alias: {
        // Allow imports from brain/ directory outside apps/site
        '@brain': path.join(repoRoot, 'brain'),
      }
    },
    optimizeDeps: {
      exclude: ['@metahuman/core'], // Don't pre-bundle workspace packages
    },
    ssr: {
      // Bundle workspace packages (they have TypeScript that needs transpiling)
      noExternal: [
        '@metahuman/core',
        /^@metahuman\//,
      ],
      // Node.js built-ins should be external in SSR builds
      external: [
        /^node:/,
        'async_hooks',
      ],
      // Target Node.js for SSR
      target: 'node',
    },
    build: {
      // DO NOT use ssr: true - it forces ALL Svelte components into SSR format
      // which breaks client-side hydration ("Component is not a constructor" error)
      // Instead, use externalizeMetahumanCoreForClient plugin above to prevent
      // Node.js code from leaking into client bundles
      rollupOptions: {},
    },
    server: {
      https: httpsConfig,
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'mh.dndiy.org',
        '.dndiy.org' // Allow all subdomains
      ],
      hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      watch: {
        // Exclude agent-modified dirs to prevent 14,000+ reads/sec (80-90% CPU)
        // See: strace shows 28,303 read() calls in 2 seconds
        usePolling: false, // Disable polling to reduce CPU usage
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/.astro/**',
          '**/logs/**',      // Audit logs change constantly
          '**/memory/**',    // Episodic memory files change constantly
          '**/persona/**',   // Persona updates
          '**/out/**',       // Generated outputs
          '**/external/**',  // External tools (kokoro, whisper, etc.)
          '**/vendor/**',    // Vendored dependencies
          '**/brain/**',     // Agent code (only edited manually)
          '**/profiles/**',  // User profiles
          '**/scripts/**',   // Build scripts
          '**/tests/**',     // Test files
          '**/etc/**',       // Config files (rarely changed)
          '**/*.log',
          '**/*.gguf',       // Large model files
          '**/*.bin',        // Binary files
          '**/*.wav',        // Audio files
          '**/*.mp3'
        ]
      }
    }
  }
});
