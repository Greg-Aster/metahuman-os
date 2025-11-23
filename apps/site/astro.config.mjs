import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import svelte from '@astrojs/svelte';

export default defineConfig({
  integrations: [
    tailwind({ applyBaseStyles: true }),
    svelte()
  ],
  server: {
    host: true,
  },
  output: 'server',
  vite: {
    logLevel: 'warn', // Show warnings and errors, allow console.log from API handlers
    clearScreen: false, // Don't clear terminal on restart
    server: {
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
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/.astro/**',
          '**/logs/**',      // Audit logs change constantly
          '**/memory/**',    // Episodic memory files change constantly
          '**/persona/**',   // Persona updates
          '**/out/**',       // Generated outputs
          '**/*.log'
        ]
      }
    }
  }
});
