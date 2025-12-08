/**
 * Mobile Memory Handlers
 *
 * Uses withUserContext + existing core functions - NO DUPLICATION
 */

import { withUserContext } from '../context.js';
import { captureEvent, searchMemory, listEpisodicFiles } from '../memory.js';
import { getProfilePaths } from '../paths.js';
import fs from 'node:fs';
import path from 'node:path';
import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';

/**
 * POST /api/capture - Capture a new memory
 */
export async function handleCapture(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const { content, type = 'observation', tags = [], entities = [] } = request.body || {};

  if (!content || typeof content !== 'string') {
    return errorResponse(request.id, 400, 'Content is required');
  }

  try {
    // Use withUserContext to set up context, then call core function
    const eventId = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => {
        return captureEvent(content, {
          type: type as any,
          tags,
          entities,
          metadata: { source: 'mobile' },
        });
      }
    );

    return successResponse(request.id, {
      success: true,
      eventId,
    });
  } catch (error) {
    console.error('[mobile-handlers] Capture failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * GET /api/memories - List recent memories
 */
export async function handleListMemories(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  try {
    const memories = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      async () => {
        const profilePaths = getProfilePaths(user.username);
        const episodicDir = profilePaths.episodic;

        if (!fs.existsSync(episodicDir)) {
          return [];
        }

        const allMemories: any[] = [];
        const limit = 50;

        // Get all year directories, sorted descending
        const years = fs.readdirSync(episodicDir)
          .filter(f => /^\d{4}$/.test(f))
          .sort((a, b) => parseInt(b) - parseInt(a));

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

        return allMemories;
      }
    );

    return successResponse(request.id, {
      success: true,
      memories,
      count: memories.length,
    });
  } catch (error) {
    console.error('[mobile-handlers] List memories failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * GET /api/memories/search - Search memories by keyword
 */
export async function handleSearchMemories(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  // Parse query from path params or body
  const url = new URL(request.path, 'http://localhost');
  const query = url.searchParams.get('q') || request.body?.query;

  if (!query) {
    return errorResponse(request.id, 400, 'Query parameter "q" is required');
  }

  try {
    // Use core searchMemory function with context
    const results = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => {
        return searchMemory(query);
      }
    );

    return successResponse(request.id, {
      success: true,
      results,
      count: results.length,
      query,
    });
  } catch (error) {
    console.error('[mobile-handlers] Search memories failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}
