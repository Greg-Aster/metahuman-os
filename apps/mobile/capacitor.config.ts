import type { CapacitorConfig } from '@capacitor/cli';

// Get local network IP for device to connect to dev server
// Run: pnpm dev:ip to see your current IP
const DEV_SERVER_IP = process.env.DEV_SERVER_IP || '192.168.0.44';
const DEV_MODE = process.env.DEV_MODE === 'true';

const config: CapacitorConfig = {
  appId: 'com.metahuman.os',
  appName: 'MetaHuman',

  // Production: use site's built output
  webDir: '../site/dist',

  // Development: connect to Astro dev server for live reload
  server: DEV_MODE ? {
    url: `http://${DEV_SERVER_IP}:4321`,
    cleartext: true, // Allow HTTP during development
  } : undefined,

  android: {
    // Allow HTTP for local dev server
    allowMixedContent: true,
    // Dark splash screen
    backgroundColor: '#0f0f0f',
    // Build with modern webview
    minWebViewVersion: 91,
  },

  plugins: {
    // Handle keyboard for chat input
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    // Vibration feedback (already used in useMicrophone.ts)
    Haptics: {
      // Uses native haptics instead of navigator.vibrate
    },
    // Status bar styling
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0f0f0f',
    },
  },
};

export default config;
