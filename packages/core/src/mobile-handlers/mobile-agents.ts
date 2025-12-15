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

// All agents now use the new modular structure (core.ts + cli.ts + index.ts)
import { syncUserProfile } from '../../../../brain/agents/profile-sync/core.js';
import { processUserMemories as organizerProcessUserMemories } from '../../../../brain/agents/organizer/core.js';
import { generateUserReflection } from '../../../../brain/agents/reflector/core.js';
import { generateUserDreams } from '../../../../brain/agents/dreamer/core.js';
import { ingestUserFiles } from '../../../../brain/agents/ingestor/core.js';
import { generateUserQuestion } from '../../../../brain/agents/curiosity-service/core.js';
import { generateInnerQuestion } from '../../../../brain/agents/inner-curiosity/core.js';
import { generateUserDigest } from '../../../../brain/agents/digest/core.js';

// Agency system agents (new modular structure)
import { generateDesiresForUser } from '../../../../brain/agents/desire-generator/core.js';
import { processPlanningDesires } from '../../../../brain/agents/desire-planner/core.js';
import { processApprovedDesires } from '../../../../brain/agents/desire-executor/core.js';
import { processDesires as processDesireOutcomes } from '../../../../brain/agents/desire-outcome-reviewer/core.js';

// ============================================================================
// Organizer Agent (uses new modular structure)
// ============================================================================

/**
 * Organizer wrapper - uses brain/agents/organizer/core.ts
 */
async function runOrganizer(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-organizer] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        // Use the unified organizer with a limit for mobile
        const processed = await organizerProcessUserMemories(context.username!, { limit: 3 });
        console.log(`[mobile-organizer] Complete: ${processed} memories processed`);
      } catch (error) {
        console.error('[mobile-organizer] Error:', (error as Error).message);
      }
    }
  );
}

// ============================================================================
// Ingestor Agent (uses new modular structure)
// ============================================================================

/**
 * Ingestor wrapper - uses brain/agents/ingestor/core.ts
 */
async function runIngestor(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-ingestor] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        // Use the unified ingestor with a limit for mobile
        const processed = await ingestUserFiles(context.username!, { limit: 5 });
        console.log(`[mobile-ingestor] Complete: ${processed} files processed`);
      } catch (error) {
        console.error('[mobile-ingestor] Error:', (error as Error).message);
      }
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
 * Digest wrapper - uses brain/agents/digest/core.ts
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
        const digest = await generateUserDigest(context.username!);
        console.log(`[mobile-digest] Complete: ${digest?.themes?.length || 0} themes analyzed`);
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
 * Desire Planner wrapper - uses brain/agents/desire-planner/core.ts
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
        const result = await processPlanningDesires(context.username!);
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
// Sync Agents (new modular structure)
// ============================================================================

/**
 * Profile Sync wrapper - uses brain/agents/profile-sync/core.ts
 */
async function runProfileSyncWrapper(context: MobileAgentContext): Promise<void> {
  if (!context.username) {
    console.log('[mobile-profile-sync] No username, skipping');
    return;
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      try {
        // Default options for mobile sync: pull-only, skip device-specific configs
        const result = await syncUserProfile(context.username!, {
          pullOnly: true,
          skipConfig: true,
        });
        console.log(
          `[mobile-profile-sync] Complete: ${result.profileFiles} files, ${result.memoriesImported} memories`
        );
      } catch (error) {
        console.error('[mobile-profile-sync] Error:', (error as Error).message);
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
    // Sync agents (high priority, run on login)
    {
      id: 'profile-sync',
      name: 'Profile Sync',
      run: runProfileSyncWrapper,
      usesLLM: false,
      priority: 'high',
      intervalSeconds: 1800, // Every 30 minutes
    },
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
  // Sync agents
  runProfileSyncWrapper as runProfileSync,
  // Agency system
  runDesireGeneratorWrapper as runDesireGenerator,
  runDesirePlannerWrapper as runDesirePlanner,
  runDesireExecutorWrapper as runDesireExecutor,
  runDesireReviewerWrapper as runDesireReviewer,
};
