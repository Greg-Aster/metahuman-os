/**
 * Memory Content Filter
 *
 * Shared module for filtering memory content based on contentMode.
 * Used by agents that reflect on memories (reflector, curiosity, inner-curiosity, etc.)
 *
 * Content modes:
 * - 'user': User inputs only (excludes AI responses, includes dreams)
 * - 'agent': Agent outputs only (AI responses, dreams, system outputs)
 * - 'all': Everything (both user and AI content)
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { storageClient } from './storage-client.js';

export type ContentMode = 'all' | 'user' | 'agent';

// Cached content mode setting (per-process)
let cachedContentMode: ContentMode | null = null;

/**
 * Load the content mode setting from agents.json
 * Priority: globalSettings.memoryContentMode > default 'user'
 */
export async function loadMemoryContentMode(): Promise<ContentMode> {
  if (cachedContentMode) return cachedContentMode;

  try {
    // Try user profile first, fall back to system config
    const profileResult = storageClient.resolvePath({ category: 'config' as any, subcategory: 'agents' });
    let agentsPath = profileResult.success && profileResult.path
      ? profileResult.path
      : path.join(ROOT, 'etc', 'agents.json');

    // Ensure we have the full path
    if (!agentsPath.endsWith('.json')) {
      agentsPath = path.join(agentsPath, 'agents.json');
    }

    const raw = fs.readFileSync(agentsPath, 'utf-8');
    const config = JSON.parse(raw);

    // Check global setting first
    const mode = config.globalSettings?.memoryContentMode || 'user';

    if (['all', 'user', 'agent'].includes(mode)) {
      cachedContentMode = mode as ContentMode;
      return cachedContentMode;
    }
  } catch (err) {
    console.warn('[memory-content-filter] Could not load contentMode from config, using default:', err);
  }

  cachedContentMode = 'user';
  return cachedContentMode;
}

/**
 * Clear cached content mode (call when config changes)
 */
export function clearMemoryContentModeCache(): void {
  cachedContentMode = null;
}

/**
 * Synchronous version - returns cached value or default
 */
export function getMemoryContentModeSync(): ContentMode {
  return cachedContentMode || 'user';
}

/**
 * Extract content from a memory based on the content mode setting.
 *
 * Content modes:
 * - 'user': User inputs only (excludes AI responses, includes dreams)
 * - 'agent': Agent outputs only (AI responses, dreams, system outputs)
 * - 'all': Everything (both user and AI content)
 */
export function extractMemoryContent(memory: any, mode: ContentMode): string | null {
  const type = memory.type || memory.metadata?.type;
  const content = memory.content || '';
  const response = memory.response || '';

  // Handle based on content mode
  switch (mode) {
    case 'all':
      // Return everything - skip only pure system/operator actions
      if (type === 'operator') return null;
      return content;

    case 'agent':
      // Agent-only: return AI responses, dreams, system outputs
      if (type === 'dream' || type === 'daydream' || type === 'inner_dialogue') {
        return content;
      }
      if (type === 'conversation') {
        // Extract only the AI response
        if (response) return response;
        if (content.includes('\n\nAssistant:')) {
          const parts = content.split('\n\nAssistant:');
          return parts[1]?.trim() || null;
        }
        return null; // No AI response found
      }
      if (type === 'action' || type === 'system') {
        return content;
      }
      return null; // Skip user-only content

    case 'user':
    default:
      // User-only: skip system/action types AND LLM-generated content
      if (type === 'action' || type === 'system' || type === 'operator' ||
          type === 'inner_dialogue' || type === 'reflection') {
        return null;
      }

      // Dreams are creative AI output worth reflecting on (exception)
      if (type === 'dream' || type === 'daydream') {
        return content;
      }

      // For conversations, extract only the user portion
      if (type === 'conversation') {
        // Try to detect and strip AI response - check all patterns
        // Patterns are flexible to handle various newline formats (\n, \r\n, multiple spaces)
        const assistantPatterns = [
          /\n\s*\n\s*Assistant:/i,         // Double newline with optional whitespace
          /\n\s*\n\s*A:/,                   // Short form "A:" after double newline
          /\n\s*A:\s/,                      // Single newline before "A: " (note space after colon)
          /\n\s*\n\s*(AI|Greg|MetaHuman):/i,
          /\n\s*\n\s*---\s*\n/,
          /\r\n\s*\r\n\s*A:/,               // Windows newlines
        ];

        for (const pattern of assistantPatterns) {
          if (pattern.test(content)) {
            const userPart = content.split(pattern)[0];
            return userPart.replace(/^(Me|User):\s*/i, '').replace(/^"/, '').replace(/"$/, '').trim();
          }
        }

        // Format 2: "Me: \"<message>\"" with separate response field
        if (content.startsWith('Me:') || content.startsWith('User:')) {
          return content
            .replace(/^(Me|User):\s*/i, '')
            .replace(/^"/, '')
            .replace(/"$/, '')
            .trim();
        }

        // If there's a separate response field, content is likely just user input
        if (response) {
          return content.replace(/^(Me|User):\s*/i, '').replace(/^"/, '').replace(/"$/, '').trim();
        }

        return content;
      }

      // Observations are user-captured, pass through
      if (type === 'observation') {
        return content;
      }

      // Default: return content for unknown types
      return content;
  }
}

/**
 * Check if a memory should be included based on content mode
 */
export function shouldIncludeMemory(memory: any, mode: ContentMode): boolean {
  const type = memory.type || memory.metadata?.type;

  // Always skip reflections and inner_dialogue in non-agent modes
  if (mode !== 'agent') {
    if (type === 'reflection' || type === 'inner_dialogue') {
      return false;
    }
  }

  // Check if we can extract content
  return extractMemoryContent(memory, mode) !== null;
}
