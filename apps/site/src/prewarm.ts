/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 */

// Force import of node executors (heaviest module)
import('@metahuman/core/node-executors').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});

// DISABLED: Skills system not in use - removed to save resources
// import('@brain/skills/index.js').then(({ initializeSkills }) => {
//   initializeSkills();
//   console.log('[prewarm] ✅ Skills registry loaded successfully');
// }).catch(err => {
//   console.error('[prewarm] ⚠️ Failed to pre-warm skills:', err);
// });
