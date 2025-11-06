#!/usr/bin/env node
/**
 * Organizer Agent - Automatically processes and enriches memories
 *
 * This agent:
 * - Scans episodic memories for unprocessed entries (multi-user capable)
 * - Uses LLM to extract tags and entities
 * - Updates memory files with enriched metadata
 * - Logs all operations to audit trail
 *
 * MULTI-USER: Processes all users sequentially, with isolated context per user.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// For ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

// Import from core
import {
  paths,
  audit,
  auditAction,
  callLLM,
  type RouterMessage,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
} from '@metahuman/core';

interface EpisodicMemory {
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

interface AnalysisResult {
  tags: string[];
  entities: string[];
}

/**
 * Analyze memory content using LLM
 */
async function analyzeMemoryContent(content: string): Promise<AnalysisResult> {
  console.log(`[Organizer] Analyzing: "${content.substring(0, 50)}..."`);

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
    // Use curator role for memory analysis
    const response = await callLLM({
      role: 'curator',
      messages,
      options: {
        temperature: 0.3,
      },
    });

    // Parse JSON from response
    const result = JSON.parse(response.content) as AnalysisResult;

    console.log(`[Organizer] Found ${result.tags?.length || 0} tags, ${result.entities?.length || 0} entities`);

    // Audit the analysis
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
    console.error('[Organizer] Analysis failed:', (error as Error).message);
    console.error('[Organizer] Make sure Ollama is running: ollama serve');

    // Audit the failure
    auditAction({
      skill: 'organizer:analyze',
      inputs: { contentLength: content.length },
      success: false,
      error: (error as Error).message,
    });

    // Return empty arrays on error
    return { tags: [], entities: [] };
  }
}

/**
 * Find unprocessed memories
 */
function findUnprocessedMemories(): string[] {
  const episodicDir = paths.episodic;
  const files: string[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const memory: EpisodicMemory = JSON.parse(content);

          // Check if needs processing
          const needsProcessing =
            !memory.metadata?.processed &&
            (!memory.tags || memory.tags.length === 0) &&
            (!memory.entities || memory.entities.length === 0);

          if (needsProcessing) {
            files.push(fullPath);
          }
        } catch (e) {
          console.error(`[Organizer] Error reading ${fullPath}:`, (e as Error).message);
        }
      }
    }
  };

  walk(episodicDir);
  return files;
}

/**
 * Process a single memory file
 */
async function processMemory(filepath: string): Promise<void> {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const memory: EpisodicMemory = JSON.parse(content);

    // Normalize existing entities to strings to ensure schema consistency
    const normalizeEntities = (entities: any[] | undefined): string[] => {
      if (!entities) return [];
      return entities.map((e: any) => {
        if (typeof e === 'string') return e;
        if (e && typeof e === 'object') {
          // Prefer common fields
          if (typeof (e as any).name === 'string') return (e as any).name;
          if (typeof (e as any).entity === 'string') return (e as any).entity;
          // Fallback: first string value in object
          const firstString = Object.values(e).find(v => typeof v === 'string');
          if (typeof firstString === 'string') return firstString;
        }
        // Last resort: stringify
        try { return JSON.stringify(e); } catch { return String(e); }
      });
    };

    // Apply normalization before analysis/merge
    memory.entities = normalizeEntities(memory.entities);

    // Analyze content
    const analysis = await analyzeMemoryContent(memory.content);

    // Only update if we got results
    if (analysis.tags.length > 0 || analysis.entities.length > 0) {
      // Update memory
      memory.tags = [...(memory.tags || []), ...analysis.tags].filter(
        (tag, index, self) => self.indexOf(tag) === index // Remove duplicates
      );
      const mergedEntities = [...(memory.entities || []), ...analysis.entities];
      // Ensure entities remain strings and unique
      memory.entities = normalizeEntities(mergedEntities).filter((entity, index, self) => self.indexOf(entity) === index);

      // Mark as processed
      // Read active model from etc/models.json to record provenance
      let activeModel = 'unknown';
      try {
        const { loadModelRegistry } = await import('../../packages/core/src/index.js');
        const registry = loadModelRegistry();
        const fallbackId = registry.defaults?.fallback || 'default.fallback';
        const fallbackModel = registry.models?.[fallbackId];
        activeModel = fallbackModel?.model || activeModel;

        // Check if using adapter
        if (registry.globalSettings?.useAdapter && registry.globalSettings?.activeAdapter) {
          const adapterInfo = typeof registry.globalSettings.activeAdapter === 'string'
            ? registry.globalSettings.activeAdapter
            : registry.globalSettings.activeAdapter.modelName;
          activeModel = adapterInfo;
        }
      } catch {}

      memory.metadata = {
        ...memory.metadata,
        processed: true,
        processedAt: new Date().toISOString(),
        model: `ollama:${activeModel}`,
      };

      // Write back
      fs.writeFileSync(filepath, JSON.stringify(memory, null, 2));

      console.log(`✓ Updated ${path.basename(filepath)}`);
    } else {
      console.log(`⚠ Skipped ${path.basename(filepath)} (no results from LLM)`);
    }
  } catch (error) {
    console.error(`✗ Failed to process ${path.basename(filepath)}:`, (error as Error).message);
  }
}

/**
 * Process memories for a single user
 */
async function processUserMemories(username: string): Promise<number> {
  console.log(`[Organizer] Processing user: ${username}`);

  try {
    // Find unprocessed memories (uses user context!)
    const memories = findUnprocessedMemories();

    if (memories.length > 0) {
      console.log(`[Organizer]   Found ${memories.length} memories to process`);

      // Process each memory
      for (const filepath of memories) {
        await processMemory(filepath);
      }

      console.log(`[Organizer]   Completed ${username} ✅`);
    } else {
      console.log(`[Organizer]   No new memories for ${username}`);
    }

    return memories.length;
  } catch (error) {
    console.error(`[Organizer]   Error processing ${username}:`, (error as Error).message);
    throw error;
  }
}

/**
 * Main agent execution cycle (multi-user)
 */
async function runCycle() {
  console.log('🤖 Organizer Agent: Starting new cycle (multi-user)...');

  // Audit agent start (system-level, no user context)
  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'organizer', mode: 'multi-user' },
    actor: 'agent',
  });

  try {
    // Get all users
    const users = listUsers();
    console.log(`[Organizer] Found ${users.length} users to process`);

    let totalProcessed = 0;

    // Process each user with isolated context
    for (const user of users) {
      try {
        // Run with user context for automatic path resolution
        const processed = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            return await processUserMemories(user.username);
          }
        );
        // Context automatically cleaned up - no leakage to next user

        totalProcessed += processed;
      } catch (error) {
        console.error(`[Organizer] Failed to process user ${user.username}:`, (error as Error).message);
        // Continue with next user
      }
    }

    console.log(`[Organizer] Cycle finished. Processed ${totalProcessed} memories across ${users.length} users. ✅`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'organizer',
        mode: 'multi-user',
        totalProcessed,
        userCount: users.length,
      },
      actor: 'agent',
    });
  } catch (error) {
    console.error('\n❌ Agent cycle error:', (error as Error).message);

    // Audit failure (system-level)
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'organizer', mode: 'multi-user', error: (error as Error).message },
      actor: 'agent',
    });
  }
}

/**
 * Main entry point
 *
 * NOTE: This agent is now managed by the AgentScheduler.
 * When called directly (e.g., by tsx), it runs a single cycle and exits.
 * The scheduler handles the interval timing and respects quiet hours, etc.
 */
async function main() {
    initGlobalLogger('organizer');

    console.log('🤖 Organizer Agent: Running single cycle (managed by scheduler)...');

    // Run once and exit
    await runCycle();
}

// Run if executed directly
main().catch(console.error);
