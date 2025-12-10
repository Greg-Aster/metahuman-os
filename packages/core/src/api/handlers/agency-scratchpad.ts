/**
 * Agency Scratchpad API Handlers
 *
 * GET scratchpad entries for desires.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

// Dynamic imports for agency functions
let listScratchpadEntries: any;
let loadScratchpadEntry: any;
let loadScratchpadEntriesPaginated: any;
let loadDesire: any;

async function ensureAgencyFunctions(): Promise<boolean> {
  try {
    const core = await import('../../index.js');
    listScratchpadEntries = core.listScratchpadEntries;
    loadScratchpadEntry = core.loadScratchpadEntry;
    loadScratchpadEntriesPaginated = core.loadScratchpadEntriesPaginated;
    loadDesire = core.loadDesire;
    return !!(listScratchpadEntries && loadDesire);
  } catch {
    return false;
  }
}

/**
 * GET /api/agency/scratchpad - Get scratchpad entries for a desire
 */
export async function handleGetAgencyScratchpad(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required to view scratchpad' };
  }

  try {
    const available = await ensureAgencyFunctions();
    if (!available) {
      return { status: 501, error: 'Agency scratchpad not available' };
    }

    const desireId = query?.desireId;
    const filename = query?.filename;
    const offset = parseInt(query?.offset || '0', 10);
    const limit = parseInt(query?.limit || '20', 10);

    if (!desireId) {
      return { status: 400, error: 'Missing required parameter: desireId' };
    }

    // Verify desire exists
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return { status: 404, error: 'Desire not found' };
    }

    // If filename is specified, return single entry
    if (filename) {
      const entry = await loadScratchpadEntry(desireId, filename, user.username);
      if (!entry) {
        return { status: 404, error: 'Scratchpad entry not found' };
      }
      return successResponse({ entry });
    }

    // Otherwise return paginated list
    const result = await loadScratchpadEntriesPaginated(desireId, offset, limit, user.username);

    // Also get the list of filenames for navigation
    const files = await listScratchpadEntries(desireId, user.username);

    return successResponse({
      entries: result.entries,
      total: result.total,
      files,
      offset,
      limit,
      desireId,
      desireTitle: desire.title,
    });
  } catch (error) {
    console.error('[agency/scratchpad] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
