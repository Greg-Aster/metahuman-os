# MetaHuman Mobile (Android)

Capacitor-based Android app that shares the same codebase as the web UI.

## Prerequisites

1. **Android Studio** - Download from https://developer.android.com/studio
2. **Android SDK** - Install via Android Studio SDK Manager
3. **Java 17+** - Required for Gradle builds
4. **USB Debugging** - Enable on your Android device

## Initial Setup

```bash
# From apps/mobile directory
pnpm install

# Add Android platform (one-time)
npx cap add android

# Open in Android Studio (for SDK setup if needed)
npx cap open android
```

## Development (Live Reload)

The app connects to your web dev server for instant updates:

```bash
# Terminal 1: Start web dev server
cd apps/site && pnpm dev

# Terminal 2: Run on Android with live reload
cd apps/mobile && pnpm dev
```

Or use the helper script that does both:

```bash
./scripts/dev.sh
```

**Important**: Your Android device must be on the same WiFi network as your dev machine.

### Troubleshooting Live Reload

If the app shows a blank screen or connection error:

1. Check your IP: `pnpm dev:ip`
2. Update `capacitor.config.ts` with your current IP
3. Make sure firewall allows port 4321
4. Try: `adb reverse tcp:4321 tcp:4321` for USB-only connection

## Production Build

```bash
# Build web + sync to Android
pnpm build

# Build debug APK
pnpm build:apk
# Output: android/app/build/outputs/apk/debug/app-debug.apk

# Build release APK (requires signing config)
pnpm build:release
```

## Project Structure

```
apps/mobile/
├── android/              # Native Android project (gitignored initially)
│   ├── app/
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       └── res/          # Icons, splash screens
│   └── build.gradle
├── scripts/
│   └── dev.sh            # Development helper script
├── capacitor.config.ts   # Capacitor configuration
├── package.json
└── README.md
```

## Adding Native Features

Capacitor uses plugins for native functionality. Already included:

- `@capacitor/keyboard` - Chat input handling
- `@capacitor/haptics` - Vibration feedback (replaces navigator.vibrate)
- `@capacitor/status-bar` - Status bar styling
- `@capacitor/app` - App lifecycle events

To add more:

```bash
pnpm add @capacitor/push-notifications
npx cap sync
```

## Custom Native Plugins

For features like background media buttons, create a native plugin:

```
android/app/src/main/java/com/metahuman/plugins/
└── MediaButtonPlugin.java
```

See Capacitor docs: https://capacitorjs.com/docs/plugins/creating-plugins

## Connecting to Remote Backend

By default, the app connects to your local dev server. For testing with a remote backend:

```typescript
// capacitor.config.ts
server: {
  url: 'https://your-metahuman-server.com',
  // cleartext: false for HTTPS
}
```

## Common Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run on device with live reload |
| `pnpm sync` | Sync web changes to Android |
| `pnpm open` | Open project in Android Studio |
| `pnpm build` | Full build (web + Android sync) |
| `pnpm build:apk` | Build debug APK |
