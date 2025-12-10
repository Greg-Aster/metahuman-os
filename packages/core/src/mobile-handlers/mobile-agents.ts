/**
 * Mobile Agent Wrappers
 *
 * Wraps unified agent functionality for in-process execution on mobile.
 * These agents are registered with the MobileAgentScheduler and run
 * without spawning child processes.
 *
 * All agents use the model router which respects the user's LLM configuration
 * (local Ollama, vLLM, RunPod, Claude, etc.)
 *
 * Mobile-Compatible Agents (using unified agents):
 * - organizer: Memory enrichment
 * - ingestor: Process inbox files
 * - reflector: Generate reflections from memory chains
 * - dreamer: Create dream narratives
 * - curiosity: User-facing curiosity questions
 * - inner-curiosity: Self-directed Q&A
 * - digest: Activity summaries
 * - desire-generator: Synthesize desires from system inputs
 * - desire-planner: Generate execution plans for desires
 * - desire-executor: Execute approved desire plans
 * - desire-reviewer: Review completed/failed desires
 *
 * Server-Only Agents (cannot run on mobile):
 * - transcriber: Requires Whisper/GPU
 * - fine-tune-trainer: Requires GPU training
 * - lora-trainer: Requires GPU training
 * - gguf-converter: Requires Python/ML tools
 */

import path from 'node:path';
import fs from 'node:fs';
import { withUserContext } from '../context.js';
import { captureEvent } from '../memory.js';
import { callLLM, type RouterMessage } from '../model-router.js';
import { audit, auditAction } from '../audit.js';
import { storageClient } from '../storage-client.js';
import {
  mobileScheduler,
  type MobileAgentContext,
  type MobileAgentRegistration,
} from './mobile-scheduler.js';

// Import from brain agents (unified codebase - same agents as server)
import { generateUserReflection } from '../../../../brain/agents/reflector.js';
import { generateUserDreams } from '../../../../brain/agents/dreamer.js';
import { generateUserQuestion } from '../../../../brain/agents/curiosity-service.js';
import { generateInnerQuestion } from '../../../../brain/agents/inner-curiosity.js';
import { runDigest as brainRunDigest } from '../../../../brain/agents/digest.js';

// Agency system agents
import { generateDesiresForUser } from '../../../../brain/agents/desire-generator.js';
import { processPlanningDesires, loadPlannerConfig } from '../../../../brain/agents/desire-planner.js';
import { processApprovedDesires } from '../../../../brain/agents/desire-executor.js';
import { processDesires as processDesireOutcomes } from '../../../../brain/agents/desire-outcome-reviewer.js';

// ============================================================================
// Organizer Agent (Mobile Version - keeps original implementation)
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
      keepAlive: '0', // Unload immediately for background agent
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
      const unprocessed = findUnprocessedMemories(episodicDir, 3);

      console.log(`[mobile-organizer] Found ${unprocessed.length} unprocessed memories`);

      for (const filePath of unprocessed) {
        try {
          const memory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          console.log(`[mobile-organizer] Processing: ${memory.id}`);

          const analysis = await analyzeMemoryContent(memory.content);

          memory.tags = [...new Set([...(memory.tags || []), ...analysis.tags])];
          memory.entities = [...new Set([...(memory.entities || []), ...analysis.entities])];
          memory.metadata = {
            ...memory.metadata,
            processed: true,
            processedAt: new Date().toISOString(),
            processedBy: 'mobile-organizer',
          };

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
// Ingestor Agent (Mobile Version - keeps original implementation)
// ============================================================================

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

      for (const file of files.slice(0, 5)) {
        const filePath = path.join(inboxDir, file);

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const ext = path.extname(file).toLowerCase();

          let eventContent = content;
          let eventType = 'observation';

          if (ext === '.json') {
            try {
              const parsed = JSON.parse(content);
              eventContent = parsed.content || JSON.stringify(parsed);
              eventType = parsed.type || 'observation';
            } catch {
              eventContent = content;
            }
          }

          const eventId = captureEvent(eventContent, {
            type: eventType,
            tags: ['ingested', 'mobile'],
            metadata: {
              source: 'inbox',
              originalFile: file,
              ingestedBy: 'mobile-ingestor',
            },
          });

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
// Brain Agent Wrappers (unified codebase - same code as server)
// ============================================================================

/**
 * Reflector wrapper - uses brain/agents/reflector.ts
 */
async function runReflectorWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-reflector] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const success = await generateUserReflection(context.username!);
        console.log(`[mobile-reflector] ${success ? 'Complete' : 'Skipped'}`);
      } catch (error) {
        console.error('[mobile-reflector] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Dreamer wrapper - uses brain/agents/dreamer.ts
 */
async function runDreamerWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-dreamer] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const result = await generateUserDreams(context.username!);
        console.log(`[mobile-dreamer] Complete: ${result.dreamsGenerated} dreams, ${result.memoriesCurated} memories`);
      } catch (error) {
        console.error('[mobile-dreamer] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Curiosity wrapper - uses brain/agents/curiosity-service.ts
 */
async function runCuriosityWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-curiosity] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const success = await generateUserQuestion(context.username!);
        console.log(`[mobile-curiosity] ${success ? 'Question generated' : 'Skipped'}`);
      } catch (error) {
        console.error('[mobile-curiosity] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Inner Curiosity wrapper - uses brain/agents/inner-curiosity.ts
 */
async function runInnerCuriosityWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-inner-curiosity] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const success = await generateInnerQuestion(context.username!);
        console.log(`[mobile-inner-curiosity] ${success ? 'Inner Q&A generated' : 'Skipped'}`);
      } catch (error) {
        console.error('[mobile-inner-curiosity] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Digest wrapper - uses brain/agents/digest.ts
 */
async function runDigestWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-digest] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        await brainRunDigest();
        console.log('[mobile-digest] Complete');
      } catch (error) {
        console.error('[mobile-digest] Error:', (error as Error).message);
      }
    }
  );
}

// ============================================================================
// Agent Registration
// ============================================================================

// ============================================================================
// Agency System Agent Wrappers (desire-*)
// ============================================================================

/**
 * Desire Generator wrapper - uses brain/agents/desire-generator.ts
 */
async function runDesireGeneratorWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-desire-generator] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const count = await generateDesiresForUser(context.username!);
        console.log(`[mobile-desire-generator] Complete: ${count} desires generated`);
      } catch (error) {
        console.error('[mobile-desire-generator] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Desire Planner wrapper - uses brain/agents/desire-planner.ts
 */
async function runDesirePlannerWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-desire-planner] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const config = await loadPlannerConfig();
        const result = await processPlanningDesires(context.username!, config);
        console.log(`[mobile-desire-planner] Complete: ${result.planned} planned, ${result.approved} approved`);
      } catch (error) {
        console.error('[mobile-desire-planner] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Desire Executor wrapper - uses brain/agents/desire-executor.ts
 */
async function runDesireExecutorWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-desire-executor] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const result = await processApprovedDesires(context.username!);
        console.log(`[mobile-desire-executor] Complete: ${result.executed} executed, ${result.succeeded} succeeded`);
      } catch (error) {
        console.error('[mobile-desire-executor] Error:', (error as Error).message);
      }
    }
  );
}

/**
 * Desire Outcome Reviewer wrapper - uses brain/agents/desire-outcome-reviewer.ts
 */
async function runDesireReviewerWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-desire-reviewer] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        const result = await processDesireOutcomes(context.username!);
        console.log(`[mobile-desire-reviewer] Complete: ${result.reviewed} reviewed`);
      } catch (error) {
        console.error('[mobile-desire-reviewer] Error:', (error as Error).message);
      }
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
    // Original agents
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
    // Unified agents
    {
      id: 'reflector',
      name: 'Reflector',
      run: runReflectorWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 600, // Every 10 minutes
    },
    {
      id: 'dreamer',
      name: 'Dreamer',
      run: runDreamerWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 3600, // Every hour (dreams are rare)
    },
    {
      id: 'curiosity',
      name: 'Curiosity',
      run: runCuriosityWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 900, // Every 15 minutes
    },
    {
      id: 'inner-curiosity',
      name: 'Inner Curiosity',
      run: runInnerCuriosityWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 1200, // Every 20 minutes
    },
    {
      id: 'digest',
      name: 'Daily Digest',
      run: runDigestWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 86400, // Once per day
    },
    // Agency system agents
    {
      id: 'desire-generator',
      name: 'Desire Generator',
      run: runDesireGeneratorWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 1800, // Every 30 minutes
    },
    {
      id: 'desire-planner',
      name: 'Desire Planner',
      run: runDesirePlannerWrapper,
      usesLLM: true,
      priority: 'normal',
      intervalSeconds: 300, // Every 5 minutes
    },
    {
      id: 'desire-executor',
      name: 'Desire Executor',
      run: runDesireExecutorWrapper,
      usesLLM: true,
      priority: 'normal',
      intervalSeconds: 300, // Every 5 minutes
    },
    {
      id: 'desire-reviewer',
      name: 'Desire Outcome Reviewer',
      run: runDesireReviewerWrapper,
      usesLLM: true,
      priority: 'low',
      intervalSeconds: 600, // Every 10 minutes
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
export {
  runOrganizer,
  runIngestor,
  runReflectorWrapper as runReflector,
  runDreamerWrapper as runDreamer,
  runCuriosityWrapper as runCuriosity,
  runInnerCuriosityWrapper as runInnerCuriosity,
  runDigestWrapper as runDigest,
  // Agency system
  runDesireGeneratorWrapper as runDesireGenerator,
  runDesirePlannerWrapper as runDesirePlanner,
  runDesireExecutorWrapper as runDesireExecutor,
  runDesireReviewerWrapper as runDesireReviewer,
};
