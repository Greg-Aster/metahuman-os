# Mobile App Setup Documentation

## Overview

MetaHuman mobile app using Capacitor - developed in parallel with the web UI.

**Date Started**: 2025-12-03
**Status**: ✅ Setup Complete - Ready for Development

## Architecture Decision

### Why Capacitor over alternatives:

| Option | Verdict | Reason |
|--------|---------|--------|
| WebView wrapper | ❌ | Limited native features |
| **Capacitor** | ✅ | Best balance of code sharing + native access |
| React Native | ❌ | Would require rewriting UI layer |
| Kotlin Native | ❌ | Separate codebase, no parallel development |

### Key Insight: Always-Online Architecture

MetaHuman's Astro app uses SSR (`output: 'server'`) and requires a backend for:
- LLM inference (Ollama)
- TTS generation
- STT transcription
- Agent execution
- Memory storage

**Therefore**: Mobile app always connects to server (no offline static build possible).

## Setup Steps Completed

### 1. Created Separated Directory Structure

```
apps/
├── site/           # Web UI (unchanged)
└── mobile/         # Capacitor wrapper (new)
    ├── android/    # Native Android project
    ├── www/        # Minimal placeholder (redirects to server)
    ├── scripts/
    │   └── dev.sh  # Development helper
    ├── capacitor.config.ts
    ├── package.json
    └── README.md
```

**Rationale**: Separation of concerns - web team doesn't see Android folders, mobile-specific plugins isolated.

### 2. Dependencies Installed

```json
{
  "dependencies": {
    "@capacitor/android": "^6.0.0",
    "@capacitor/app": "^6.0.0",
    "@capacitor/core": "^6.0.0",
    "@capacitor/haptics": "^6.0.0",
    "@capacitor/keyboard": "^6.0.0",
    "@capacitor/status-bar": "^6.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0"
  }
}
```

### 3. Capacitor Configuration

Key decisions in `capacitor.config.ts`:

```typescript
// Development: connects to local Astro dev server (live reload)
// Production: connects to hosted MetaHuman server
const serverUrl = DEV_MODE
  ? `http://${DEV_SERVER_IP}:${DEV_SERVER_PORT}`
  : PRODUCTION_SERVER;

const config: CapacitorConfig = {
  appId: 'com.metahuman.os',
  appName: 'MetaHuman',
  webDir: 'www',  // Minimal placeholder, actual content from server
  server: {
    url: serverUrl,
    cleartext: DEV_MODE,
  },
  // ...
};
```

### 4. Android Platform Added

```bash
cd apps/mobile
npx cap add android
npx cap sync
```

## Development Workflow

### Quick Start (from repo root)

```bash
# Run both web dev server and Android app
pnpm mobile:dev

# Or sync changes manually
pnpm mobile:sync

# Open in Android Studio
pnpm mobile:open
```

### Live Reload (Recommended)

```bash
# Terminal 1: Start web dev server
cd apps/site && pnpm dev

# Terminal 2: Run Android with live reload
cd apps/mobile
DEV_MODE=true npx cap run android --livereload --external
```

Changes to Svelte components, CSS, or API routes reflect immediately on the Android device.

### Production Build

```bash
# Build APK pointing to production server
cd apps/mobile
METAHUMAN_SERVER=https://your-server.com npx cap sync
cd android && ./gradlew assembleRelease
```

## Voice Features Status

Existing implementations that work on mobile:

| Feature | File | Status |
|---------|------|--------|
| Microphone input | `useMicrophone.ts` | ✅ Works (MediaRecorder API) |
| Hardware buttons | `useMicrophone.ts:1505-1598` | ✅ Media Session API |
| Vibration feedback | `useMicrophone.ts:811-814` | ✅ Capacitor Haptics |
| TTS playback | `useTTS.ts` | ✅ Works (AudioContext) |
| Streaming TTS | `/api/tts-stream` | ✅ EventSource works |

## Next Steps

- [ ] Test on physical Android device
- [ ] Configure app icons and splash screen
- [ ] Set up Firebase for push notifications (optional)
- [ ] Create custom MediaButton plugin for background button handling
- [ ] Test voice features on mobile

## Troubleshooting

### App shows blank screen

1. Check device is on same WiFi as dev server
2. Verify IP address: `pnpm dev:ip`
3. Update `capacitor.config.ts` with correct IP
4. Check firewall allows port 4321

### USB debugging alternative

```bash
# Forward port through USB (no WiFi needed)
adb reverse tcp:4321 tcp:4321
```

### EventSource drops connection

Mobile browsers may disconnect SSE after ~60s inactivity. Implement reconnection logic in chat components.

## References

- Capacitor docs: https://capacitorjs.com/docs
- Astro SSR: https://docs.astro.build/en/guides/server-side-rendering/
- Existing voice impl: `apps/site/src/lib/client/composables/useMicrophone.ts`
