# How to Run MetaHuman OS

## Quick Start (Pick ONE)

| Use Case | Command | Notes |
|----------|---------|-------|
| **Production** | `./start.sh` | Recommended. Runs in foreground, Ctrl+C to stop |
| **Development** | `cd apps/site && pnpm dev` | Hot reload, fast refresh |
| **Background/Server** | `./bin/start-pm2` | Runs detached, survives terminal close |
| **Mobile APK** | `cd apps/mobile && pnpm build:mobile` | Bundles UI into Android APK |

## Detailed Comparison

### For Daily Use: `./start.sh`
```bash
./start.sh
```
- Builds production bundle if needed
- Starts all agents and services
- Shows logs in terminal
- Press **Ctrl+C** to stop everything
- **Best for**: Normal usage, seeing what's happening

### For Development: `pnpm dev`
```bash
cd apps/site && pnpm dev
```
- Hot Module Replacement (instant updates)
- Starts agents automatically
- Shows detailed logs
- **Best for**: Editing code, debugging

### For Servers/Background: `./bin/start-pm2`
```bash
./bin/start-pm2    # Start
./bin/stop-pm2     # Stop
pm2 logs           # View logs
pm2 monit          # Dashboard
```
- Runs in background (daemonized)
- Auto-restarts on crash
- Can use multiple CPU cores (cluster mode)
- **Best for**: Running 24/7, production servers

## Stopping Everything

| Started With | Stop With |
|--------------|-----------|
| `./start.sh` | Ctrl+C |
| `pnpm dev` | Ctrl+C |
| `./bin/start-pm2` | `./bin/stop-pm2` |
| Any/Unknown | `./stop.sh` (stops everything) |

## Other Scripts (You Probably Don't Need These)

| Script | Purpose |
|--------|---------|
| `start.py` | Windows/cross-platform installer (interactive prompts) |
| `start.bat` | Windows batch file |
| `pnpm dev:no-hmr` | Development without hot reload (for debugging HMR issues) |
| `bin/start-cloudflare` | Start Cloudflare tunnel (auto-started by main scripts) |
| `bin/start-voice-server` | Start TTS server (auto-started by main scripts) |
| `bin/start-terminal` | Start terminal server (auto-started by main scripts) |

## Troubleshooting

**Port 4321 already in use?**
```bash
./stop.sh   # Kills everything
```

**Agents not starting?**
```bash
./bin/mh agent ps      # Check running agents
./bin/mh start --restart  # Restart agents
```

**Stale lock files?**
```bash
./stop.sh   # Cleans up stale files automatically
```

## Mobile App (Android)

The mobile app bundles the entire web UI into the APK for offline capability. The UI loads instantly from local assets while API calls go to the remote server.

### Build APK (Bundled UI)
```bash
cd apps/mobile && pnpm build:mobile
```
This creates a self-contained APK at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**What happens:**
1. Builds Astro with static output (no server required)
2. Copies built assets to Capacitor's `www/` folder
3. Syncs with Android project
4. Builds debug APK with Gradle

### Development (Live Reload)
```bash
cd apps/mobile && pnpm dev
```
- Connects to your local dev server for live updates
- Requires the web dev server running (`cd apps/site && pnpm dev`)
- Device must be on same network as your computer

### Install APK
```bash
# Via ADB (USB connected)
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk

# Or serve for download
cd apps/mobile/android/app/build/outputs/apk/debug && python3 -m http.server 8888
```

### Architecture
```
┌─────────────────┐   file://    ┌──────────────────┐
│ Android WebView │ ───────────→ │ Bundled UI       │
│                 │              │ (www/ folder)    │
└─────────────────┘              └──────────────────┘
        │
        │ https://mh.dndiy.org/api/*
        ▼
┌──────────────────┐
│ Remote API       │
└──────────────────┘
```

**Benefits:**
- Instant UI loading (no server fetch)
- Works offline (UI only, API calls need connection)
- Single codebase: build web → automatically updates mobile

## Summary

- **Just want to run it?** → `./start.sh`
- **Developing/coding?** → `pnpm dev`
- **Server/24-7?** → `./bin/start-pm2`
- **Build mobile APK?** → `cd apps/mobile && pnpm build:mobile`

