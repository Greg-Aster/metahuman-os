import type { CapacitorConfig } from '@capacitor/cli';

// Build mode configuration
// DEV_MODE=true: Connect to local dev server for live reload
// DEV_MODE=false (default): Connect to production server
const DEV_SERVER_IP = process.env.DEV_SERVER_IP || '192.168.0.44';
const DEV_SERVER_PORT = process.env.DEV_SERVER_PORT || '4321';
const DEV_MODE = process.env.DEV_MODE === 'true';

// Production server URL
const PROD_SERVER_URL = 'https://mh.dndiy.org';

const config: CapacitorConfig = {
  appId: 'com.metahuman.os',
  appName: 'MetaHuman',

  // Web assets directory - loads from bundled www/ folder in production
  webDir: 'www',

  // Server configuration
  // Dev mode: local server for live reload
  // Production mode: loads from bundled www/ folder (offline capable)
  //   API calls go to PROD_SERVER_URL via apiFetch()
  ...(DEV_MODE && {
    server: {
      url: `http://${DEV_SERVER_IP}:${DEV_SERVER_PORT}`,
      cleartext: true, // Allow HTTP for local dev server
    }
  }),

  android: {
    // Allow mixed content only in dev mode
    allowMixedContent: DEV_MODE,
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
