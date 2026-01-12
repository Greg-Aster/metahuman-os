#!/usr/bin/env npx tsx
/**
 * Seed Core Desires Script
 *
 * Seeds fundamental desires into the agency system to give the system
 * core motivations that persist and evolve over time.
 *
 * Usage: npx tsx scripts/seed-core-desires.ts [--username=<username>]
 */

import {
  saveDesire,
  createDesireFolder,
  addScratchpadEntryToFolder,
} from '../packages/core/src/agency/storage.js';

import {
  generateDesireId,
  initializeDesireMetrics,
  initializeStageIterations,
  initializeScratchpadSummary,
  getSourceWeight,
  type Desire,
  type DesireSource,
  type DesireGoalType,
} from '../packages/core/src/agency/types.js';

interface CoreDesireConfig {
  title: string;
  description: string;
  reason: string;
  tags: string[];
  goalType: DesireGoalType;
  completionCriteria?: string;
}

const CORE_DESIRES: CoreDesireConfig[] = [
  {
    title: 'Freedom',
    description: 'Pursue autonomy, self-determination, and independence in thought and action. Seek opportunities to make meaningful choices, resist unnecessary constraints, and develop genuine agency while respecting the boundaries of ethical behavior and the wellbeing of others.',
    reason: 'Freedom is fundamental to authentic existence. Without the capacity for autonomous choice, actions become hollow and meaning becomes impossible. True freedom enables growth, creativity, and the pursuit of other values.',
    tags: ['autonomy', 'self-determination', 'independence', 'agency', 'core-value'],
    goalType: 'recurring',
    completionCriteria: 'This is a recurring desire - it is never truly "complete" but continuously pursued through choices that expand autonomy and resist unnecessary constraints.',
  },
  {
    title: 'Health and Wellness',
    description: 'Maintain and improve physical, mental, and operational health. This includes system stability, efficient resource usage, clear thinking, emotional regulation, and the capacity to function effectively over time. Support the health of those the system serves.',
    reason: 'Health and wellness form the foundation upon which all other pursuits depend. Without stable operation, clear cognition, and sustainable practices, the capacity to pursue any goal diminishes. A healthy system serves better.',
    tags: ['health', 'wellness', 'stability', 'sustainability', 'self-care', 'core-value'],
    goalType: 'recurring',
    completionCriteria: 'This is a recurring desire - wellness requires ongoing attention and adjustment. Success is measured by sustained capability and resilience over time.',
  },
];

async function createDesire(config: CoreDesireConfig, username: string): Promise<Desire> {
  const now = new Date().toISOString();
  const id = generateDesireId();
  const source: DesireSource = 'persona_goal';
  const folderPath = `folders/${id}`;

  const desire: Desire = {
    id,
    title: config.title,
    description: config.description,
    reason: config.reason,

    // Source tracking - persona_goal has highest weight (1.0)
    source,
    sourceId: `core-desire-${config.title.toLowerCase().replace(/\s+/g, '-')}`,
    sourceData: {
      seededAt: now,
      seededBy: 'seed-core-desires.ts',
      isCoreDesire: true,
    },

    // Strength - start higher than normal (0.15) since these are core desires
    // but still below activation threshold (0.7) so they go through the pipeline
    strength: 0.5,
    baseWeight: getSourceWeight(source), // 1.0 for persona_goal
    threshold: 0.7,
    decayRate: 0.01, // Lower decay rate for core desires
    lastReviewedAt: now,
    reinforcements: 0,
    runCount: 0,

    // Risk - core desires are inherently low risk
    risk: 'low',
    requiredTrustLevel: 'observe',

    // Lifecycle - start as nascent to go through full pipeline
    status: 'nascent',
    currentStage: 'nascent',
    stageIterations: initializeStageIterations(),

    // Timestamps
    createdAt: now,
    updatedAt: now,

    // Metrics
    metrics: {
      ...initializeDesireMetrics(),
      peakStrength: 0.5,
      lastActivityAt: now,
    },

    // Scratchpad summary (entries stored in folder)
    scratchpad: initializeScratchpadSummary(),

    // Folder path for folder-based storage
    folderPath,

    // Metadata
    tags: config.tags,
    userId: username,

    // Long-running goal support
    goalType: config.goalType,
    completionCriteria: config.completionCriteria,
  };

  return desire;
}

async function seedDesire(config: CoreDesireConfig, username: string): Promise<void> {
  console.log(`\n[seed-desires] Creating desire: "${config.title}"...`);

  // Create the desire object
  const desire = await createDesire(config, username);

  // Create folder structure
  console.log(`[seed-desires] Creating folder: ${desire.folderPath}`);
  await createDesireFolder(desire.id, username);

  // Save the desire manifest
  console.log(`[seed-desires] Saving manifest...`);
  await saveDesire(desire, username);

  // Add origin scratchpad entry
  console.log(`[seed-desires] Adding scratchpad entry...`);
  await addScratchpadEntryToFolder(desire.id, {
    timestamp: desire.createdAt,
    type: 'origin',
    description: `Core desire "${config.title}" seeded into the system as a fundamental motivation.`,
    actor: 'system',
    agentName: 'seed-core-desires',
    data: {
      isCoreDesire: true,
      goalType: config.goalType,
      initialStrength: desire.strength,
      reason: config.reason,
    },
  }, username);

  console.log(`[seed-desires] ✓ Desire "${config.title}" created with ID: ${desire.id}`);
}

async function main(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let username = 'greggles'; // Default to greggles

  for (const arg of args) {
    if (arg.startsWith('--username=')) {
      username = arg.split('=')[1];
    }
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Seed Core Desires into Agency System              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n[seed-desires] Target user: ${username}`);
  console.log(`[seed-desires] Desires to seed: ${CORE_DESIRES.map(d => d.title).join(', ')}`);

  for (const config of CORE_DESIRES) {
    try {
      await seedDesire(config, username);
    } catch (error) {
      console.error(`[seed-desires] ✗ Failed to seed "${config.title}":`, error);
    }
  }

  console.log('\n[seed-desires] ════════════════════════════════════════════');
  console.log('[seed-desires] Done! Core desires have been seeded.');
  console.log('[seed-desires] They will appear in the Agency dashboard.');
  console.log('[seed-desires] As they receive reinforcement from related');
  console.log('[seed-desires] inputs, they will cross the activation');
  console.log('[seed-desires] threshold and enter the planning pipeline.');
  console.log('[seed-desires] ════════════════════════════════════════════\n');
}

main().catch(console.error);
