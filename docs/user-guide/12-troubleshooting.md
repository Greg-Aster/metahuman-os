## Troubleshooting

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

### Dataset has 0 pairs
Run `./bin/mh agent run organizer` to process memories first

### Auto-approver always rejects
Lower thresholds in `etc/auto-approval.json` or improve data quality

---

