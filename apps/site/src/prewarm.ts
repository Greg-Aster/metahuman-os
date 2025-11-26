/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 */

// Force import of node executors (heaviest module)
import('../../../packages/core/src/node-executors/index.js').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});

// Force import of skills
import('../../../brain/skills/index.js').then(({ initializeSkills }) => {
  initializeSkills();
  console.log('[prewarm] ✅ Skills registry loaded successfully');
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm skills:', err);
});
