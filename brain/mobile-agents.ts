/**
 * Mobile Agent Wrappers
 *
 * Wraps unified agent functionality for in-process execution on mobile.
 * These agents register in-process handlers with the core work coordinator.
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
 * Core Work Coordinator handlers own desire execution and outcome review on all platforms.
 *
 * Server-Only Agents (cannot run on mobile):
 * - transcriber: Requires Whisper/GPU
 * - fine-tune-trainer: Requires GPU training
 * - lora-trainer: Requires GPU training
 */

import { withUserContext } from '@metahuman/core/context';
import {
  initializeMobileAgents as initializeCoordinatorMobileAgents,
  stopMobileAgents as stopCoordinatorMobileAgents,
  type MobileAgentContext,
  type MobileAgentRegistration,
} from '@metahuman/core/mobile-handlers';

// All agents now use the new modular structure (core.ts + cli.ts + index.ts)
import { syncUserProfile } from './agents/profile-sync/core.js';
import { processUserMemories as organizerProcessUserMemories } from './agents/organizer/core.js';
import { generateUserReflection } from './agents/reflector/core.js';
import { generateUserDreams } from './agents/dreamer/core.js';
import { ingestUserFiles } from './agents/ingestor/core.js';
import { generateUserQuestion } from './agents/curiosity-service/core.js';
import { generateInnerQuestion } from './agents/inner-curiosity/core.js';
import { generateUserDigest } from './agents/digest/core.js';

// Agency system agents (new modular structure)
import { runCycle as runDesireGeneratorCycle } from './agents/desire-generator/core.js';
import { runCycle as runDesirePlannerCycle } from './agents/desire-planner/core.js';

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
    throw new Error('Curiosity handler requires an authenticated username');
  }

  await withUserContext(
    { userId: context.username, username: context.username, role: 'owner' },
    async () => {
      const outcome = await generateUserQuestion(context.username!);
      console.log(`[mobile-curiosity] ${outcome.status === 'generated' ? 'Question generated' : `Skipped: ${outcome.reason}`}`);
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
        console.log(`[mobile-digest] Complete: ${digest.themesIdentified} themes analyzed`);
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
      const result = await runDesireGeneratorCycle({ username: context.username! });
      if (!result.success) throw new Error(result.errors.join('; '));
      console.log(`[mobile-desire-generator] Complete: ${result.totalGenerated} desires generated`);
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
      const result = await runDesirePlannerCycle({ username: context.username! });
      if (!result.success) throw new Error(result.errors.join('; '));
      console.log(`[mobile-desire-planner] Complete: ${result.stats.planned} planned, ${result.stats.approved} approved`);
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
 * Register mobile-compatible in-process executors with the canonical coordinator.
 * Trigger Manager remains the sole owner of admission policy and timing.
 */
export function registerMobileAgents(): MobileAgentRegistration[] {
  const agents: MobileAgentRegistration[] = [
    // Sync agents
    {
      id: 'profile-sync',
      name: 'Profile Sync',
      run: runProfileSyncWrapper,
    },
    // Original agents
    {
      id: 'organizer',
      name: 'Memory Organizer',
      run: runOrganizer,
    },
    {
      id: 'ingestor',
      name: 'Inbox Ingestor',
      run: runIngestor,
    },
    // Unified agents
    {
      id: 'reflector',
      name: 'Reflector',
      run: runReflectorWrapper,
    },
    {
      id: 'dreamer',
      name: 'Dreamer',
      run: runDreamerWrapper,
    },
    {
      id: 'curiosity',
      name: 'Curiosity',
      handler: 'agent.curiosity-service',
      run: runCuriosityWrapper,
    },
    {
      id: 'inner-curiosity',
      name: 'Inner Curiosity',
      run: runInnerCuriosityWrapper,
    },
    {
      id: 'digest',
      name: 'Daily Digest',
      run: runDigestWrapper,
    },
    // Agency system agents
    {
      id: 'desire-generator',
      name: 'Desire Generator',
      run: runDesireGeneratorWrapper,
    },
    {
      id: 'desire-planner',
      name: 'Desire Planner',
      run: runDesirePlannerWrapper,
    },
  ];

  return agents;
}

/**
 * Initialize and start mobile agents
 */
export async function initializeMobileAgents(dataDir: string, username?: string): Promise<void> {
  const agents = registerMobileAgents();
  await initializeCoordinatorMobileAgents(dataDir, username, agents);
  console.log('[mobile-agents] Mobile agent system initialized');
}

/**
 * Stop mobile agents
 */
export function stopMobileAgents(): void {
  stopCoordinatorMobileAgents();
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
};
