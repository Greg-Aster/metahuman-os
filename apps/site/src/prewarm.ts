/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 *
 * Also handles auto-starting the local embedding service when configured.
 * Chat backend startup belongs to ./start.sh -> bin/start-services so it begins
 * before the web server and has one owner for both Ollama and vLLM.
 */

import path from 'node:path';

// Force import of node executors (heaviest module)
import('@metahuman/core/nodes').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});

import('@metahuman/core').then(async ({
  autoStartLocalModelService,
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

}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to load model service managers:', err);
});
