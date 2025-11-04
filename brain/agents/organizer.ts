#!/usr/bin/env node
/**
 * Organizer Agent - Automatically processes and enriches memories
 *
 * This agent:
 * - Scans episodic memories for unprocessed entries
 * - Uses LLM to extract tags and entities
 * - Updates memory files with enriched metadata
 * - Logs all operations to audit trail
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// For ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

// Import from core
import { paths, audit, auditAction, llm, type LLMMessage, acquireLock, isLocked, initGlobalLogger } from '@metahuman/core';

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

  const messages: LLMMessage[] = [
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
    // Use Ollama by default, falls back to mock if not available
    const result = await llm.generateJSON<AnalysisResult>(messages, 'ollama', {
      temperature: 0.3,
    });

    console.log(`[Organizer] Found ${result.tags?.length || 0} tags, ${result.entities?.length || 0} entities`);

    // Audit the analysis
    auditAction({
      skill: 'organizer:analyze',
      inputs: { contentLength: content.length },
      success: true,
      output: { tags: result.tags, entities: result.entities },
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
      // Read active model from etc/agent.json to record provenance
      let activeModel = 'unknown';
      try {
        const agentCfgPath = path.join(paths.root, 'etc', 'agent.json');
        const cfgRaw = fs.readFileSync(agentCfgPath, 'utf8');
        const cfg = JSON.parse(cfgRaw);
        activeModel = cfg.model || activeModel;
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
 * Main agent execution cycle
 */
async function runCycle() {
  console.log('🤖 Organizer Agent: Starting new cycle...');

  // Audit agent start
  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'organizer' },
    actor: 'agent',
  });

  try {
    // Find unprocessed memories
    const memories = findUnprocessedMemories();
    if (memories.length > 0) {
        console.log(`[Organizer] Found ${memories.length} memories to process.`);
        // Process each memory
        for (const filepath of memories) {
          await processMemory(filepath);
        }
        console.log('[Organizer] Cycle finished. ✅');
    } else {
        console.log('[Organizer] No new memories to process.');
    }

    // Audit completion
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: { agent: 'organizer', processed: memories.length },
      actor: 'agent',
    });
  } catch (error) {
    console.error('\n❌ Agent cycle error:', (error as Error).message);

    // Audit failure
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'organizer', error: (error as Error).message },
      actor: 'agent',
    });
  }
}

/**
 * Main entry point for the continuous agent
 */
async function main() {
    initGlobalLogger('organizer');
    // Single-instance lock
    try {
      if (isLocked('agent-organizer')) {
        // Only log if not in quiet mode (for clean dev server output)
        if (!process.argv.includes('--quiet')) {
          console.log('[Organizer] Another instance is already running. Exiting.');
        }
        return;
      }
      acquireLock('agent-organizer');
    } catch (e) {
      console.log('[Organizer] Failed to acquire lock, exiting.');
      return;
    }

    console.log('🚀 Starting Continuous Organizer Agent...');
    // Run once immediately
    await runCycle();

    // Then run every 1 minute
    const interval = 60 * 1000;
    setInterval(runCycle, interval);

    console.log(`[Main] Agent will run every ${interval / 1000} seconds.`);
}

// Run if executed directly
main().catch(console.error);
