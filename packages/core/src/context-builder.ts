/**
 * Context Builder - Subconscious Layer (Layer 1)
 *
 * Extracts memory retrieval and context preparation into a reusable module.
 * This is the foundation for the three-layer cognitive architecture.
 *
 * Current implementation: Refactor of existing getRelevantContext() logic
 * Future enhancements: Pattern recognition, smarter fallbacks, mode-specific depth
 */

import { queryIndex, getIndexStatus } from './vector-index.js';
import { loadPersonaCore } from './identity.js';
import { loadShortTermState, loadPersonaCache } from './state.js';
import { audit } from './audit.js';
import { readFileSync } from 'fs';
import type { CognitiveModeId } from './cognitive-mode.js';

// ============================================================================
// Context Package Cache (5min TTL)
// ============================================================================

interface CacheEntry {
  package: ContextPackage;
  timestamp: number;
}

const contextCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(userMessage: string, mode: CognitiveModeId, options: ContextBuilderOptions): string {
  // Create cache key from message + mode + critical options
  const optionsKey = JSON.stringify({
    searchDepth: options.searchDepth,
    maxMemories: options.maxMemories,
    filterInnerDialogue: options.filterInnerDialogue,
    filterReflections: options.filterReflections,
    usingLoRA: options.usingLoRA
  });
  return `${mode}:${userMessage.substring(0, 100)}:${optionsKey}`;
}

function getCachedContext(key: string): ContextPackage | null {
  const entry = contextCache.get(key);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL) {
    contextCache.delete(key);
    return null;
  }

  return entry.package;
}

function setCachedContext(key: string, pkg: ContextPackage): void {
  contextCache.set(key, {
    package: pkg,
    timestamp: Date.now()
  });

  // Cleanup old entries (simple approach)
  if (contextCache.size > 100) {
    const cutoff = Date.now() - CACHE_TTL;
    for (const [k, v] of contextCache.entries()) {
      if (v.timestamp < cutoff) {
        contextCache.delete(k);
      }
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Analyze memories to detect recurring patterns
 */
function analyzeMemoryPatterns(memories: RelevantMemory[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Extract entities (people, projects) from memory tags
  const entityCounts = new Map<string, number>();
  const entityLastSeen = new Map<string, string>();

  for (const mem of memories) {
    if (!mem.tags || mem.tags.length === 0) continue;

    for (const tag of mem.tags) {
      // Skip common generic tags
      if (['processed', 'memory', 'event'].includes(tag)) continue;

      // Count entity frequency
      entityCounts.set(tag, (entityCounts.get(tag) || 0) + 1);

      // Track last seen
      if (!entityLastSeen.has(tag) || mem.timestamp > entityLastSeen.get(tag)!) {
        entityLastSeen.set(tag, mem.timestamp);
      }
    }
  }

  // Convert to patterns (only entities mentioned 2+ times)
  for (const [entity, count] of entityCounts.entries()) {
    if (count >= 2) {
      patterns.push({
        type: 'entity',
        pattern: entity,
        frequency: count,
        lastSeen: entityLastSeen.get(entity) || new Date().toISOString()
      });
    }
  }

  // Sort by frequency descending
  patterns.sort((a, b) => b.frequency - a.frequency);

  // Limit to top 5
  return patterns.slice(0, 5);
}

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface RelevantMemory {
  id: string;
  content: string;
  timestamp: string;
  score: number;
  type?: string;
  tags?: string[];
}

export interface PersonaSummary {
  name: string;
  role: string;
  coreValues: string[];
  recentThemes: string[];
  frequentFacts: Record<string, string>;
}

export interface DetectedPattern {
  type: 'theme' | 'person' | 'project' | 'behavior';
  pattern: string;
  frequency: number;
  lastSeen: string;
}

export interface ContextPackage {
  // Memory grounding
  memories: RelevantMemory[];
  memoryCount: number;
  fallbackUsed: boolean;

  // Persona context
  persona: PersonaSummary;

  // Short-term state (orchestrator working memory)
  currentFocus?: string;
  activeTasks: string[];
  recentTopics: string[];

  // Patterns (future: from digest agent)
  patterns: DetectedPattern[];

  // Metadata
  mode: CognitiveModeId;
  retrievalTime: number;
  timestamp: string;
  indexStatus: 'available' | 'missing' | 'error';
}

export interface ContextBuilderOptions {
  // Search depth
  searchDepth?: 'shallow' | 'normal' | 'deep'; // 4, 8, 16 results
  similarityThreshold?: number; // Default: 0.62

  // Memory filtering
  maxMemories?: number; // Limit total memories returned (default: 2 for parity with old code)
  maxContextChars?: number; // Character limit for memory context (default: 900)
  filterInnerDialogue?: boolean; // Exclude inner_dialogue memories (default: true)
  filterReflections?: boolean; // Exclude reflections/dreams (default: true)

  // State integration
  includeShortTermState?: boolean; // Default: true
  includePersonaCache?: boolean; // Default: true
  includeTaskContext?: boolean; // Include active tasks (default: only if user mentions them)

  // Pattern recognition (future)
  detectPatterns?: boolean; // Default: false (not implemented yet)

  // Mode-specific overrides
  forceSemanticSearch?: boolean; // Dual mode: always try semantic search
  usingLoRA?: boolean; // Skip persona context when using LoRA (default: false)
}

// ============================================================================
// Main Context Builder Function
// ============================================================================

/**
 * Build a context package for a user message
 *
 * This is the "subconscious layer" - it prepares relevant context before
 * the personality core generates a response.
 *
 * Current: Refactored from persona_chat.ts getRelevantContext()
 * Future: Enhanced with pattern recognition, smarter fallbacks
 */
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions = {}
): Promise<ContextPackage> {
  const startTime = Date.now();

  // Check cache first
  const cacheKey = getCacheKey(userMessage, mode, options);
  const cached = getCachedContext(cacheKey);
  if (cached) {
    audit({
      level: 'info',
      category: 'action',
      event: 'context_package_cache_hit',
      details: {
        mode,
        cacheKey: cacheKey.substring(0, 50),
        age: Date.now() - new Date(cached.timestamp).getTime()
      },
      actor: 'context_builder'
    });
    return cached;
  }

  // Default options
  const {
    searchDepth = 'normal',
    similarityThreshold = 0.62,
    maxMemories = 2,
    maxContextChars = 900,
    filterInnerDialogue = true,
    filterReflections = true,
    includeShortTermState = true,
    includePersonaCache = true,
    includeTaskContext = false,
    detectPatterns = false,
    forceSemanticSearch = mode === 'dual',
    usingLoRA = false
  } = options;

  // Determine topK based on search depth
  const topK = searchDepth === 'shallow' ? 4 : searchDepth === 'deep' ? 16 : 8;

  let memories: RelevantMemory[] = [];
  let fallbackUsed = false;
  let indexStatus: 'available' | 'missing' | 'error' = 'available';

  // ========================================================================
  // Step 1: Memory Retrieval (Semantic Search or Fallback)
  // ========================================================================

  try {
    const idx = await getIndexStatus();

    if (idx.exists) {
      // Semantic search available
      const hits = await queryIndex(userMessage, { topK });

      // Filter by similarity threshold
      let filtered = hits.filter((hit: any) => hit.score >= similarityThreshold);

      // Apply content-based filters (matching persona_chat.ts behavior)
      if (filterInnerDialogue || filterReflections) {
        filtered = filtered.filter((hit: any) => {
          try {
            // Load memory file to check type and tags
            const raw = readFileSync(hit.item.path, 'utf-8');
            const obj = JSON.parse(raw);
            const type = obj?.type ? String(obj.type) : '';
            const tags: string[] = Array.isArray(obj?.tags) ? obj.tags.map((x: any) => String(x)) : [];

            // Filter inner dialogue
            if (filterInnerDialogue && type === 'inner_dialogue') {
              return false;
            }

            // Filter reflections and dreams
            if (filterReflections && (tags.includes('reflection') || tags.includes('dream'))) {
              return false;
            }

            return true;
          } catch {
            // If file can't be read, include it anyway
            return true;
          }
        });
      }

      // Limit to maxMemories (default: 2 for parity with old code)
      // Note: persona_chat.ts selects 2 "novel" memories (not recently used)
      // For now, we just take the top N by score
      filtered = filtered.slice(0, maxMemories);

      // Map to RelevantMemory interface
      memories = filtered.map((hit: any) => ({
        id: hit.id || hit.item?.id,
        content: hit.content || hit.item?.content,
        timestamp: hit.timestamp || hit.item?.timestamp,
        score: hit.score,
        type: hit.type || hit.item?.type,
        tags: hit.tags || hit.item?.tags || []
      }));

      indexStatus = 'available';
    } else {
      // Fallback: No semantic index
      indexStatus = 'missing';
      fallbackUsed = true;

      // Future: Load recent memories from filesystem
      // For now: empty array, persona summary will provide context
      memories = [];
    }
  } catch (error) {
    console.error('[context-builder] Error retrieving memories:', error);
    indexStatus = 'error';
    fallbackUsed = true;
    memories = [];
  }

  // ========================================================================
  // Step 2 & 3: Parallel Loading (Persona + State)
  // ========================================================================

  // Load persona and state in parallel for better performance
  const [personaResult, stateResult] = await Promise.allSettled([
    // Load persona
    Promise.resolve().then(() => {
      const personaCore = loadPersonaCore();
      const personaCache = includePersonaCache ? loadPersonaCache() : null;
      return {
        name: personaCore.identity?.name || 'Assistant',
        role: personaCore.identity?.role || 'AI Assistant',
        coreValues: personaCore.values || [],
        recentThemes: personaCache?.recentThemes?.slice(0, 5).map(t => t.theme) || [],
        frequentFacts: personaCache?.frequentFacts || {}
      };
    }),
    // Load state
    includeShortTermState ? Promise.resolve().then(() => loadShortTermState()) : Promise.resolve(null)
  ]);

  // Extract persona result
  const persona: PersonaSummary = personaResult.status === 'fulfilled'
    ? personaResult.value
    : {
        name: 'Assistant',
        role: 'AI Assistant',
        coreValues: [],
        recentThemes: [],
        frequentFacts: {}
      };

  if (personaResult.status === 'rejected') {
    console.error('[context-builder] Error loading persona:', personaResult.reason);
  }

  // Extract state result
  let currentFocus: string | undefined;
  let activeTasks: string[] = [];
  let recentTopics: string[] = [];

  if (stateResult.status === 'fulfilled' && stateResult.value) {
    const state = stateResult.value;
    currentFocus = state.currentFocus;
    activeTasks = state.activeTasks || [];
    recentTopics = state.conversationContext?.lastTopics || [];
  } else if (stateResult.status === 'rejected') {
    console.error('[context-builder] Error loading short-term state:', stateResult.reason);
  }

  // ========================================================================
  // Step 4: Pattern Recognition
  // ========================================================================

  let patterns: DetectedPattern[] = [];

  if (detectPatterns) {
    try {
      // Extract patterns from persona cache (pre-computed themes)
      const personaCache = loadPersonaCache();
      if (personaCache?.recentThemes) {
        patterns = personaCache.recentThemes.slice(0, 5).map((theme: any) => ({
          type: 'theme' as const,
          pattern: theme.theme || theme,
          frequency: theme.frequency || 1,
          lastSeen: theme.lastSeen || new Date().toISOString()
        }));
      }

      // Analyze retrieved memories for additional patterns
      if (memories.length > 0) {
        const memoryPatterns = analyzeMemoryPatterns(memories);
        patterns = [...patterns, ...memoryPatterns];

        // Deduplicate by pattern text
        const seen = new Set<string>();
        patterns = patterns.filter(p => {
          if (seen.has(p.pattern)) return false;
          seen.add(p.pattern);
          return true;
        });
      }
    } catch (error) {
      // Pattern detection is optional, don't fail on error
      console.error('[context-builder] Pattern recognition error:', error);
    }
  }

  // ========================================================================
  // Step 5: Build Context Package
  // ========================================================================

  const retrievalTime = Date.now() - startTime;

  const contextPackage: ContextPackage = {
    memories,
    memoryCount: memories.length,
    fallbackUsed,
    persona,
    currentFocus,
    activeTasks,
    recentTopics,
    patterns,
    mode,
    retrievalTime,
    timestamp: new Date().toISOString(),
    indexStatus
  };

  // ========================================================================
  // Step 6: Audit Logging
  // ========================================================================

  audit({
    level: 'info',
    category: 'action',
    event: 'context_package_built',
    details: {
      mode,
      memoriesFound: memories.length,
      retrievalTime,
      indexStatus,
      fallbackUsed,
      searchDepth,
      activeTasks: activeTasks.length,
      patternsDetected: patterns.length
    },
    actor: 'context_builder'
  });

  // Cache the result
  setCachedContext(cacheKey, contextPackage);

  return contextPackage;
}

// ============================================================================
// Helper: Format Context for Prompts
// ============================================================================

/**
 * Format a context package into a string for LLM prompts
 *
 * Usage in persona_chat.ts:
 *   const context = await buildContextPackage(message, mode);
 *   const contextString = formatContextForPrompt(context, { maxChars: 900 });
 *   // Add contextString to system prompt
 */
export function formatContextForPrompt(
  context: ContextPackage,
  options: { maxChars?: number; includePersona?: boolean } = {}
): string {
  const { maxChars = 900, includePersona = true } = options;
  const sections: string[] = [];

  // Persona identity (skip if using LoRA)
  if (includePersona) {
    sections.push(`You are ${context.persona.name}, ${context.persona.role}.`);

    if (context.persona.coreValues.length > 0) {
      sections.push(`Core values: ${context.persona.coreValues.join(', ')}.`);
    }

    // Recent themes
    if (context.persona.recentThemes.length > 0) {
      sections.push(`Recent themes: ${context.persona.recentThemes.join(', ')}.`);
    }
  }

  // Current focus (orchestrator state)
  if (context.currentFocus) {
    sections.push(`Current focus: ${context.currentFocus}`);
  }

  // Active tasks
  if (context.activeTasks.length > 0) {
    sections.push(`Active tasks: ${context.activeTasks.length} tasks in progress.`);
  }

  // Recent conversation topics
  if (context.recentTopics.length > 0) {
    sections.push(`Recent topics: ${context.recentTopics.join(', ')}.`);
  }

  // Relevant memories (with character limit matching persona_chat.ts)
  if (context.memories.length > 0) {
    sections.push(`\n## Relevant Context (${context.memories.length} memories):`);

    let used = 0;
    for (let idx = 0; idx < context.memories.length; idx++) {
      const mem = context.memories[idx];
      const chunk = `${idx + 1}. ${mem.content}`;

      // Respect character limit (matching persona_chat.ts behavior)
      if (used + chunk.length > maxChars) {
        break;
      }

      sections.push(chunk);
      used += chunk.length;
    }
  } else if (context.fallbackUsed) {
    sections.push('\n(No semantic index available - relying on persona knowledge)');
  }

  return sections.join('\n');
}

// ============================================================================
// Helper: Validate Context Package
// ============================================================================

/**
 * Check if a context package has sufficient information for a good response
 *
 * Used to determine if we should warn about missing context or
 * trigger fallback behavior.
 */
export function validateContextPackage(context: ContextPackage): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check 1: No memories and no semantic index
  if (context.memoryCount === 0 && context.indexStatus === 'missing') {
    warnings.push('No semantic index available - context quality may be limited');
  }

  // Check 2: Dual mode requires semantic search
  if (context.mode === 'dual' && context.indexStatus !== 'available') {
    warnings.push('Dual mode requires semantic search for memory grounding');
  }

  // Check 3: Very slow retrieval
  if (context.retrievalTime > 3000) {
    warnings.push(`Context retrieval took ${context.retrievalTime}ms (target: <2000ms)`);
  }

  // Check 4: No persona information
  if (!context.persona.name || context.persona.name === 'Assistant') {
    warnings.push('Persona core not loaded - using defaults');
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}
