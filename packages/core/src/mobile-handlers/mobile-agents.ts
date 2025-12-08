/**
 * Mobile Agent Wrappers
 *
 * Wraps core agent functionality for in-process execution on mobile.
 * These agents are registered with the MobileAgentScheduler and run
 * without spawning child processes.
 *
 * Mobile-Compatible Agents:
 * - organizer: Memory enrichment (needs LLM via RunPod/Claude)
 * - ingestor: Process inbox files (no LLM needed)
 *
 * Server-Only Agents (not included):
 * - transcriber: Requires Whisper/GPU
 * - fine-tune-trainer: Requires GPU training
 * - lora-trainer: Requires GPU training
 * - gguf-converter: Requires Python/ML tools
 */

import path from 'node:path';
import fs from 'node:fs';
import { withUserContext } from '../context.js';
import { captureEvent, searchMemory } from '../memory.js';
import { callLLM, type RouterMessage } from '../model-router.js';
import { audit, auditAction } from '../audit.js';
import { storageClient } from '../storage-client.js';
import {
  mobileScheduler,
  type MobileAgentContext,
  type MobileAgentRegistration,
} from './mobile-scheduler.js';

// ============================================================================
// Organizer Agent (Mobile Version)
// ============================================================================

interface AnalysisResult {
  tags: string[];
  entities: string[];
}

/**
 * Analyze memory content using LLM
 */
async function analyzeMemoryContent(content: string): Promise<AnalysisResult> {
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
    });

    const result = JSON.parse(response.content) as AnalysisResult;
    return result;
  } catch (error) {
    console.error('[mobile-organizer] Analysis failed:', error);
    return { tags: [], entities: [] };
  }
}

/**
 * Find unprocessed memories in a directory
 */
function findUnprocessedMemories(episodicDir: string, limit: number = 5): string[] {
  const unprocessed: string[] = [];

  if (!fs.existsSync(episodicDir)) {
    return unprocessed;
  }

  // Walk year directories
  const years = fs.readdirSync(episodicDir)
    .filter(f => /^\d{4}$/.test(f))
    .sort((a, b) => parseInt(b) - parseInt(a)); // Most recent first

  for (const year of years) {
    if (unprocessed.length >= limit) break;

    const yearDir = path.join(episodicDir, year);
    const files = fs.readdirSync(yearDir)
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a)); // Most recent first

    for (const file of files) {
      if (unprocessed.length >= limit) break;

      try {
        const filePath = path.join(yearDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Skip if already processed
        if (content.metadata?.processed) continue;

        // Skip system types
        if (['tool_invocation', 'file_read', 'file_write'].includes(content.type)) continue;

        unprocessed.push(filePath);
      } catch {
        // Skip invalid files
      }
    }
  }

  return unprocessed;
}

/**
 * Mobile Organizer Agent
 * Processes unprocessed memories and enriches them with LLM-extracted tags/entities
 */
async function runOrganizer(context: MobileAgentContext): Promise<void> {
  console.log('[mobile-organizer] Starting...');

  if (!context.username) {
    console.log('[mobile-organizer] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      const result = storageClient.resolvePath({
        category: 'memory',
        subcategory: 'episodic',
      });

      if (!result.success || !result.path) {
        console.log('[mobile-organizer] Cannot resolve episodic path');
        return;
      }

      const episodicDir = result.path;
      const unprocessed = findUnprocessedMemories(episodicDir, 3); // Process 3 at a time on mobile

      console.log(`[mobile-organizer] Found ${unprocessed.length} unprocessed memories`);

      for (const filePath of unprocessed) {
        try {
          const memory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          console.log(`[mobile-organizer] Processing: ${memory.id}`);

          // Analyze content
          const analysis = await analyzeMemoryContent(memory.content);

          // Update memory
          memory.tags = [...new Set([...(memory.tags || []), ...analysis.tags])];
          memory.entities = [...new Set([...(memory.entities || []), ...analysis.entities])];
          memory.metadata = {
            ...memory.metadata,
            processed: true,
            processedAt: new Date().toISOString(),
            processedBy: 'mobile-organizer',
          };

          // Write back
          fs.writeFileSync(filePath, JSON.stringify(memory, null, 2));

          auditAction({
            skill: 'mobile-organizer:process',
            inputs: { memoryId: memory.id },
            success: true,
            output: { tags: analysis.tags.length, entities: analysis.entities.length },
          });

          console.log(`[mobile-organizer] Processed: ${memory.id}`);
        } catch (error) {
          console.error(`[mobile-organizer] Failed to process ${filePath}:`, error);
        }
      }

      console.log('[mobile-organizer] Complete');
    }
  );
}

// ============================================================================
// Ingestor Agent (Mobile Version)
// ============================================================================

/**
 * Mobile Ingestor Agent
 * Processes files from the inbox directory and converts them to memories
 */
async function runIngestor(context: MobileAgentContext): Promise<void> {
  console.log('[mobile-ingestor] Starting...');

  if (!context.username) {
    console.log('[mobile-ingestor] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      const result = storageClient.resolvePath({
        category: 'memory',
        subcategory: 'inbox',
      });

      if (!result.success || !result.path) {
        console.log('[mobile-ingestor] Cannot resolve inbox path');
        return;
      }

      const inboxDir = result.path;

      if (!fs.existsSync(inboxDir)) {
        console.log('[mobile-ingestor] Inbox directory does not exist');
        return;
      }

      const files = fs.readdirSync(inboxDir).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.txt', '.md', '.json'].includes(ext);
      });

      console.log(`[mobile-ingestor] Found ${files.length} files in inbox`);

      for (const file of files.slice(0, 5)) { // Process 5 at a time
        const filePath = path.join(inboxDir, file);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const ext = path.extname(file).toLowerCase();

          let eventContent = content;
          let eventType = 'observation';

          // Handle different file types
          if (ext === '.json') {
            try {
              const parsed = JSON.parse(content);
              eventContent = parsed.content || JSON.stringify(parsed);
              eventType = parsed.type || 'observation';
            } catch {
              eventContent = content;
            }
          }

          // Capture as memory
          const eventId = captureEvent(eventContent, {
            type: eventType,
            tags: ['ingested', 'mobile'],
            metadata: {
              source: 'inbox',
              originalFile: file,
              ingestedBy: 'mobile-ingestor',
            },
          });

          // Move to archive
          const archiveDir = path.join(inboxDir, '_archive');
          fs.mkdirSync(archiveDir, { recursive: true });
          fs.renameSync(filePath, path.join(archiveDir, file));

          console.log(`[mobile-ingestor] Ingested: ${file} → ${eventId}`);
        } catch (error) {
          console.error(`[mobile-ingestor] Failed to ingest ${file}:`, error);
        }
      }

      console.log('[mobile-ingestor] Complete');
    }
  );
}

// ============================================================================
// Agent Registration
// ============================================================================

/**
 * Register all mobile-compatible agents with the scheduler
 */
export function registerMobileAgents(): void {
  const agents: MobileAgentRegistration[] = [
    {
      id: 'organizer',
      name: 'Memory Organizer',
      run: runOrganizer,
      usesLLM: true,
      priority: 'normal',
      intervalSeconds: 300, // Every 5 minutes
    },
    {
      id: 'ingestor',
      name: 'Inbox Ingestor',
      run: runIngestor,
      usesLLM: false,
      priority: 'low',
      intervalSeconds: 60, // Every minute
    },
  ];

  for (const agent of agents) {
    mobileScheduler.register(agent);
  }

  console.log(`[mobile-agents] Registered ${agents.length} agents`);
}

/**
 * Initialize and start mobile agents
 */
export function initializeMobileAgents(dataDir: string, username?: string): void {
  mobileScheduler.initialize(dataDir, username);
  registerMobileAgents();
  mobileScheduler.start();
  console.log('[mobile-agents] Mobile agent system initialized');
}

/**
 * Stop mobile agents
 */
export function stopMobileAgents(): void {
  mobileScheduler.stop();
  console.log('[mobile-agents] Mobile agent system stopped');
}

// Export individual agent functions for manual triggering
export { runOrganizer, runIngestor };
