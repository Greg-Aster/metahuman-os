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
    logLevel: 'silent', // Completely silent - no request logs at all
    clearScreen: false, // Don't clear terminal on restart
    server: {
      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'mh.dndiy.org',
        '.dndiy.org' // Allow all subdomains
      ],
      hmr: process.env.DISABLE_HMR === 'true' ? false : true
    }
  }
});
