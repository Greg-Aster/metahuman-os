# Headless Runtime Mode

## Overview

Headless Runtime Mode allows you to keep MetaHuman OS's web interface and Cloudflare tunnel running while pausing all local autonomous agents. This is essential for remote access scenarios where you want to dedicate full system resources to a remote session without conflicts from local background processes.

**Use Case:** Enable the tunnel from your laptop, switch to headless mode, and access MetaHuman remotely from any device without resource conflicts or duplicate agent execution.

---

## Table of Contents

- [What is Headless Mode?](#what-is-headless-mode)
- [When to Use Headless Mode](#when-to-use-headless-mode)
- [How It Works](#how-it-works)
- [Enabling Headless Mode](#enabling-headless-mode)
- [Remote Session Claiming](#remote-session-claiming)
- [System Sleep Prevention](#system-sleep-prevention)
- [Monitoring and Verification](#monitoring-and-verification)
- [Troubleshooting](#troubleshooting)

---

## What is Headless Mode?

Headless Mode is a runtime state that:

✅ **Keeps Running:**
- Cloudflare tunnel (if enabled)
- Astro web server
- Web UI (fully accessible)
- `headless-watcher` agent (monitors mode changes)

⏸️ **Pauses:**
- `scheduler-service` (agent orchestrator)
- `boredom-service` (reflector trigger)
- `sleep-service` (nightly pipeline)
- `organizer` (memory enrichment)
- `reflector` (insight generation)
- `audio-organizer` (audio processing)
- All other autonomous background agents

🎯 **Prevents:**
- Resource conflicts between local and remote sessions
- Duplicate agent execution
- Memory corruption from simultaneous writes

---

## When to Use Headless Mode

### ✅ Ideal Scenarios

1. **Remote Access from Mobile/Tablet**
   - Access your MetaHuman from your phone while laptop stays at home
   - Full UI functionality without local agents running

2. **Multi-Location Usage**
   - Work from office, access home MetaHuman instance
   - Switch between devices seamlessly

3. **Dedicated Remote Sessions**
   - Give full system resources to remote user
   - No background tasks competing for CPU/memory

4. **Development/Testing**
   - Test remote access flows
   - Verify tunnel configuration
   - Debug remote session issues

### ❌ Not Recommended For

1. **Primary Local Usage** - Just use normal mode
2. **Simultaneous Local + Remote** - Resource conflicts will occur
3. **Offline Operation** - Headless mode is for remote access

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                 MetaHuman OS                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Normal Mode              Headless Mode            │
│  ─────────────            ──────────────           │
│                                                     │
│  ✅ Web Server            ✅ Web Server             │
│  ✅ Tunnel               ✅ Tunnel                  │
│  ✅ All Agents           ⏸️  Agents Paused          │
│  ✅ Local Usage          ✅ Remote Only             │
│  ❌ Remote Conflicts     ✅ No Conflicts            │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Component Interaction

1. **Configuration File** (`etc/runtime.json`)
   ```json
   {
     "headless": true,
     "lastChangedBy": "local",
     "changedAt": "2025-11-08T12:00:00Z",
     "claimedBy": null
   }
   ```

2. **Headless Watcher Agent**
   - Monitors `etc/runtime.json` for changes
   - Stops all agents when headless enabled
   - Resumes agents when headless disabled
   - Built-in keepalive prevents process exit
   - Automatic error recovery with retry logic

3. **Startup Guards**
   - CLI: `mh start` checks mode before spawning agents
   - Web UI: `/api/boot` checks mode before auto-start
   - Dev Server: `bin/run-with-agents` respects mode

---

## Enabling Headless Mode

### Via Web UI (Recommended)

1. **Navigate to Network Settings**
   - Open MetaHuman web UI (http://localhost:4321)
   - Click hamburger menu (☰) → "Network"

2. **Locate Headless Mode Section**
   - Scroll to "🖥️ Headless Runtime Mode"
   - Current status displayed: 🟢 Normal Mode or 🟡 Headless Active

3. **Enable/Disable**
   - Toggle "Enable Headless Mode" checkbox
   - Success message appears
   - Status updates within ~2 seconds

4. **Verify**
   - Check status dot: 🟡 for headless, 🟢 for normal
   - View metadata: timestamp and actor (local/remote)

### Via CLI

```bash
# Check current mode
cat etc/runtime.json

# Enable headless mode (manual)
echo '{
  "headless": true,
  "lastChangedBy": "local",
  "changedAt": "'$(date -Iseconds)'",
  "claimedBy": null
}' > etc/runtime.json

# Disable headless mode (manual)
echo '{
  "headless": false,
  "lastChangedBy": "local",
  "changedAt": "'$(date -Iseconds)'",
  "claimedBy": null
}' > etc/runtime.json
```

**⚠️ Note:** Manual file edits trigger the watcher within ~100ms. Use the Web UI for safer operation.

### Via API

```bash
# Enable headless mode
curl -X POST http://localhost:4321/api/runtime/mode \
  -H "Content-Type: application/json" \
  -H "Cookie: mh_session=YOUR_SESSION_TOKEN" \
  -d '{"headless": true}'

# Disable headless mode
curl -X POST http://localhost:4321/api/runtime/mode \
  -H "Content-Type: application/json" \
  -H "Cookie: mh_session=YOUR_SESSION_TOKEN" \
  -d '{"headless": false}'

# Check current mode
curl http://localhost:4321/api/runtime/mode
```

**🔒 Security:** Only owner sessions can change runtime mode. Guest users have read-only access.

---

## Remote Session Claiming

When headless mode is active and you access MetaHuman remotely, you'll see a **claim banner** at the top of the UI:

### Claim Banner Features

```
┌────────────────────────────────────────────────────┐
│ 🖥️  Headless Mode Active                           │
│                                                    │
│ Local agents are paused. Click "Claim Runtime"    │
│ to resume full system operations and dedicate     │
│ all resources to your remote session.             │
│                                                    │
│  [ Claim Runtime ]  [ Dismiss ]                   │
└────────────────────────────────────────────────────┘
```

### Claiming Process

1. **Click "Claim Runtime"**
   - Sends POST to `/api/runtime/mode` with `headless: false`
   - Updates `lastChangedBy` to 'remote'
   - Sets `claimedBy` to your user ID

2. **Agent Resume (~2 seconds)**
   - headless-watcher detects mode change
   - Starts default agents (scheduler, boredom, sleep services)
   - Agents resume normal operation

3. **Page Reload**
   - UI automatically reloads after 1.5 seconds
   - Full system functionality restored
   - All agents running

### Best Practices

- **Single User:** Only one person should claim at a time
- **Coordination:** Communicate with other users before claiming
- **Re-enable Headless:** When done, toggle back to headless for next user

---

## System Sleep Prevention

### ⚠️ Important Limitation

**The headless-watcher keeps the Node.js process alive (event loop active), but does NOT prevent OS-level system sleep.**

For true sleep prevention, configure your operating system:

### Linux

**Option 1: Disable Sleep Targets (Systemd)**
```bash
# Mask sleep targets
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target

# Verify
systemctl status sleep.target
# Should show: "Loaded: masked"

# Re-enable later (if needed)
sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

**Option 2: Inhibit Sleep While Process Running**
```bash
# Install systemd-inhibit (usually pre-installed)
sudo apt-get install systemd

# Run MetaHuman with sleep inhibitor
systemd-inhibit --what=sleep --who="MetaHuman" --why="Headless mode active" pnpm dev
```

**Option 3: Configure Power Settings (GUI)**
```bash
# GNOME Settings
gnome-control-center power

# KDE Settings
systemsettings5
```

Set "Automatic suspend" to "Off" or "Never"

### macOS

**Option 1: caffeinate (Temporary)**
```bash
# Prevent sleep while MetaHuman runs
caffeinate -s pnpm dev

# Prevent sleep indefinitely (until Ctrl+C)
caffeinate -s
```

**Option 2: System Preferences (Permanent)**
```
System Settings → Energy Saver → Battery/Power Adapter
- Prevent automatic sleeping when display is off: ✅
- Put hard disks to sleep when possible: ❌
```

**Option 3: pmset (Advanced)**
```bash
# Check current settings
pmset -g

# Disable sleep (requires sudo)
sudo pmset -a sleep 0
sudo pmset -a disksleep 0

# Re-enable later
sudo pmset -a sleep 10  # Sleep after 10 minutes
```

### Windows

**Option 1: Power Settings (GUI)**
```
Settings → System → Power & Sleep
- Screen: Never
- Sleep: Never
```

**Option 2: PowerShell (Temporary)**
```powershell
# Prevent sleep (run as Administrator)
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0

# Re-enable (15 minutes on AC, 10 on battery)
powercfg /change standby-timeout-ac 15
powercfg /change standby-timeout-dc 10
```

**Option 3: Keep Display On Script**
```powershell
# Create keepawake.ps1
Add-Type -AssemblyName System.Windows.Forms
while ($true) {
    [System.Windows.Forms.SendKeys]::SendWait("+{F15}")
    Start-Sleep -Seconds 59
}
```

---

## Monitoring and Verification

### Check Agent Status

```bash
# List running agents
./bin/mh agent ps

# Expected in headless mode:
# headless-watcher   RUNNING   PID: 12345

# Expected in normal mode:
# headless-watcher   RUNNING   PID: 12345
# scheduler-service  RUNNING   PID: 12346
# boredom-service    RUNNING   PID: 12347
# sleep-service      RUNNING   PID: 12348
```

### Watch Watcher Logs

```bash
# Follow audit log for watcher activity
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep headless-watcher

# Expected output when toggling:
# {"category":"system","level":"info","message":"Headless mode activated - agents stopped",...}
# {"category":"system","level":"info","message":"Headless mode deactivated - agents resumed",...}
```

### Monitor Mode Changes

```bash
# Watch runtime config file
watch -n 1 cat etc/runtime.json

# Or use jq for pretty output
watch -n 1 'cat etc/runtime.json | jq'
```

### Verify Keepalive Heartbeat

```bash
# Check for keepalive messages (every 60 seconds in headless mode)
tail -f logs/audit/$(date +%Y-%m-%d).ndjson | grep "Keepalive heartbeat"
```

---

## Troubleshooting

### Agents Not Stopping When Headless Enabled

**Symptoms:**
- Toggle headless mode, but agents still running
- `./bin/mh agent ps` shows scheduler/boredom services

**Diagnosis:**
```bash
# Check if headless-watcher is running
./bin/mh agent ps | grep headless-watcher

# Check watcher logs
tail -50 logs/audit/$(date +%Y-%m-%d).ndjson | grep headless-watcher
```

**Solutions:**

1. **Watcher Not Running**
   ```bash
   # Start watcher manually
   ./bin/mh agent run headless-watcher

   # Or restart all services
   ./bin/mh start --restart
   ```

2. **Watcher Crashed**
   ```bash
   # Check for errors in audit log
   grep -A 5 "headless-watcher.*error" logs/audit/$(date +%Y-%m-%d).ndjson

   # Restart watcher
   ./bin/mh agent stop headless-watcher
   ./bin/mh agent run headless-watcher
   ```

3. **File Watcher Not Triggering**
   ```bash
   # Manually trigger by editing file
   echo '{"headless":true,"lastChangedBy":"local","changedAt":"'$(date -Iseconds)'","claimedBy":null}' > etc/runtime.json

   # Wait 2 seconds and check
   ./bin/mh agent ps
   ```

### Agents Not Resuming When Headless Disabled

**Symptoms:**
- Disable headless mode, agents don't restart
- System stuck in paused state

**Diagnosis:**
```bash
# Check runtime config
cat etc/runtime.json
# Should show: "headless": false

# Check watcher status
./bin/mh agent ps | grep headless-watcher
```

**Solutions:**

1. **Watcher Stopped**
   ```bash
   # Restart watcher (it will resume agents)
   ./bin/mh agent run headless-watcher
   ```

2. **Manual Resume**
   ```bash
   # Start agents manually
   ./bin/mh start --restart
   ```

3. **Check Watcher Errors**
   ```bash
   # Look for spawn errors
   grep "Failed to start.*agent" logs/audit/$(date +%Y-%m-%d).ndjson
   ```

### Claim Button Not Appearing (Remote Users)

**Symptoms:**
- Remote user doesn't see claim banner
- Headless mode is active

**Diagnosis:**
```bash
# Check if truly in headless mode
curl http://localhost:4321/api/runtime/mode
# Should show: "headless": true

# Check user session role
# (Owner only can see claim button)
```

**Solutions:**

1. **Ensure Authenticated as Owner**
   - Guest users cannot claim runtime
   - Log in as owner user
   - Check role in user menu (top-left)

2. **Refresh Page**
   - Banner polls every 10 seconds
   - Force refresh: Ctrl+Shift+R / Cmd+Shift+R

3. **Check Component Load**
   - Open browser console (F12)
   - Look for JavaScript errors
   - Verify `HeadlessClaimBanner` component loaded

### System Still Goes to Sleep

**Symptom:** Laptop sleeps despite headless mode active

**Cause:** Node.js keepalive ≠ OS sleep prevention (by design)

**Solution:** Configure OS-level sleep prevention (see [System Sleep Prevention](#system-sleep-prevention))

### Mode Changes Not Persisting

**Symptoms:**
- Toggle mode in UI, reverts on refresh
- `etc/runtime.json` not updating

**Diagnosis:**
```bash
# Check file permissions
ls -la etc/runtime.json

# Check file ownership
stat etc/runtime.json
```

**Solutions:**

1. **Permission Issues**
   ```bash
   # Fix ownership
   sudo chown $USER:$USER etc/runtime.json

   # Fix permissions
   chmod 644 etc/runtime.json
   ```

2. **Directory Not Writable**
   ```bash
   # Fix etc/ directory permissions
   chmod 755 etc/
   ```

3. **Disk Full**
   ```bash
   # Check disk space
   df -h .

   # Clean up old logs if needed
   find logs/ -name "*.ndjson" -mtime +30 -delete
   ```

---

## Configuration Reference

### Runtime State File (`etc/runtime.json`)

```typescript
interface RuntimeState {
  /** True if in headless mode (agents paused) */
  headless: boolean;

  /** Who last changed the mode */
  lastChangedBy: 'local' | 'remote';

  /** ISO timestamp of last change */
  changedAt: string;

  /** User ID who claimed runtime (null if not claimed) */
  claimedBy: string | null;
}
```

**Example:**
```json
{
  "headless": true,
  "lastChangedBy": "remote",
  "changedAt": "2025-11-08T17:51:01.220Z",
  "claimedBy": "user-uuid-123"
}
```

### Audit Log Entries

Headless mode changes are fully audited:

```json
{
  "category": "system",
  "level": "info",
  "message": "Headless mode activated - agents stopped",
  "actor": "headless-watcher",
  "metadata": {
    "stopped": ["scheduler-service", "boredom-service", "sleep-service"],
    "failed": [],
    "total": 3,
    "changedBy": "local"
  },
  "timestamp": "2025-11-08T12:00:00.000Z"
}
```

---

## Best Practices

### 1. Enable Tunnel First

Always set up the Cloudflare tunnel before using headless mode:

```bash
# See: docs/user-guide/17-cloudflare-tunnel-setup.md

# 1. Install cloudflared
# 2. Configure tunnel
# 3. Enable auto-start
# 4. THEN enable headless mode
```

### 2. Coordinate with Other Users

If multiple people have access:
- Post in team chat before claiming
- Set up a "who's using it" calendar
- Use display name to indicate active user

### 3. Monitor System Health

```bash
# Create a simple health check script
cat > check-headless.sh << 'EOF'
#!/bin/bash
echo "=== Headless Status ==="
cat etc/runtime.json | jq
echo ""
echo "=== Running Agents ==="
./bin/mh agent ps
echo ""
echo "=== Tunnel Status ==="
./bin/mh tunnel status
EOF

chmod +x check-headless.sh
./check-headless.sh
```

### 4. Test Before Leaving

Before relying on remote access:
1. Enable headless mode locally
2. Verify agents stopped
3. Access from remote device (phone/tablet)
4. Test claim flow
5. Verify agents resume
6. Disable headless and re-enable remotely

### 5. Keep Logs Clean

```bash
# Rotate old audit logs (keep 30 days)
find logs/audit/ -name "*.ndjson" -mtime +30 -delete

# Archive monthly
mkdir -p logs/archive/2025-11/
mv logs/audit/2025-11-*.ndjson logs/archive/2025-11/
```

---

## Related Documentation

- [Cloudflare Tunnel Setup](17-cloudflare-tunnel-setup.md) - Required for remote access
- [Autonomous Agents](08-autonomous-agents.md) - Understanding what gets paused
- [Multi-User Profiles](19-multi-user-profiles.md) - Managing multiple users
- [Security & Trust](10-security-trust.md) - Owner-only permissions

---

## FAQ

**Q: Can I use headless mode without a tunnel?**
A: Technically yes, but it's pointless. Headless mode is designed for remote access via tunnel. Without a tunnel, you can't access the web UI remotely.

**Q: What happens if I close my laptop lid in headless mode?**
A: The laptop will sleep unless you configured OS-level sleep prevention (see above). The tunnel and web server will become unavailable.

**Q: Can two people use MetaHuman at the same time (one local, one remote)?**
A: No. Headless mode is specifically designed to prevent this conflict. Either local OR remote, not both.

**Q: How do I know if someone claimed my MetaHuman remotely?**
A: Check `etc/runtime.json` → `claimedBy` field. Also check audit logs:
```bash
grep "Headless mode.*remote" logs/audit/$(date +%Y-%m-%d).ndjson
```

**Q: Is headless mode secure?**
A: Yes. Only owner users can toggle headless mode or claim runtime. Guest users have read-only access. All changes are fully audited.

**Q: Can I schedule headless mode (e.g., enable at night)?**
A: Not built-in, but you can use cron:
```bash
# Enable headless at 11 PM
0 23 * * * echo '{"headless":true,"lastChangedBy":"local","changedAt":"'$(date -Iseconds)'","claimedBy":null}' > /home/greggles/metahuman/etc/runtime.json

# Disable at 7 AM
0 7 * * * echo '{"headless":false,"lastChangedBy":"local","changedAt":"'$(date -Iseconds)'","claimedBy":null}' > /home/greggles/metahuman/etc/runtime.json
```

---

## Summary

Headless Runtime Mode provides a robust solution for remote access scenarios:

✅ **Zero resource conflicts** - Local and remote never compete
✅ **Seamless transitions** - Automatic agent stop/resume
✅ **Full auditability** - Every mode change logged
✅ **Owner-controlled** - Secure by default
✅ **Built-in resilience** - Error recovery and retry logic

Perfect for mobile access, multi-location usage, and dedicated remote sessions!
