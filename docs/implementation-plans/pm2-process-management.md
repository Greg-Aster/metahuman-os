# PM2 Process Management Implementation Plan

## Overview

This document outlines the plan to integrate PM2 (Process Manager 2) into MetaHuman OS for improved process management, clustering, and production stability.

## Current Architecture

### Process Landscape

| Process | Type | Current Management | Notes |
|---------|------|-------------------|-------|
| Web Server | Astro SSR | `start.sh` / manual | Single-threaded, port 4321 |
| scheduler-service | Background agent | `./bin/mh start` | Uses file lock for single-instance |
| audio-organizer | Background agent | `./bin/mh start` | Uses file lock for single-instance |
| terminal-server | Service | `./bin/start-terminal` | WebSocket-based |
| voice servers | Services | `./bin/start-voice-server` | Kokoro, RVC, SoVits |
| cloudflare tunnel | Service | `./bin/start-cloudflare` | Optional |

### Current Pain Points

1. **Single-threaded web server** - Only uses 1 CPU core
2. **Manual process management** - No auto-restart on crash
3. **Fragmented logging** - Logs scattered across multiple files
4. **Complex startup/shutdown** - Multiple scripts to manage
5. **No zero-downtime deploys** - Must stop server to update

## Proposed Architecture

### PM2 Scope

**Will manage with PM2:**
- Web server (clustered across CPU cores)

**Will NOT manage with PM2 (keep existing):**
- scheduler-service (requires single-instance lock)
- audio-organizer (requires single-instance lock)
- Other agents (managed by scheduler-service)

### Why Partial Integration?

The background agents use file-based locks (`acquireLock()`) for single-instance guarantees. PM2's cluster mode would spawn multiple instances, breaking this design. The agents should remain managed by the existing `./bin/mh start` system.

## Implementation Plan

### Phase 1: Basic PM2 Setup (Low Risk)

**Goal:** Run web server under PM2 without clustering

**Changes:**
1. Create `ecosystem.config.js` configuration file
2. Create `start-pm2.sh` script (alternative to `start.sh`)
3. Update `stop.sh` to handle PM2
4. Document usage

**Files to create:**
- `ecosystem.config.js`
- `bin/start-pm2`
- `bin/stop-pm2`

**Estimated effort:** 1-2 hours

### Phase 2: Cluster Mode (Medium Risk)

**Goal:** Enable multi-core web server

**Changes:**
1. Update ecosystem config with `instances: 'max'`
2. Test SSE/EventSource compatibility
3. Add session affinity if needed

**Potential issues:**
- EventSource streams may need sticky sessions
- In-memory state won't be shared between workers

**Estimated effort:** 2-4 hours (including testing)

### Phase 3: Full Integration (Optional)

**Goal:** PM2 manages agents too

**Changes:**
1. Modify agents to use PM2's cluster awareness instead of file locks
2. Use PM2's `wait_ready` and `listen_timeout` for coordination
3. Migrate all process management to PM2

**Note:** This is optional and higher risk. The current agent management works well.

**Estimated effort:** 8-16 hours

## Detailed Configuration

### ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: 'metahuman-web',
      script: 'dist/server/entry.mjs',
      cwd: './apps/site',

      // Clustering
      instances: 'max',           // Use all CPU cores
      exec_mode: 'cluster',       // Enable cluster mode

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 4321,
      },

      // Stability
      max_memory_restart: '1G',   // Restart if memory exceeds 1GB
      min_uptime: '10s',          // Consider started after 10s
      max_restarts: 10,           // Max restarts in restart_delay window
      restart_delay: 4000,        // Wait 4s between restarts

      // Logging
      log_file: './logs/pm2/combined.log',
      out_file: './logs/pm2/out.log',
      error_file: './logs/pm2/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,           // Merge cluster logs

      // Graceful shutdown
      kill_timeout: 5000,         // Wait 5s for graceful shutdown
      listen_timeout: 10000,      // Wait 10s for app to listen

      // Watch (for development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git'],
    },
  ],
};
```

### bin/start-pm2

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Starting MetaHuman OS with PM2..."

# Ensure PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found. Installing..."
    npm install -g pm2
fi

# Clean up stale files (reuse existing function)
source "$REPO_ROOT/start.sh" --source-only 2>/dev/null || true

# Start background agents (existing system)
"$REPO_ROOT/bin/mh" start --restart

# Start optional services
"$REPO_ROOT/bin/start-cloudflare" 2>/dev/null || true
"$REPO_ROOT/bin/start-voice-server" 2>/dev/null || true
"$REPO_ROOT/bin/start-terminal" 2>/dev/null || true

# Build if needed
cd "$REPO_ROOT/apps/site"
if [ ! -f "dist/server/entry.mjs" ]; then
    echo "Building production bundle..."
    pnpm build
fi

# Start web server with PM2
cd "$REPO_ROOT"
pm2 start ecosystem.config.js

echo ""
echo "MetaHuman OS started with PM2"
echo "URL: http://localhost:4321"
echo ""
echo "Useful commands:"
echo "  pm2 monit          # Real-time monitoring"
echo "  pm2 logs           # View logs"
echo "  pm2 restart all    # Restart all processes"
echo "  ./bin/stop-pm2     # Stop everything"
```

### bin/stop-pm2

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Stopping MetaHuman OS..."

# Stop PM2 processes
if command -v pm2 &> /dev/null; then
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
fi

# Stop agents
"$REPO_ROOT/bin/mh" agent stop --all 2>/dev/null || true

# Stop other services
"$REPO_ROOT/bin/stop-terminal" 2>/dev/null || true

# Force kill stragglers
pkill -f "brain/agents" 2>/dev/null || true
pkill -f "scheduler-service" 2>/dev/null || true

echo "MetaHuman OS stopped"
```

## Migration Path

### Step 1: Install PM2 (No Changes Yet)
```bash
npm install -g pm2
```

### Step 2: Test Alongside Existing Setup
```bash
# Stop existing server
./stop.sh

# Start with PM2
./bin/start-pm2

# Verify everything works
curl http://localhost:4321

# Check PM2 status
pm2 list
pm2 monit
```

### Step 3: Verify Cluster Mode
```bash
# Check all workers are running
pm2 list

# Should see multiple instances:
# ┌─────────────────┬────┬─────────┬──────┬───────┐
# │ Name            │ id │ mode    │ cpu  │ mem   │
# ├─────────────────┼────┼─────────┼──────┼───────┤
# │ metahuman-web   │ 0  │ cluster │ 0%   │ 80mb  │
# │ metahuman-web   │ 1  │ cluster │ 0%   │ 78mb  │
# │ metahuman-web   │ 2  │ cluster │ 0%   │ 82mb  │
# │ metahuman-web   │ 3  │ cluster │ 0%   │ 79mb  │
# └─────────────────┴────┴─────────┴──────┴───────┘
```

### Step 4: Configure Auto-Start on Boot
```bash
# Generate startup script
pm2 startup

# Save current process list
pm2 save
```

## Rollback Plan

If PM2 causes issues:

```bash
# Stop PM2
pm2 stop all
pm2 delete all

# Return to original startup
./start.sh
```

No code changes are required for rollback - the original `start.sh` remains unchanged.

## Testing Checklist

### Functionality Tests
- [ ] Web UI loads correctly
- [ ] Chat functionality works
- [ ] SSE streaming (audit stream, log stream) works
- [ ] WebSocket connections (terminal) work
- [ ] Voice synthesis works
- [ ] Memory browser works
- [ ] Agent monitoring shows correct status

### Cluster Mode Tests
- [ ] All workers start successfully
- [ ] Requests are distributed across workers
- [ ] Session cookies persist across requests
- [ ] SSE streams don't disconnect unexpectedly
- [ ] No duplicate processing of requests

### Stability Tests
- [ ] Workers restart after crash (`pm2 restart`)
- [ ] Graceful reload works (`pm2 reload`)
- [ ] Memory limits respected
- [ ] Logs rotate correctly

### Integration Tests
- [ ] Agents start/stop correctly
- [ ] Terminal server works
- [ ] Voice servers work
- [ ] Cloudflare tunnel works

## Performance Expectations

### Before (Single Process)
- 1 CPU core utilized
- ~100 concurrent requests before degradation
- Single point of failure

### After (PM2 Cluster)
- All CPU cores utilized
- ~100 × N concurrent requests (N = cores)
- Auto-restart on failure
- Zero-downtime reloads

### Caveats
- LLM inference is still the bottleneck (Ollama)
- Memory usage increases with workers
- Some stateful operations may need adjustment

## Decision Points

### Questions to Consider

1. **Do you need clustering now?**
   - If you're the only user, single-process may be sufficient
   - Clustering helps with multiple concurrent users

2. **Is SSE streaming critical?**
   - May need testing with cluster mode
   - Fallback: use `instances: 1` (still get PM2 benefits without clustering)

3. **Auto-start on boot?**
   - Useful for production servers
   - Requires `pm2 startup` configuration

### Recommended Approach

Start with **Phase 1** (single instance, no clustering):
```javascript
instances: 1,  // No clustering, just PM2 management
```

This gives you:
- Auto-restart on crash
- Centralized logging
- Easy monitoring (`pm2 monit`)
- Foundation for future clustering

Once stable, enable clustering by changing to `instances: 'max'`.

## Summary

| Aspect | Current | With PM2 |
|--------|---------|----------|
| Web server processes | 1 | 1-N (configurable) |
| Auto-restart | No | Yes |
| Centralized logs | No | Yes |
| Monitoring | Manual | `pm2 monit` |
| Zero-downtime reload | No | Yes |
| Startup complexity | Medium | Lower |
| Agent management | Unchanged | Unchanged |

**Recommendation:** Implement Phase 1 first. It's low-risk and provides immediate benefits. Clustering (Phase 2) can be enabled later with a single config change.
