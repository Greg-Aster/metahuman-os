# MetaHuman Android App

This package is the Android interface for MetaHuman OS. React Native owns the
native shell, WebView, microphone permission, and device speech recognition.
The embedded Node 18 process serves the built Site UI and delegates API work to
the same Core HTTP adapter used by the web application.

## Ownership

- `App.tsx`: native shell and WebView/native-device bridge.
- `nodejs-assets/nodejs-project/main.js`: Android-local HTTP/static transport and
  agent lifecycle bridge.
- `brain/mobile-handlers.ts`: mobile agent registrations.
- `packages/core/src/api/adapters/http.ts`: canonical API dispatch.
- root `etc/`: canonical model, agent, and cognitive-graph configuration.
- `scripts/build-backend.mjs`: generates ignored backend bundles and mobile
  configuration assets from those owners.

Do not edit `nodejs-assets/nodejs-project/dist`, `etc`, or `www` directly. They
are generated build inputs and are intentionally untracked.

## Development

Requirements: Node 22, pnpm 10, JDK 17+, Android SDK/platform tools, and an
Android emulator or connected device.

```bash
pnpm install
pnpm --dir apps/react-native android
```

The Android command prepares current backend assets, rebuilds and installs the
APK when required, starts Metro, launches the app, and streams filtered logs.
Use `pnpm --dir apps/react-native dev:device` for a connected physical device or
`pnpm --dir apps/react-native dev:rebuild` to force backend regeneration.

For a complete standalone debug APK:

```bash
pnpm --dir apps/react-native build
```

Output: `apps/react-native/android/app/build/outputs/apk/debug/app-debug.apk`.
The normal build uses the Android debug key and never mutates release state.

`build:release` is the sole APK publication owner. It requires
`METAHUMAN_ANDROID_KEYSTORE_PATH`, `METAHUMAN_ANDROID_KEYSTORE_PASSWORD`,
`METAHUMAN_ANDROID_KEY_ALIAS`, and `METAHUMAN_ANDROID_KEY_PASSWORD`; it refuses
to publish a debug-signed artifact. Version metadata advances only after the
signed build succeeds.

## Validation

```bash
pnpm --dir apps/react-native typecheck
pnpm --dir apps/react-native lint
pnpm --dir apps/react-native test
node apps/react-native/scripts/build-backend.mjs
```

The repository currently maintains Android only. iOS is not an advertised or
partially scaffolded product surface.
