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

import { getTriggerConfigService } from './queue/trigger-config-service.js';

export type ContentMode = 'all' | 'user' | 'agent';

let cachedMode: { revision: number; mode: ContentMode } | null = null;

function readConfiguredContentMode(): ContentMode {
  const loaded = getTriggerConfigService().load(false);
  if (cachedMode?.revision === loaded.revision) return cachedMode.mode;
  const mode = loaded.config.globalSettings.memoryContentMode;
  if (mode !== 'all' && mode !== 'user' && mode !== 'agent') {
    throw new Error('globalSettings.memoryContentMode must be all, user, or agent');
  }
  cachedMode = { revision: loaded.revision, mode };
  return mode;
}

/**
 * Load the content mode from the canonical Trigger Manager configuration.
 */
export async function loadMemoryContentMode(): Promise<ContentMode> {
  return readConfiguredContentMode();
}

/** Clear the revision-aware content-mode cache after configuration changes. */
export function clearMemoryContentModeCache(): void {
  cachedMode = null;
}

/** Synchronous access for existing Core consumers. */
export function getMemoryContentModeSync(): ContentMode {
  return readConfiguredContentMode();
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
  const conversationRole = type === 'conversation'
    && (memory.metadata?.role === 'user' || memory.metadata?.role === 'assistant')
    ? memory.metadata.role
    : null;

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
        if (conversationRole === 'assistant') return content;
        if (conversationRole === 'user') return null;
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
        if (conversationRole === 'user') return content;
        if (conversationRole === 'assistant') return null;
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
