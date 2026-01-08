#!/usr/bin/env tsx
/**
 * Process desire review directly
 */

import { executeDesireReview } from '@metahuman/core/api/handlers/agency';
import { setUserContext } from '@metahuman/core/context';

async function main() {
  const username = 'greggles';
  
  // Set user context
  setUserContext(username, username, 'owner');
  
  console.log('[desire-review] Processing desires awaiting review...');
  
  try {
    // Get desires awaiting review
    const { listDesiresFromFolders } = await import('@metahuman/core/agency/storage');
    const allDesires = await listDesiresFromFolders(username);
    const desiresNeedingReview = allDesires.filter(d => d.status === 'awaiting_review');
    
    console.log(`[desire-review] Found ${desiresNeedingReview.length} desire(s) awaiting review`);
    
    if (desiresNeedingReview.length === 0) {
      console.log('[desire-review] No desires need review');
      return;
    }
    
    // Execute desire review via task executor
    const { executeDesireReview } = await import('@metahuman/core/active-operator/task-executor');
    const result = await executeDesireReview(undefined, username);
    
    if (result.success) {
      console.log('[desire-review] Review complete:', result.data);
    } else {
      console.error('[desire-review] Review failed:', result.error);
    }
    
  } catch (error) {
    console.error('[desire-review] Error:', error);
  }
}

main().catch(console.error);