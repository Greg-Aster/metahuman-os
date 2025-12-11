# Running React Native MetaHuman App

This guide explains how to run the React Native version of MetaHuman OS for development and testing.

## Prerequisites

1. **Node.js** >= 20.0.0 (check with `node --version`)
2. **Android Studio** installed with:
   - Android SDK
   - Android SDK Platform-Tools
   - Android Virtual Device (AVD) or physical Android device
3. **Java Development Kit (JDK)** 17 or higher
4. **React Native development environment** set up ([guide](https://reactnative.dev/docs/environment-setup))

## Quick Start

### 1. Install Dependencies

```bash
cd /home/greggles/metahuman/apps/react-native
npm install
```

### 2. Start Metro Bundler (Development Server)

Metro is React Native's JavaScript bundler that provides live reloading:
npm start
```bash
npm start
```

This starts the Metro bundler on port 8081. Keep this terminal open.

### 3. Run on Android Device/Emulator

In a new terminal:

```bash
cd /home/greggles/metahuman/apps/react-native
npm run android
```

This will:
- Build the Android app
- Install it on your connected device/emulator
- Launch the app
- Connect to Metro for live reloading

## Architecture Overview

This React Native app has a unique architecture:

```
┌─────────────────────────────────┐
│     React Native Shell          │
│  (App.tsx - ~100 lines)         │
├─────────────────────────────────┤
│         WebView                 │
│   (Loads localhost:4322)        │
├─────────────────────────────────┤
│    Node.js 18 Backend           │
│  (nodejs-mobile-react-native)   │
├─────────────────────────────────┤
│     Svelte UI (Built)           │
│  (From apps/site, served by     │
│   Node.js as static files)      │
└─────────────────────────────────┘
```

## Development Workflow

### For React Native Shell Changes (App.tsx)

1. Make changes to `App.tsx`
2. Metro will automatically reload the app (Fast Refresh)
3. Changes appear instantly without losing app state

### For Svelte UI Changes

1. Build the Svelte UI with mobile config:
   ```bash
   cd ../site
   npm run build:mobile
   ```

2. Copy the built files to React Native:
   ```bash
   cd ../react-native
   ./scripts/build-mobile.sh
   ```

3. Restart the React Native app:
   ```bash
   npm run android
   ```

### For Backend Changes (@metahuman/core)

1. Make changes to core packages
2. Run the mobile build script:
   ```bash
   ./scripts/build-mobile.sh
   ```
3. Restart the app to load new backend code

## Live Development Features

### Fast Refresh (Hot Reloading)

- **Enabled by default** for JavaScript/TypeScript changes
- Preserves component state during edits
- Shows errors directly in the app

### Developer Menu

Shake the device or press `Cmd+M` (Mac) / `Ctrl+M` (Windows/Linux) to open:
- **Reload** - Full app reload
- **Debug** - Open Chrome DevTools
- **Show Inspector** - UI element inspector
- **Show Perf Monitor** - FPS and memory usage

### Debugging

1. **Console Logs**: View in Metro terminal or:
   ```bash
   npx react-native log-android
   ```

2. **Chrome DevTools**: 
   - Open Developer Menu → Debug
   - Chrome opens at `http://localhost:8081/debugger-ui`
   - Use Console, Network, and Sources tabs

3. **React Developer Tools**:
   ```bash
   npm install -g react-devtools
   react-devtools
   ```

## Building for Production

### Debug APK (for testing)

```bash
./scripts/build-mobile.sh
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (for distribution)

1. Configure signing in `android/app/build.gradle`
2. Run:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

## Common Issues & Solutions

### Metro Connection Issues

If the app shows "Unable to connect to development server":

1. Ensure Metro is running (`npm start`)
2. Check device is on same network as computer
3. For physical devices, run:
   ```bash
   adb reverse tcp:8081 tcp:8081
   ```

### Build Failures

1. Clean and rebuild:
   ```bash
   cd android
   ./gradlew clean
   cd ..
   npm run android
   ```

2. Clear Metro cache:
   ```bash
   npx react-native start --reset-cache
   ```

### Node.js Backend Issues

Check the React Native logs for Node.js output:
```bash
adb logcat | grep "Node.js"
```

## Environment Variables

The app respects these build-time variables:

- `JAVA_HOME` - Path to JDK (defaults to Android Studio's bundled JDK)
- `ANDROID_HOME` - Android SDK location

## Port Configuration

- **8081**: Metro bundler (development server)
- **4322**: Node.js HTTP server (inside the app)
- **8082**: React DevTools (if used)

## Tips for Development

1. **Use the Web UI First**: Develop features in the web UI (`apps/site`) first, then test on mobile
2. **Monitor Both Logs**: Keep both Metro terminal and `adb logcat` open
3. **Test on Real Device**: Performance characteristics differ from emulator
4. **Check Node.js Compatibility**: Remember the app uses Node.js 18 (not 12 like Capacitor)

## Project Structure

```
apps/react-native/
├── App.tsx              # Main React Native component (WebView wrapper)
├── index.js             # Entry point
├── package.json         # Dependencies and scripts
├── metro.config.js      # Metro bundler config
├── android/             # Android native code
├── ios/                 # iOS native code (not yet configured)
├── nodejs-assets/       # Node.js backend assets
│   └── nodejs-project/  # Node.js server code
├── scripts/             # Build scripts
│   └── build-mobile.sh  # Full build script
└── www/                 # Built Svelte UI (generated)
```

## Next Steps

1. Complete the React Native migration (Phase 6/7)
2. Remove the old Capacitor app once verified
3. Configure iOS build (currently Android only)
4. Set up CI/CD for automated builds

For more details, see `REACT-NATIVE-MIGRATION.md` in the monorepo root.