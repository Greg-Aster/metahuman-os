import type { CapacitorConfig } from '@capacitor/cli';

// Server configuration
// Development: Use local IP (run `pnpm dev:ip` to find yours)
// Production: Set METAHUMAN_SERVER to your hosted URL
const DEV_SERVER_IP = process.env.DEV_SERVER_IP || '192.168.0.44';
const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '4321';
const PRODUCTION_SERVER = process.env.METAHUMAN_SERVER || 'https://mh.dndiy.org';
const DEV_MODE = process.env.DEV_MODE === 'true';

// Determine which server to connect to
const serverUrl = DEV_MODE
  ? `http://${DEV_SERVER_IP}:${DEV_SERVER_PORT}`
  : PRODUCTION_SERVER;

const config: CapacitorConfig = {
  appId: 'com.metahuman.os',
  appName: 'MetaHuman',

  // Note: webDir is required by Capacitor but we use server.url instead
  // Create a minimal placeholder for the initial setup
  webDir: 'www',

  // Always connect to a server (MetaHuman requires backend)
  server: {
    url: serverUrl,
    cleartext: DEV_MODE, // Allow HTTP only in dev mode
  },

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
