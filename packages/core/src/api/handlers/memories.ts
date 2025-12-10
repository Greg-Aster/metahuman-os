/**
 * Memory Handlers
 *
 * Unified handlers for memory capture and retrieval.
 * Uses withUserContext + existing core functions.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, unauthorizedResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { captureEvent, searchMemory } from '../../memory.js';
import { getProfilePaths } from '../../paths.js';
import { loadCognitiveMode } from '../../cognitive-mode.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/capture - Capture a new memory
 */
export async function handleCapture(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { content, type = 'observation', tags = [], entities = [] } = req.body || {};

  if (!content || typeof content !== 'string') {
    return badRequestResponse('Content is required');
  }

  // Determine source from request metadata or environment
  const source = req.metadata?.source || (process.env.METAHUMAN_MOBILE ? 'mobile' : 'web');

  const eventId = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      // Get cognitive mode within user context
      const modeConfig = loadCognitiveMode();
      const cognitiveMode = modeConfig.currentMode;

      return captureEvent(content, {
        type: type as any,
        tags,
        entities,
        metadata: { source, cognitiveMode },
      });
    }
  );

  return successResponse({ success: true, eventId });
}

/**
 * GET /api/memories - List recent memories
 * Query params:
 *   - limit: Max memories to return (default 50)
 *   - idsOnly: If true, return only memory IDs (fast, for deduplication)
 */
export async function handleListMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  const limit = parseInt(req.query?.limit || '50', 10);
  const idsOnly = req.query?.idsOnly === 'true';

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    async () => {
      const profilePaths = getProfilePaths(req.user.username);
      const episodicDir = profilePaths.episodic;

      if (!fs.existsSync(episodicDir)) {
        return idsOnly ? { ids: [] } : { memories: [] };
      }

      // Get all year directories
      const years = fs.readdirSync(episodicDir)
        .filter(f => /^\d{4}$/.test(f))
        .sort((a, b) => parseInt(b) - parseInt(a));

      // idsOnly mode: Just collect filenames (fast, no file reads)
      if (idsOnly) {
        const allIds: string[] = [];
        for (const year of years) {
          const yearDir = path.join(episodicDir, year);
          const files = fs.readdirSync(yearDir)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));  // Extract ID from filename
          allIds.push(...files);
        }
        return { ids: allIds };
      }

      // Normal mode: Load full memory content
      const allMemories: any[] = [];

      for (const year of years) {
        if (allMemories.length >= limit) break;

        const yearDir = path.join(episodicDir, year);
        const files = fs.readdirSync(yearDir)
          .filter(f => f.endsWith('.json'))
          .sort((a, b) => b.localeCompare(a));

        for (const file of files) {
          if (allMemories.length >= limit) break;

          try {
            const content = fs.readFileSync(path.join(yearDir, file), 'utf-8');
            const event = JSON.parse(content);
            allMemories.push({
              ...event,
              _file: file,
            });
          } catch {
            // Skip invalid files
          }
        }
      }

      return { memories: allMemories };
    }
  );

  if (idsOnly && 'ids' in result) {
    return successResponse({
      success: true,
      ids: result.ids,
      count: result.ids.length,
    });
  }

  const memories = ('memories' in result ? result.memories : []) || [];
  return successResponse({
    success: true,
    memories,
    count: memories.length,
  });
}

/**
 * GET /api/memories/search - Search memories by keyword
 */
export async function handleSearchMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  const query = req.query?.q || req.body?.query;

  if (!query) {
    return badRequestResponse('Query parameter "q" is required');
  }

  const results = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => searchMemory(query)
  );

  return successResponse({
    success: true,
    results,
    count: results.length,
    query,
  });
}
