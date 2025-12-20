/**
 * Organizer Agent — Core Logic
 *
 * Automatically processes and enriches memories:
 * - Scans episodic memories for unprocessed entries
 * - Uses LLM to extract tags and entities
 * - Updates memory files with enriched metadata
 * - Logs all operations to audit trail
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  storageClient,
  audit,
  auditAction,
  callLLM,
  type RouterMessage,
  getLoggedInUsers,
  withUserContext,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  entities?: string[];
  tags?: string[];
  importance?: number;
  links?: Array<{ type: string; target: string }>;
  metadata?: {
    processed?: boolean;
    processedAt?: string;
    model?: string;
  };
}

export interface AnalysisResult {
  tags: string[];
  entities: string[];
}

export interface OrganizerOptions {
  limit?: number;
  singleUser?: boolean;
}

export interface OrganizerResult {
  success: boolean;
  totalProcessed: number;
  userCount: number;
  errors: string[];
}

// ============================================================================
// Memory Analysis
// ============================================================================

/**
 * Analyze memory content using LLM
 */
export async function analyzeMemoryContent(content: string): Promise<AnalysisResult> {
  console.log(`[organizer] Analyzing: "${content.substring(0, 50)}..."`);

  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: 'You are an expert text analysis agent. Extract key tags and named entities from text. Respond with ONLY valid JSON: {"tags": ["tag1", "tag2"], "entities": ["entity1", "entity2"]}',
    },
    {
      role: 'user',
      content: `Analyze this text and extract tags (topics, themes, categories) and entities (people, places, tools, concepts):\n\n${content}`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'curator',
      messages,
      options: { temperature: 0.3 },
      keepAlive: '0', // Unload immediately for background agent
    });

    const result = JSON.parse(response.content) as AnalysisResult;

    console.log(`[organizer] Found ${result.tags?.length || 0} tags, ${result.entities?.length || 0} entities`);

    auditAction({
      skill: 'organizer:analyze',
      inputs: { contentLength: content.length },
      success: true,
      output: {
        tags: result.tags,
        entities: result.entities,
        modelId: response.modelId,
        latencyMs: response.latencyMs,
      },
    });

    return {
      tags: result.tags || [],
      entities: result.entities || [],
    };
  } catch (error) {
    console.error('[organizer] Analysis failed:', (error as Error).message);

    auditAction({
      skill: 'organizer:analyze',
      inputs: { contentLength: content.length },
      success: false,
      error: (error as Error).message,
    });

    return { tags: [], entities: [] };
  }
}

// ============================================================================
// Memory Discovery
// ============================================================================

/**
 * Find unprocessed memories in the episodic directory
 * @param username - Username to resolve the correct profile storage location
 * @param limit - Optional limit on number of memories to return
 */
export function findUnprocessedMemories(username: string, limit?: number): string[] {
  const result = storageClient.resolvePath({ username, category: 'memory', subcategory: 'episodic' });
  console.log(`[organizer] Resolved episodic path for ${username}: ${result.path}`);
  if (!result.success || !result.path) {
    console.error('[organizer] Cannot resolve episodic path');
    return [];
  }

  const episodicDir = result.path;
  const files: string[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    if (limit && files.length >= limit) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (limit && files.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const memory: EpisodicMemory = JSON.parse(content);

          // Generic/system tags that don't count as "meaningful" semantic tags
          const GENERIC_TAGS = new Set(['ingested', 'inbox', 'ai', 'curated', 'audio', 'transcript']);

          // Check if memory has only generic tags (no semantic enrichment)
          const hasOnlyGenericTags = memory.tags && memory.tags.length > 0 &&
            memory.tags.every(tag => GENERIC_TAGS.has(tag.toLowerCase()));

          // Memory needs processing if:
          // 1. Not already processed AND
          // 2. (Has no tags OR only generic tags) AND
          // 3. Has no entities
          const needsProcessing =
            !memory.metadata?.processed &&
            (!memory.tags || memory.tags.length === 0 || hasOnlyGenericTags) &&
            (!memory.entities || memory.entities.length === 0);

          if (needsProcessing) {
            files.push(fullPath);
          }
        } catch (e) {
          console.error(`[organizer] Error reading ${fullPath}:`, (e as Error).message);
        }
      }
    }
  };

  walk(episodicDir);
  return files;
}

// ============================================================================
// Memory Processing
// ============================================================================

/**
 * Normalize entities to strings
 */
function normalizeEntities(entities: any[] | undefined): string[] {
  if (!entities) return [];
  return entities.map((e: any) => {
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') {
      if (typeof (e as any).name === 'string') return (e as any).name;
      if (typeof (e as any).entity === 'string') return (e as any).entity;
      const firstString = Object.values(e).find(v => typeof v === 'string');
      if (typeof firstString === 'string') return firstString;
    }
    try { return JSON.stringify(e); } catch { return String(e); }
  });
}

/**
 * Process a single memory file
 */
export async function processMemory(filepath: string): Promise<boolean> {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const memory: EpisodicMemory = JSON.parse(content);

    // Normalize existing entities
    memory.entities = normalizeEntities(memory.entities);

    // Analyze content
    const analysis = await analyzeMemoryContent(memory.content);

    if (analysis.tags.length > 0 || analysis.entities.length > 0) {
      // Update memory with new tags/entities
      memory.tags = [...(memory.tags || []), ...analysis.tags].filter(
        (tag, index, self) => self.indexOf(tag) === index
      );
      const mergedEntities = [...(memory.entities || []), ...analysis.entities];
      memory.entities = normalizeEntities(mergedEntities).filter(
        (entity, index, self) => self.indexOf(entity) === index
      );

      // Mark as processed
      memory.metadata = {
        ...memory.metadata,
        processed: true,
        processedAt: new Date().toISOString(),
        model: 'organizer',
      };

      fs.writeFileSync(filepath, JSON.stringify(memory, null, 2));
      console.log(`[organizer] Updated ${path.basename(filepath)}`);
      return true;
    } else {
      console.log(`[organizer] Skipped ${path.basename(filepath)} (no results from LLM)`);
      return false;
    }
  } catch (error) {
    console.error(`[organizer] Failed to process ${path.basename(filepath)}:`, (error as Error).message);
    return false;
  }
}

/**
 * Process memories for a single user
 */
export async function processUserMemories(
  username: string,
  options: OrganizerOptions = {}
): Promise<number> {
  console.log(`[organizer] Processing user: ${username}`);

  try {
    const memories = findUnprocessedMemories(username, options.limit);

    if (memories.length > 0) {
      console.log(`[organizer]   Found ${memories.length} memories to process`);

      let processed = 0;
      for (const filepath of memories) {
        const success = await processMemory(filepath);
        if (success) processed++;
      }

      console.log(`[organizer]   Completed ${username}: ${processed}/${memories.length}`);
      return processed;
    } else {
      console.log(`[organizer]   No new memories for ${username}`);
      return 0;
    }
  } catch (error) {
    console.error(`[organizer]   Error processing ${username}:`, (error as Error).message);
    throw error;
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full organizer cycle (multi-user)
 */
export async function runCycle(options: OrganizerOptions = {}): Promise<OrganizerResult> {
  console.log('[organizer] Starting cycle...');

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'organizer', mode: options.singleUser ? 'single-user' : 'multi-user' },
    actor: 'agent',
  });

  const result: OrganizerResult = {
    success: false,
    totalProcessed: 0,
    userCount: 0,
    errors: [],
  };

  try {
    const loggedInUsers = getLoggedInUsers();

    if (loggedInUsers.length === 0) {
      console.log('[organizer] No logged-in users found. Skipping cycle.');
      audit({
        level: 'info',
        category: 'action',
        event: 'agent_cycle_skipped',
        details: { agent: 'organizer', reason: 'no_logged_in_users' },
        actor: 'agent',
      });
      result.success = true;
      return result;
    }

    console.log(`[organizer] Found ${loggedInUsers.length} logged-in user(s) to process`);
    result.userCount = loggedInUsers.length;

    for (const user of loggedInUsers) {
      try {
        const processed = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => processUserMemories(user.username, options)
        );
        result.totalProcessed += processed;
      } catch (error) {
        const errorMsg = `User ${user.username}: ${(error as Error).message}`;
        console.error(`[organizer] Failed: ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log(`[organizer] Cycle finished. Processed ${result.totalProcessed} memories.`);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'organizer',
        mode: options.singleUser ? 'single-user' : 'multi-user',
        totalProcessed: result.totalProcessed,
        userCount: result.userCount,
      },
      actor: 'agent',
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[organizer] Cycle error:', errorMsg);

    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'organizer', error: errorMsg },
      actor: 'agent',
    });

    result.errors.push(errorMsg);
    return result;
  }
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: OrganizerOptions = {
    limit: opts.limit as number | undefined,
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  // Parse limit from args
  const limitArg = args.find(a => a.startsWith('--limit='));
  if (limitArg && !options.limit) {
    options.limit = parseInt(limitArg.split('=')[1], 10);
  }

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const processed = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => processUserMemories(ctx.username, options)
      );

      return {
        success: true,
        data: { totalProcessed: processed, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: processed,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.totalProcessed,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
