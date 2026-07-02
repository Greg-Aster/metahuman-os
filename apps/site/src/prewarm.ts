/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 *
 * Also handles auto-starting system services that should run on server boot:
 * - Local model service (for embeddings) if configured with autoStart: true
 * - Active LLM backend if configured with autoStart: true
 */

import path from 'node:path';
import fs from 'node:fs';

// Force import of node executors (heaviest module)
import('@metahuman/core/nodes').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});

// Auto-start configured model services.
// This is system infrastructure, not user-specific
function isLivePidFile(filePath: string): boolean {
  try {
    const pid = Number.parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFreshMarker(filePath: string, maxAgeMs: number): boolean {
  try {
    const stat = fs.statSync(filePath);
    return Date.now() - stat.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

import('@metahuman/core').then(async ({
  autoStartLocalModelService,
  ensureBackendRunning,
  loadBackendConfig,
  systemPaths
}) => {
  try {
    // Use the models directory in the repo
    const modelsDir = path.join(systemPaths.root, 'models');
    const started = await autoStartLocalModelService(modelsDir);
    if (started) {
      console.log('[prewarm] ✅ Local model service auto-started');
    }
  } catch (err) {
    // Non-fatal - embeddings will use fallback or show error
    console.warn('[prewarm] ⚠️ Local model service auto-start failed:', err);
  }

  try {
    const config = loadBackendConfig();
    const runDir = path.join(systemPaths.root, 'logs', 'run');
    const vllmLauncherStarting = config.activeBackend === 'vllm'
      && config.vllm?.autoStart
      && (
        isLivePidFile(path.join(runDir, 'vllm.pid'))
        || isFreshMarker(path.join(runDir, 'vllm.starting'), 5 * 60 * 1000)
      );

    if (vllmLauncherStarting) {
      console.log('[prewarm] ⏳ vLLM startup already in progress from launcher');
      return;
    }

    const status = await ensureBackendRunning();
    if (status.running) {
      console.log('[prewarm] ✅ Active LLM backend is running');
    } else if (status.error) {
      console.warn('[prewarm] ⚠️ Active LLM backend is not running:', status.error);
    }
  } catch (err) {
    // Non-fatal - the UI will show backend status and controls.
    console.warn('[prewarm] ⚠️ Active LLM backend auto-start failed:', err);
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to load model service managers:', err);
});
