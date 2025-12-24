/**
 * Pre-warm expensive modules during dev server startup
 * This ensures the first user request doesn't trigger 50+ second module loading
 *
 * NOTE: Config-based auto-start removed (2025-12-23)
 * All configs are user-specific and only loaded within authenticated user context.
 * Auto-start features are triggered by user requests, not server startup.
 */

// Force import of node executors (heaviest module)
import('@metahuman/core/nodes').then(({ getNodeExecutor }) => {
  if (getNodeExecutor('user_input')) {
    console.log('[prewarm] ✅ Node executors loaded successfully');
  }
}).catch(err => {
  console.error('[prewarm] ⚠️ Failed to pre-warm executors:', err);
});
