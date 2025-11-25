## Troubleshooting

### Slow Boot / UI Takes Long to Load

**Symptom:** Web interface takes 30+ seconds to become interactive after page load.

**Recent Fixes (v1.0):**
The following optimizations were implemented to dramatically improve boot performance:

1. **Fixed Duplicate Skill Registration**: Skills were being registered multiple times during boot
   - Solution: Made `initializeSkills()` idempotent
   - Impact: Eliminated 20+ duplicate audit entries, faster startup

2. **Optimized Chat History Loading**: API was scanning 30+ days of data on every request
   - Solution: Added server-side caching with file modification time invalidation
   - Solution: Reduced default scan from 30 days to 7 days
   - Impact: 60+ second load time reduced to <5 seconds

3. **Fresh Session Interface**: Historical data no longer loads automatically
   - Solution: Disabled automatic history loading on page load
   - Impact: Clean, fast interface startup

4. **Audit Stream Optimization**: Live stream was loading all historical events
   - Solution: Stream now starts from end of file (only shows new events)
   - Impact: Instant stream connection, no historical data bloat

**Performance Tips:**
- Use the **Clear button** to reset session and clear audit logs for maximum privacy
- Chat history is cached for 30 seconds - subsequent loads are instant
- If boot is still slow, check for stuck agents: `./bin/mh agent ps`

### Boredom Service Not Triggering Reflections

**Symptom:** Reflector agent never runs automatically.

**Solution:**
1. Check if boredom-service is running:
   ```bash
   ./bin/mh agent ps
   ```
2. Check for stale lock files:
   ```bash
   cat logs/run/locks/service-boredom.lock
   ps -p <PID_from_lock_file>
   ```
3. If PID is not running, remove the stale lock:
   ```bash
   rm logs/run/locks/service-boredom.lock
   ```
4. Restart the service:
   ```bash
   ./bin/mh agent run boredom-service
   ```

### Organizer Agent Not Processing Memories

**Symptom:** Memories don't have tags or entities.

**Causes:**
1. Ollama is not running
2. Model not installed
3. Memory already processed

**Solutions:**
1. Check Ollama status:
   ```bash
   ./bin/mh ollama status
   ```
2. Install phi3:mini if missing:
   ```bash
   ./bin/mh ollama pull phi3:mini
   ```
3. Run organizer manually:
   ```bash
   ./bin/mh agent run organizer
   ```

### Agent Shows "Another instance is already running"

**Cause:** Stale lock file from crashed process.

**Solution:**
1. Find the lock file in `logs/run/locks/`
2. Check if the PID is actually running:
   ```bash
   ps -p <PID>
   ```
3. If not running, remove the lock file:
   ```bash
   rm logs/run/locks/<agent-name>.lock
   ```

### Web UI Not Updating

**Cause:** Agent services not running in background.

**Solution:**
The dev server auto-starts `organizer` and `boredom-service`. If you stopped them manually:
1. Restart the dev server:
   ```bash
   cd apps/site && pnpm dev
   ```

### Semantic Search Not Working

**Cause:** Index not built or `nomic-embed-text` model not installed.

**Solutions:**
1. Install embeddings model:
   ```bash
   ./bin/mh ollama pull nomic-embed-text
   ```
2. Build index:
   ```bash
   ./bin/mh index build
   ```

### "Base path not allowed"
The skill can't access that directory. Check the skill's `allowedDirectories` in `brain/skills/[skill-name].ts`

### "Trust level insufficient"
You need a higher trust level. Edit `persona/decision-rules.json` to increase your `trustLevel`.

### "Skill not found"
Restart the dev server to reload skill manifests:
```bash
pkill -f "astro dev"
cd apps/site && pnpm dev
```

### Operator keeps retrying with same error
The planner isn't learning from the error. This is a known issue - try rephrasing your request or being more specific about the path/approach.

### Chat crashes on first request
Fixed in bug patch. Ensure latest code: `git pull`

### "Model not found" error
Run `ollama create <model>` or check `active-adapter.json` status field

### 403 Forbidden / "Write operations not allowed" Error

**Symptom:** You receive a "403 Forbidden" error when trying to create a task, capture a memory, or change a setting.

**Cause:** You are likely in **Emulation Mode**.

**Solution:**
Emulation Mode is a secure, **read-only** mode designed for safe demonstrations. It blocks all write operations. To create or modify data, you must switch to a different cognitive mode.

1.  **Check your current mode** in the Web UI header.
2.  **Switch to "Dual Consciousness" or "Agent Mode"** using the mode selector in the header.
3.  Try your action again.

You can switch modes via the API as well:
```bash
# Switch to Dual Consciousness mode to re-enable writes
curl -X POST http://localhost:4321/api/cognitive-mode \
  -H "Content-Type: application/json" \
  -d '{'''mode''': '''dual'''}'
```

### Dataset has 0 pairs
Run `./bin/mh agent run organizer` to process memories first

### Auto-approver always rejects
Lower thresholds in `etc/auto-approval.json` or improve data quality

### Persona Toggle Button Requires Server Restart

**Symptom:** When clicking the persona badge in the status widget to toggle persona context on/off, the button styling doesn't update to reflect the new state. The toggle only works reliably after restarting the dev server.

**Cause:** The `/api/status` endpoint has a 5-second server-side cache to improve performance. When toggling the persona setting, the cache-busting mechanism doesn't fully invalidate the cache across all cognitive modes.

**Workaround:**
1. **Option 1:** Restart the dev server after toggling persona mode:
   ```bash
   # Stop dev server (Ctrl+C)
   pnpm dev
   ```

2. **Option 2:** Wait 5 seconds after toggling for the cache to expire, then refresh the page

3. **Option 3:** Use the API directly to verify the setting:
   ```bash
   # Check current persona setting
   curl http://localhost:4321/api/persona-toggle

   # Toggle persona setting
   curl -X POST http://localhost:4321/api/persona-toggle \
     -H "Content-Type: application/json" \
     -d '{"enabled": true}'  # or false
   ```

**Note:** The setting IS successfully saved to `etc/models.json` even if the UI doesn't update immediately. This is purely a UI refresh issue, not a data persistence problem.

**Status:** Known issue - investigating cache invalidation improvements.

---

