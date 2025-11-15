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
import { listActiveTasks } from './memory.js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import type { CognitiveModeId } from './cognitive-mode.js';
import { getUserContext } from './context.js';
import {
  getToolHistoryLimit,
  redactSensitiveData,
  filterToolOutputs,
  canViewMemoryType,
  getMaxMemoriesForRole
} from './memory-policy.js';
import { readRecentToolsFromCache } from './recent-tools-cache.js';
import { isSummarizing } from './summary-state.js';

// ============================================================================
// Context Package Cache (5min TTL)
// ============================================================================

interface CacheEntry {
  package: ContextPackage;
  timestamp: number;
}

const contextCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const conversationSummaryCache = new Map<string, { value: string | null; timestamp: number }>();
const SUMMARY_CACHE_TTL = 5 * 60 * 1000;

const functionAvailabilityCache = new Map<string, { available: boolean; timestamp: number }>();
const FUNCTION_CACHE_TTL = 5 * 60 * 1000;

const toolScanCooldown = new Map<string, { timestamp: number; hadResults: boolean }>();
const TOOL_SCAN_COOLDOWN_MS = 2 * 60 * 1000;

const CONTEXT_TIMING_FLAG = process.env.MH_CONTEXT_TIMING === '1';
const CONTEXT_SLOW_THRESHOLD = Number(process.env.MH_CONTEXT_TIMING_THRESHOLD || 5000);

// ============================================================================
// Warm Cache for Frequently Accessed Data (30sec TTL)
// ============================================================================

interface WarmCacheData {
  tasks: any[];
  timestamp: number;
}

const warmCache = new Map<string, WarmCacheData>();
const WARM_CACHE_TTL = 30 * 1000; // 30 seconds (shorter TTL for more up-to-date data)

function getWarmCachedTasks(userKey: string): any[] | null {
  const entry = warmCache.get(`tasks:${userKey}`);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  if (age > WARM_CACHE_TTL) {
    warmCache.delete(`tasks:${userKey}`);
    return null;
  }

  return entry.tasks;
}

function setWarmCachedTasks(userKey: string, tasks: any[]): void {
  warmCache.set(`tasks:${userKey}`, {
    tasks,
    timestamp: Date.now()
  });
}

function getSummaryCacheKey(conversationId: string, username?: string): string {
  return `${username || 'anonymous'}:${conversationId}`;
}

function getCachedConversationSummary(conversationId?: string): string | null | undefined {
  if (!conversationId) return undefined;
  const ctx = getUserContext();
  const cacheKey = getSummaryCacheKey(conversationId, ctx?.username);
  const cached = conversationSummaryCache.get(cacheKey);
  if (!cached) return undefined;
  if (Date.now() - cached.timestamp > SUMMARY_CACHE_TTL) {
    conversationSummaryCache.delete(cacheKey);
    return undefined;
  }
  return cached.value;
}

function setCachedConversationSummary(conversationId: string, value: string | null): void {
  const ctx = getUserContext();
  const cacheKey = getSummaryCacheKey(conversationId, ctx?.username);
  conversationSummaryCache.set(cacheKey, { value, timestamp: Date.now() });
}

function hasFunctionMemoryAvailable(): boolean {
  const ctx = getUserContext();
  const dir = ctx?.profilePaths?.functionsVerified;
  if (!dir) return false;

  const cached = functionAvailabilityCache.get(dir);
  if (cached && Date.now() - cached.timestamp < FUNCTION_CACHE_TTL) {
    return cached.available;
  }

  let available = false;
  try {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      available = files.length > 0;
    }
  } catch {
    available = false;
  }

  functionAvailabilityCache.set(dir, { available, timestamp: Date.now() });
  return available;
}

function shouldSkipToolScan(conversationId?: string): boolean {
  if (!conversationId) return true;
  const entry = toolScanCooldown.get(conversationId);
  if (!entry) return false;
  if (entry.hadResults) return false;
  if (Date.now() - entry.timestamp > TOOL_SCAN_COOLDOWN_MS) {
    toolScanCooldown.delete(conversationId);
    return false;
  }
  return true;
}

function recordToolScan(conversationId: string | undefined, hadResults: boolean): void {
  if (!conversationId) return;
  if (hadResults) {
    toolScanCooldown.delete(conversationId);
    return;
  }
  toolScanCooldown.set(conversationId, { timestamp: Date.now(), hadResults });
}

type TimingMap = Record<string, number>;

function logContextTimings(
  cacheHit: boolean,
  retrievalTime: number,
  timings: TimingMap
): void {
  if (!CONTEXT_TIMING_FLAG && retrievalTime < CONTEXT_SLOW_THRESHOLD) {
    return;
  }
  const parts = Object.entries(timings)
    .map(([key, value]) => `${key}=${value}ms`)
    .join(', ');
  console.log(`[context-builder] timings (${cacheHit ? 'cache' : 'fresh'}): total=${retrievalTime}ms ${parts}`);
}

interface CacheKeyContext {
  userKey?: string;
  conversationKey?: string;
}

function getCacheKey(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions,
  context: CacheKeyContext = {}
): string {
  // Create cache key from message + mode + critical options
  const optionsKey = JSON.stringify({
    searchDepth: options.searchDepth,
    maxMemories: options.maxMemories,
    filterInnerDialogue: options.filterInnerDialogue,
    filterReflections: options.filterReflections,
    usingLoRA: options.usingLoRA,
    conversationId: options.conversationId ?? null
  });
  const userKey = context.userKey || 'anonymous';
  const conversationKey = context.conversationKey || 'global';
  return `${userKey}:${mode}:${conversationKey}:${userMessage.substring(0, 100)}:${optionsKey}`;
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

/**
 * Query conversation summary for a specific session
 *
 * Phase 3: Memory Continuity - retrieves existing conversation summary
 * Workstream C3: Skip if summary is currently being generated (backpressure)
 *
 * @param conversationId - Session ID to find summary for
 * @returns Conversation summary or null if not found
 */
async function queryConversationSummary(conversationId?: string): Promise<string | null> {
  if (!conversationId) return null;

  const ctx = getUserContext();
  if (!ctx) return null;

  const cached = getCachedConversationSummary(conversationId);
  if (cached !== undefined) {
    return cached;
  }

  // C3: Skip if currently being summarized (prevents concurrent LLM calls)
  const beingSummarized = await isSummarizing(ctx.username, conversationId);
  if (beingSummarized) {
    audit({
      level: 'info',
      category: 'system',
      event: 'conversation_summary_skipped_concurrent',
      details: { conversationId, reason: 'summary_in_progress' },
      actor: 'context_builder',
    });
    return null;
  }

  try {
    const episodicDir = ctx.profilePaths.episodic;
    if (!existsSync(episodicDir)) return null;

    // Look back 7 days for summaries
    const today = new Date();
    const lookbackDays = 7;

    for (let i = 0; i < lookbackDays; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const year = date.getFullYear().toString();
      const yearDir = path.join(episodicDir, year);

      if (!existsSync(yearDir)) continue;

      const files = readdirSync(yearDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      for (const file of files) {
        const filepath = path.join(yearDir, file);
        try {
          const content = readFileSync(filepath, 'utf-8');
          const event = JSON.parse(content);

          // Look for summary events with matching conversation ID
          if (event.type === 'summary' && event.metadata) {
            const summarySessionId = event.metadata.conversationId || event.metadata.sessionId;
            if (summarySessionId === conversationId) {
              // Return the full summary from metadata
              const summary = event.metadata.fullSummary || event.content || null;
              setCachedConversationSummary(conversationId, summary);
              return summary;
            }
          }
        } catch (error) {
          continue;
        }
      }
    }

    setCachedConversationSummary(conversationId, null);
    return null;
  } catch (error) {
    console.error('[context-builder] Error querying conversation summary:', error);
    setCachedConversationSummary(conversationId, null);
    return null;
  }
}

/**
 * Query recent tool invocations for the current conversation
 *
 * Phase 2: Memory Continuity - retrieves tool usage history from episodic memories
 * Workstream A3: Cache-first approach - reads from recent-tools cache instead of scanning episodic files
 *
 * @param conversationId - Session ID to filter by
 * @param mode - Cognitive mode (affects limit via memory policy)
 * @param options - Query options
 * @returns Array of recent tool invocations
 */
async function queryRecentToolInvocations(
  conversationId?: string,
  mode: CognitiveModeId = 'dual',
  options: { limit?: number } = {}
): Promise<ToolInvocation[]> {
  try {
    const ctx = getUserContext();
    if (!ctx) return [];

    // Get mode-aware limit (dual=10, agent=5, emulation=0)
    const maxLimit = getToolHistoryLimit(mode, ctx.role);
    if (maxLimit === 0) return []; // Emulation mode or guests

    const limit = Math.min(options.limit || maxLimit, maxLimit);

    // A3: Try cache first (O(records) instead of O(files))
    if (conversationId) {
      const cachedTools = await readRecentToolsFromCache(ctx.profilePaths, conversationId, limit);

      if (cachedTools && cachedTools.length > 0) {
        // Cache hit - transform to ToolInvocation format
        const tools: ToolInvocation[] = cachedTools.map((t) => {
          // Parse outputs from cache entry
          let outputs: Record<string, any> = {};
          if (t.snippetPath) {
            // Large output stored separately - use summary
            outputs = { _summary: t.summary || '(large output)' };
          } else if (t.output) {
            try {
              outputs = JSON.parse(t.output);
            } catch {
              outputs = { _raw: t.output };
            }
          }

          // Apply role-based filtering to outputs
          const filteredOutputs = filterToolOutputs(outputs, ctx.role, t.toolName);

          return {
            id: t.eventId,
            toolName: t.toolName,
            timestamp: t.timestamp,
            inputs: {}, // Not stored in cache (optimization)
            outputs: filteredOutputs,
            success: t.success,
            error: undefined, // Not stored in cache
            executionTimeMs: undefined, // Not stored in cache
          };
        });

        return tools;
      }

      if (cachedTools && cachedTools.length === 0) {
        return [];
      }
    }

    // Cache miss - fallback to episodic scan (cache miss already logged by readRecentToolsFromCache)
    if (conversationId && shouldSkipToolScan(conversationId)) {
      return [];
    }

    const tools: ToolInvocation[] = [];

    const episodicDir = ctx.profilePaths.episodic;
    if (!existsSync(episodicDir)) return [];

    // Look back 3 days for tool invocations
    const today = new Date();
    const lookbackDays = 3;

    for (let i = 0; i < lookbackDays; i++) {
      if (tools.length >= limit) break;

      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const year = date.getFullYear().toString();
      const yearDir = path.join(episodicDir, year);

      if (!existsSync(yearDir)) continue;

      const files = readdirSync(yearDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first

      for (const file of files) {
        if (tools.length >= limit) break;

        const filepath = path.join(yearDir, file);
        try {
          const content = readFileSync(filepath, 'utf-8');
          const event = JSON.parse(content);

          // Filter for tool invocations
          if (event.type === 'tool_invocation' && event.metadata) {
            // If conversationId specified, filter by it
            if (conversationId && event.metadata.conversationId !== conversationId) {
              continue;
            }

            // Phase 4: Apply role-based filtering to tool outputs
            const rawOutputs = event.metadata.toolOutputs || {};
            const filteredOutputs = filterToolOutputs(
              rawOutputs,
              ctx.role,
              event.metadata.toolName || 'unknown'
            );

            tools.push({
              id: event.id,
              toolName: event.metadata.toolName || 'unknown',
              timestamp: event.timestamp,
              inputs: event.metadata.toolInputs || {},
              outputs: filteredOutputs, // Filtered based on role
              success: event.metadata.success !== false,
              error: event.metadata.error,
              executionTimeMs: event.metadata.executionTimeMs
            });
          }
        } catch (error) {
          // Skip malformed files
          continue;
        }
      }
    }

    const ordered = tools.reverse();
    if (conversationId) {
      recordToolScan(conversationId, ordered.length > 0);
    }

    // Return in chronological order (oldest first)
    return ordered;
  } catch (error) {
    console.error('[context-builder] Error querying tool invocations:', error);
    return [];
  }
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
  type: 'theme' | 'person' | 'project' | 'behavior' | 'entity';
  pattern: string;
  frequency: number;
  lastSeen: string;
}

/**
 * Tool invocation record for context package
 * Extracted from episodic memories to show recent tool usage
 */
export interface ToolInvocation {
  id: string;
  toolName: string;
  timestamp: string;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  success: boolean;
  error?: string;
  executionTimeMs?: number;
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

  // Tool history (Phase 2: Memory Continuity)
  recentTools: ToolInvocation[];

  // Function guides (Phase 2: Function Memory)
  functionGuides: Array<{ id: string; title: string; summary: string; score: number }>;

  // Conversation summary (Phase 3: Future)
  conversationSummary?: string;

  // Metadata
  mode: CognitiveModeId;
  retrievalTime: number;
  timestamp: string;
  indexStatus: 'available' | 'missing' | 'error';
  maxContextChars?: number;
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

  // Hybrid search (keyword + semantic)
  metadataFilters?: {
    type?: string | string[];  // Filter by memory type (e.g., 'dream', 'reflection')
    tags?: string[];            // Filter by tags
    entities?: string[];        // Filter by entities
  };

  // Mode-specific overrides
  forceSemanticSearch?: boolean; // Dual mode: always try semantic search
  usingLoRA?: boolean; // Skip persona context when using LoRA (default: false)

  // Conversation tracking (Phase 2: Memory Continuity)
  conversationId?: string; // Session ID for filtering tool invocations
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
 *
 * Bug fix: Corrected field mapping to use item.text instead of hit.content
 */
export async function buildContextPackage(
  userMessage: string,
  mode: CognitiveModeId,
  options: ContextBuilderOptions = {}
): Promise<ContextPackage> {
  const startTime = Date.now();
  const timings: TimingMap = {};
  const ctx = getUserContext();
  const userKey = ctx?.profilePaths
    ? path.basename(ctx.profilePaths.root)
    : ctx?.username || 'anonymous';
  const conversationKey = options.conversationId || 'global';

  // Check cache first
  const cacheKey = getCacheKey(userMessage, mode, options, {
    userKey,
    conversationKey
  });
  const cached = getCachedContext(cacheKey);
  if (cached) {
    logContextTimings(true, Date.now() - startTime, { cache: Date.now() - startTime });
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
    metadataFilters,
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

  const memoryStart = Date.now();
  try {
    const idx = await getIndexStatus();

    if (idx.exists) {
      // Semantic search available
      let hits = await queryIndex(userMessage, { topK });

      // HYBRID SEARCH: Apply metadata filters if provided
      // This implements proper keyword + semantic search combination
      if (metadataFilters) {
        hits = hits.filter((hit: any) => {
          try {
            const raw = readFileSync(hit.item.path, 'utf-8');
            const obj = JSON.parse(raw);
            const type = obj?.type ? String(obj.type) : '';
            const tags: string[] = Array.isArray(obj?.tags) ? obj.tags.map((x: any) => String(x)) : [];
            const entities: string[] = Array.isArray(obj?.entities) ? obj.entities.map((x: any) => String(x)) : [];

            // Store metadata on hit for later use
            hit._metadata = { type, tags, entities };

            // Check type filter (OR logic - matches any of the specified types)
            if (metadataFilters.type) {
              const types = Array.isArray(metadataFilters.type) ? metadataFilters.type : [metadataFilters.type];
              if (!types.includes(type)) {
                return false;
              }
            }

            // Check tags filter (OR logic - has at least one of the specified tags)
            if (metadataFilters.tags && metadataFilters.tags.length > 0) {
              const hasAnyTag = metadataFilters.tags.some(tag => tags.includes(tag));
              if (!hasAnyTag) {
                return false;
              }
            }

            // Check entities filter (OR logic - has at least one of the specified entities)
            if (metadataFilters.entities && metadataFilters.entities.length > 0) {
              const hasAnyEntity = metadataFilters.entities.some(entity => entities.includes(entity));
              if (!hasAnyEntity) {
                return false;
              }
            }

            return true;
          } catch {
            // If file can't be read, exclude it when filters are active
            return false;
          }
        });
      }

      // Filter by similarity threshold
      let filtered = hits.filter((hit: any) => hit.score >= similarityThreshold);

      // Apply content-based filters (matching persona_chat.ts behavior)
      // Also enrich hits with metadata from files for better context
      if (filterInnerDialogue || filterReflections) {
        filtered = filtered.filter((hit: any) => {
          try {
            // Load memory file to check type and tags
            const raw = readFileSync(hit.item.path, 'utf-8');
            const obj = JSON.parse(raw);
            const type = obj?.type ? String(obj.type) : '';
            const tags: string[] = Array.isArray(obj?.tags) ? obj.tags.map((x: any) => String(x)) : [];

            // Store metadata on hit for later use
            hit._metadata = { type, tags };

            // Filter inner dialogue
            if (filterInnerDialogue && type === 'inner_dialogue') {
              return false;
            }

            // Filter reflections and dreams
            // Check both tags AND type field (dreams use type='dream', not tag='dream')
            if (filterReflections && (
              tags.includes('reflection') ||
              tags.includes('dream') ||
              type === 'dream'  // ← FIX: Also check type field for dreams
            )) {
              return false;
            }

            return true;
          } catch {
            // If file can't be read, include it anyway
            return true;
          }
        });
      }

      // Phase 4: Apply role-based memory limits
      const roleMaxMemories = ctx ? getMaxMemoriesForRole(ctx.role) : maxMemories;
      const effectiveLimit = Math.min(maxMemories, roleMaxMemories);

      // Limit to maxMemories (default: 2 for parity with old code)
      // Note: persona_chat.ts selects 2 "novel" memories (not recently used)
      // For now, we just take the top N by score
      filtered = filtered.slice(0, effectiveLimit);

      // Map to RelevantMemory interface with role-based privacy filtering
      // Note: queryIndex returns { item: VectorIndexItem, score: number }
      // where VectorIndexItem has: id, path, type, timestamp, text, vector
      memories = filtered
        .filter((hit: any) => {
          // Phase 4: Filter by memory type visibility
          const type = hit._metadata?.type || hit.item?.type || hit.type || 'unknown';
          if (ctx && !canViewMemoryType(type, ctx.role)) {
            return false;
          }
          return true;
        })
        .map((hit: any) => {
          const content = hit.item?.text || hit.content || '';
          // Phase 4: Redact sensitive data based on role
          const redactedContent = ctx ? redactSensitiveData(content, ctx.role) : content;

          return {
            id: hit.item?.id || hit.id,
            content: redactedContent,  // Redacted based on role
            timestamp: hit.item?.timestamp || hit.timestamp,
            score: hit.score,
            type: hit._metadata?.type || hit.item?.type || hit.type,  // Use enriched metadata if available
            tags: hit._metadata?.tags || hit.item?.tags || hit.tags || []  // Use enriched tags
          };
        });

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
  timings.memoryRetrieval = Date.now() - memoryStart;

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

  // If task context is requested, load actual tasks from filesystem or cache
  if (includeTaskContext) {
    try {
      // Try warm cache first (30-second TTL for fresh data)
      let tasks = getWarmCachedTasks(userKey);

      if (!tasks) {
        // Cache miss - load from filesystem
        tasks = listActiveTasks();
        setWarmCachedTasks(userKey, tasks);
      }

      activeTasks = tasks.map((t: any) => `[${t.status.toUpperCase()}] ${t.title}`);
    } catch (error) {
      console.error('[context-builder] Error loading tasks:', error);
    }
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
  // Step 5: Query Recent Tool Invocations (Phase 2: Memory Continuity)
  // ========================================================================

  let recentTools: ToolInvocation[] = [];

  if (options.conversationId) {
    const toolStart = Date.now();
    try {
      recentTools = await queryRecentToolInvocations(
        options.conversationId,
        mode,
        { limit: getToolHistoryLimit(mode, getUserContext()?.role || 'owner') }
      );
    } catch (error) {
      console.error('[context-builder] Error querying recent tools:', error);
      // Continue without tool history
    } finally {
      timings.toolHistory = Date.now() - toolStart;
    }
  }

  // ========================================================================
  // Step 6: Query Conversation Summary (Phase 3: Memory Continuity)
  // ========================================================================

  let conversationSummary: string | undefined;

  if (options.conversationId) {
    const summaryStart = Date.now();
    try {
      const summary = await queryConversationSummary(options.conversationId);
      if (summary) {
        conversationSummary = summary;
      }
    } catch (error) {
      console.error('[context-builder] Error querying conversation summary:', error);
      // Continue without summary
    } finally {
      timings.summaryLookup = Date.now() - summaryStart;
    }
  }

  // ========================================================================
  // Step 6.5: Retrieve Function Guides (Phase 2: Function Memory)
  // ========================================================================

  let functionGuides: Array<{ id: string; title: string; summary: string; score: number }> = [];

  if (hasFunctionMemoryAvailable()) {
    const functionStart = Date.now();
    try {
      const { retrieveFunctions } = await import('./function-memory');

      console.log('[context-builder] Retrieving functions for query:', userMessage.substring(0, 80));

      // Retrieve functions using semantic search on the user message
      const matchingFunctions = await retrieveFunctions(userMessage, {
        topK: 3, // Limit to top 3 most relevant functions
        minScore: 0.6, // Require at least 60% similarity
        includeDrafts: false, // Only include verified functions
      });

      console.log(`[context-builder] Retrieved ${matchingFunctions.length} matching functions`);

      // Extract lightweight summaries for context package (include ID for tracking)
      functionGuides = matchingFunctions.map(({ function: func, score }) => ({
        id: func.id,
        title: func.title,
        summary: func.summary,
        score,
      }));

      if (functionGuides.length > 0) {
        console.log('[context-builder] Function guides:', functionGuides.map(g => `${g.title} (${(g.score * 100).toFixed(1)}%)`).join(', '));
      }
    } catch (error) {
      // Function retrieval is optional, don't fail if it errors
      console.error('[context-builder] Error retrieving functions:', error);
    } finally {
      timings.functionLookup = Date.now() - functionStart;
    }
  }

  // ========================================================================
  // Step 7: Build Context Package
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
    recentTools,
    functionGuides,
    conversationSummary,
    mode,
    retrievalTime,
    timestamp: new Date().toISOString(),
    indexStatus,
    maxContextChars
  };

  // ========================================================================
  // Step 6: Audit Logging
  // ========================================================================

  // Phase 4: Track privacy filtering for audit
  const auditCtx = getUserContext();
  const privacyFiltered = auditCtx && (auditCtx.role === 'guest' || auditCtx.role === 'anonymous');
  const effectiveMemoryLimit = auditCtx ? getMaxMemoriesForRole(auditCtx.role) : maxMemories;

  audit({
    level: 'info',
    category: privacyFiltered ? 'security' : 'action',
    event: 'context_package_built',
    details: {
      mode,
      memoriesFound: memories.length,
      retrievalTime,
      indexStatus,
      fallbackUsed,
      searchDepth,
      activeTasks: activeTasks.length,
      patternsDetected: patterns.length,
      recentTools: recentTools.length,
      functionGuides: functionGuides.length,
      hasSummary: !!conversationSummary,
      userRole: auditCtx?.role || 'unknown',
      privacyFiltered,
      effectiveMemoryLimit
    },
    actor: 'context_builder'
  });

  // Cache the result
  setCachedContext(cacheKey, contextPackage);

  logContextTimings(false, retrievalTime, timings);

  return contextPackage;
}

// ============================================================================
// Helper: Format Context for Prompts
// ============================================================================

/**
 * Format tool invocations into a readable summary for prompts
 *
 * @param tools - Array of tool invocations
 * @param maxChars - Character limit for tool section
 * @returns Formatted tool history string
 */
function formatToolsForPrompt(tools: ToolInvocation[], maxChars: number = 800): string {
  if (tools.length === 0) return '';

  const lines: string[] = [];
  lines.push('\n## Recent Tool Uses:');

  let charCount = lines[0].length;

  for (const tool of tools) {
    const status = tool.success ? '✓' : '✗';
    const timeAgo = formatTimeAgo(tool.timestamp);

    let line = `- ${status} ${tool.toolName} (${timeAgo})`;

    // Add key outputs if available and within budget
    if (tool.outputs && Object.keys(tool.outputs).length > 0) {
      const outputSummary = summarizeOutputs(tool.outputs);
      if (charCount + outputSummary.length < maxChars) {
        line += `: ${outputSummary}`;
      }
    }

    if (charCount + line.length > maxChars) break;

    lines.push(line);
    charCount += line.length;
  }

  return lines.join('\n');
}

/**
 * Summarize tool outputs for prompt inclusion
 */
function summarizeOutputs(outputs: Record<string, any>): string {
  const keys = Object.keys(outputs);
  if (keys.length === 0) return '';

  const summaryParts: string[] = [];

  for (const key of keys.slice(0, 3)) { // Max 3 keys
    const value = outputs[key];
    if (typeof value === 'string') {
      summaryParts.push(`${key}: ${value.substring(0, 50)}`);
    } else if (typeof value === 'number') {
      summaryParts.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      summaryParts.push(`${key}: [${value.length} items]`);
    }
  }

  return summaryParts.join(', ');
}

/**
 * Format timestamp as relative time
 */
function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

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
  options: { maxChars?: number; includePersona?: boolean; includeTools?: boolean } = {}
): string {
  const resolvedMaxChars = options.maxChars ?? context.maxContextChars ?? 900;
  const { includePersona = true, includeTools = true } = options;
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

  // Conversation summary (Phase 3: Memory Continuity)
  if (context.conversationSummary) {
    sections.push(`\n## Conversation Summary:\n${context.conversationSummary}`);
  }

  // Function guides (Phase 2: Function Memory)
  if (context.functionGuides.length > 0) {
    sections.push(`\n## Proven Workflows (${context.functionGuides.length} available):`);
    sections.push('The following function guides may help accomplish this goal:');

    for (const guide of context.functionGuides) {
      const scorePercent = (guide.score * 100).toFixed(0);
      sections.push(`- **${guide.title}** (${scorePercent}% match): ${guide.summary}`);
    }

    sections.push('\nNote: Full step-by-step guides are available in the function memory system.');
  }

  // Recent tool invocations (Phase 2: Memory Continuity)
  if (includeTools && context.recentTools.length > 0) {
    const toolSection = formatToolsForPrompt(context.recentTools, 800);
    sections.push(toolSection);
  }

  // Relevant memories (with character limit matching persona_chat.ts)
  if (context.memories.length > 0) {
    sections.push(`\n## Relevant Context (${context.memories.length} memories):`);

    let used = 0;
    for (let idx = 0; idx < context.memories.length; idx++) {
      const mem = context.memories[idx];
      const chunk = `${idx + 1}. ${mem.content}`;

      // Respect character limit (matching persona_chat.ts behavior)
      if (used + chunk.length > resolvedMaxChars) {
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
