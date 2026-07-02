# How to Run MetaHuman OS

## Current Authority

For maintained architecture and refactor work, use [docs/technical/REFACTOR_BLUEPRINT.md](docs/technical/REFACTOR_BLUEPRINT.md) and [docs/technical/MAINTAINED_SURFACE.md](docs/technical/MAINTAINED_SURFACE.md). This startup guide covers the current web/CLI shell only. Historical Capacitor-era `apps/mobile` APK notes are archived and are not part of the maintained startup path.

## Quick Start (Pick ONE)

| Use Case | Command | Notes |
|----------|---------|-------|
| **Production** | `./start.sh` | Recommended. Runs in foreground, Ctrl+C to stop |
| **Development** | `cd apps/site && pnpm dev` | Hot reload, fast refresh |
| **Background/Server** | `./bin/start-pm2` | Runs detached, survives terminal close |

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

## Mobile App

The maintained mobile shell is `apps/react-native`. The older `apps/mobile` Capacitor APK flow is deprecated legacy material and is intentionally excluded from normal architecture refactor work. See [docs/technical/MAINTAINED_SURFACE.md](docs/technical/MAINTAINED_SURFACE.md) for the maintained-source boundary.

## Summary

- **Just want to run it?** → `./start.sh`
- **Developing/coding?** → `pnpm dev`
- **Server/24-7?** → `./bin/start-pm2`
- **Mobile work?** → start from `apps/react-native` and the maintained-source docs
