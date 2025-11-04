import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import svelte from '@astrojs/svelte';
import voiceWebSocket from './src/integrations/voice-websocket.ts';

export default defineConfig({
  integrations: [
    tailwind({ applyBaseStyles: true }),
    svelte(),
    voiceWebSocket()
  ],
  server: { host: true },
  output: 'server',
});
