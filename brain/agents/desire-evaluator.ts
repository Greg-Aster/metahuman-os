#!/usr/bin/env tsx
/**
 * Desire Evaluator Agent
 *
 * Manages the lifecycle of desires:
 * - Applies decay to pending/nascent desires
 * - Detects reinforcement opportunities
 * - Activates desires that cross threshold
 * - Abandons desires that decay too low
 * - Triggers planning for activated desires
 *
 * Runs periodically (every 15 minutes) and does NOT use LLM.
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  captureEvent,
  storageClient,
} from '@metahuman/core';

import {
  type Desire,
  type DesireStatus,
  applyDecay,
  applyReinforcement,
  isAboveThreshold,
  calculateEffectiveStrength,
} from '@metahuman/core';

import {
  loadConfig,
  isAgencyEnabled,
} from '@metahuman/core';

import {
  saveDesire,
  moveDesire,
  listPendingDesires,
  listNascentDesires,
  listActiveDesires,
  incrementMetric,
} from '@metahuman/core';

import fs from 'node:fs/promises';
import path from 'node:path';

const LOCK_NAME = 'desire-evaluator';
const LOG_PREFIX = '[AGENCY:evaluator]';

// ============================================================================
// Decay Management
// ============================================================================

/**
 * Apply decay to all nascent and pending desires
 */
async function applyDecayToDesires(
  desires: Desire[],
  config: Awaited<ReturnType<typeof loadConfig>>,
  username?: string
): Promise<{ decayed: number; abandoned: number }> {
  if (!config.thresholds.decay.enabled) {
    return { decayed: 0, abandoned: 0 };
  }

  const now = new Date();
  let decayed = 0;
  let abandoned = 0;

  for (const desire of desires) {
    // Only decay nascent and pending desires
    if (desire.status !== 'nascent' && desire.status !== 'pending') {
      continue;
    }

    const lastDecay = new Date(desire.lastDecayAt);
    const hoursSinceDecay = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60);

    // Only decay if enough time has passed
    if (hoursSinceDecay < 0.1) { // At least 6 minutes
      continue;
    }

    const oldStrength = desire.strength;
    const newStrength = applyDecay(
      oldStrength,
      config.thresholds.decay.ratePerHour,
      hoursSinceDecay,
      config.thresholds.decay.minStrength
    );

    if (newStrength !== oldStrength) {
      desire.strength = newStrength;
      desire.lastDecayAt = now.toISOString();
      desire.updatedAt = now.toISOString();
      decayed++;

      // Check if desire should be abandoned
      if (newStrength <= config.thresholds.decay.minStrength) {
        const oldStatus = desire.status;
        desire.status = 'abandoned';
        desire.completedAt = now.toISOString();
        abandoned++;

        await moveDesire(desire, oldStatus, 'abandoned', username);

        console.log(`${LOG_PREFIX} Abandoned desire: ${desire.title} (strength: ${newStrength.toFixed(3)})`);

        audit({
          category: 'agency',
          level: 'info',
          event: 'desire_abandoned',
          actor: 'desire-evaluator',
          details: {
            desireId: desire.id,
            title: desire.title,
            finalStrength: newStrength,
            reason: 'decayed_below_threshold',
            username,
          },
        });
      } else {
        await saveDesire(desire, username);
      }
    }
  }

  return { decayed, abandoned };
}

// ============================================================================
// Reinforcement Detection
// ============================================================================

/**
 * Check for reinforcement opportunities.
 * A desire is reinforced when related content appears in recent memories.
 *
 * Simple implementation: Look for keyword overlap between desire and recent memories.
 */
async function checkReinforcements(
  desires: Desire[],
  config: Awaited<ReturnType<typeof loadConfig>>,
  username?: string
): Promise<number> {
  // Get recent memories (last hour)
  const recentMemories = await getRecentMemories(1, username);
  if (recentMemories.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  let reinforced = 0;

  for (const desire of desires) {
    // Only reinforce nascent and pending desires
    if (desire.status !== 'nascent' && desire.status !== 'pending') {
      continue;
    }

    // Extract keywords from desire
    const desireKeywords = extractKeywords(desire.title + ' ' + desire.description);

    // Check for overlap with recent memories
    let hasReinforcement = false;
    for (const memory of recentMemories) {
      const memoryKeywords = extractKeywords(memory.content);
      const overlap = desireKeywords.filter(k => memoryKeywords.includes(k));

      if (overlap.length >= 2) { // At least 2 overlapping keywords
        hasReinforcement = true;
        break;
      }
    }

    if (hasReinforcement) {
      const oldStrength = desire.strength;
      desire.strength = applyReinforcement(
        oldStrength,
        config.thresholds.decay.reinforcementBoost
      );
      desire.reinforcements++;
      desire.updatedAt = now;
      reinforced++;

      await saveDesire(desire, username);

      console.log(`${LOG_PREFIX} Reinforced desire: ${desire.title} (${oldStrength.toFixed(2)} → ${desire.strength.toFixed(2)})`);

      audit({
        category: 'agency',
        level: 'info',
        event: 'desire_reinforced',
        actor: 'desire-evaluator',
        details: {
          desireId: desire.id,
          title: desire.title,
          oldStrength,
          newStrength: desire.strength,
          totalReinforcements: desire.reinforcements,
          username,
        },
      });
    }
  }

  return reinforced;
}

/**
 * Extract keywords from text for matching
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his',
    'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those', 'what',
    'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
}

/**
 * Get recent memories for reinforcement checking
 */
async function getRecentMemories(hours: number, username?: string): Promise<Array<{ id: string; content: string }>> {
  try {
    const result = storageClient.resolvePath({ username, category: 'memory', subcategory: 'episodic' });
    if (!result.success || !result.path) return [];

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const memories: Array<{ id: string; content: string; timestamp: Date }> = [];

    // Walk the episodic directory
    async function walk(dir: string) {
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        let stats;
        try {
          stats = await fs.stat(fullPath);
        } catch {
          continue;
        }

        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile() && entry.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
            const timestamp = new Date(content.timestamp);

            // Skip inner dialogues and agency content
            if (content.type === 'inner_dialogue' || content.tags?.includes('agency')) {
              continue;
            }

            if (timestamp >= cutoff) {
              memories.push({
                id: content.id || entry,
                content: content.content || '',
                timestamp,
              });
            }
          } catch {
            // Skip malformed files
          }
        }
      }
    }

    await walk(result.path);

    return memories
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);
  } catch (error) {
    console.error(`${LOG_PREFIX} Error loading recent memories:`, error);
    return [];
  }
}

// ============================================================================
// Activation
// ============================================================================

/**
 * Check desires that should be activated (crossed threshold)
 */
async function activateDesires(
  desires: Desire[],
  config: Awaited<ReturnType<typeof loadConfig>>,
  username?: string
): Promise<number> {
  const now = new Date().toISOString();
  let activated = 0;

  // Check active desire limit
  const currentActive = await listActiveDesires(username);
  const activeCount = currentActive.length;

  for (const desire of desires) {
    // Only activate nascent and pending desires
    if (desire.status !== 'nascent' && desire.status !== 'pending') {
      continue;
    }

    // Check if over limit
    if (activeCount + activated >= config.limits.maxActiveDesires) {
      console.log(`${LOG_PREFIX} Active desire limit reached (${config.limits.maxActiveDesires})`);
      break;
    }

    // Check if above threshold
    if (isAboveThreshold(desire)) {
      const oldStatus = desire.status;
      desire.status = 'pending'; // Move to pending for planning
      desire.activatedAt = now;
      desire.updatedAt = now;
      activated++;

      // If was nascent, move to pending directory
      if (oldStatus === 'nascent') {
        await moveDesire(desire, oldStatus, 'pending', username);
      } else {
        await saveDesire(desire, username);
      }

      const effectiveStrength = calculateEffectiveStrength(desire.strength, desire.baseWeight);

      console.log(`${LOG_PREFIX} Activated desire: ${desire.title} (effective strength: ${effectiveStrength.toFixed(2)})`);

      audit({
        category: 'agency',
        level: 'info',
        event: 'desire_activated',
        actor: 'desire-evaluator',
        details: {
          desireId: desire.id,
          title: desire.title,
          strength: desire.strength,
          effectiveStrength,
          threshold: desire.threshold,
          source: desire.source,
          username,
        },
      });
    }
  }

  return activated;
}

// ============================================================================
// Status Transitions
// ============================================================================

/**
 * Move nascent desires to pending after minimum age
 */
async function promoteNascentDesires(
  desires: Desire[],
  username?: string
): Promise<number> {
  const now = new Date();
  const minAgeMs = 5 * 60 * 1000; // 5 minutes minimum before promotion
  let promoted = 0;

  for (const desire of desires) {
    if (desire.status !== 'nascent') continue;

    const created = new Date(desire.createdAt);
    const ageMs = now.getTime() - created.getTime();

    if (ageMs >= minAgeMs) {
      const oldStatus = desire.status;
      desire.status = 'pending';
      desire.updatedAt = now.toISOString();
      promoted++;

      await moveDesire(desire, oldStatus, 'pending', username);

      console.log(`${LOG_PREFIX} Promoted desire to pending: ${desire.title}`);
    }
  }

  return promoted;
}

// ============================================================================
// Main Evaluator Function
// ============================================================================

/**
 * Evaluate desires for a single user
 */
async function evaluateDesiresForUser(username: string): Promise<{
  decayed: number;
  abandoned: number;
  reinforced: number;
  activated: number;
  promoted: number;
}> {
  console.log(`${LOG_PREFIX} Processing user: ${username}`);

  const result = {
    decayed: 0,
    abandoned: 0,
    reinforced: 0,
    activated: 0,
    promoted: 0,
  };

  // Check if agency is enabled
  const enabled = await isAgencyEnabled(username);
  if (!enabled) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username}`);
    return result;
  }

  // Load config
  const config = await loadConfig(username);

  // Load all desires that need evaluation
  const nascent = await listNascentDesires(username);
  const pending = await listPendingDesires(username);
  const allDesires = [...nascent, ...pending];

  if (allDesires.length === 0) {
    console.log(`${LOG_PREFIX} No desires to evaluate`);
    return result;
  }

  console.log(`${LOG_PREFIX} Evaluating ${allDesires.length} desire(s) (${nascent.length} nascent, ${pending.length} pending)`);

  // 1. Promote nascent desires to pending
  result.promoted = await promoteNascentDesires(nascent, username);

  // 2. Apply decay
  const decayResult = await applyDecayToDesires(allDesires, config, username);
  result.decayed = decayResult.decayed;
  result.abandoned = decayResult.abandoned;

  // 3. Check reinforcements (only for non-abandoned desires)
  const activeForReinforcement = allDesires.filter(d => d.status !== 'abandoned');
  result.reinforced = await checkReinforcements(activeForReinforcement, config, username);

  // 4. Activate desires that crossed threshold
  const activeForActivation = allDesires.filter(d => d.status !== 'abandoned');
  result.activated = await activateDesires(activeForActivation, config, username);

  // Update metrics
  if (result.abandoned > 0) {
    await incrementMetric('totalAbandoned', result.abandoned, username);
  }

  // Log summary to inner dialogue if there are significant changes
  if (config.logging.logToInnerDialogue && (result.activated > 0 || result.abandoned > 0)) {
    const parts: string[] = [];

    if (result.activated > 0) {
      parts.push(`${result.activated} desire(s) ready for planning`);
    }
    if (result.abandoned > 0) {
      parts.push(`${result.abandoned} desire(s) faded away`);
    }
    if (result.reinforced > 0) {
      parts.push(`${result.reinforced} desire(s) grew stronger`);
    }

    const innerDialogue = `🔄 Agency evaluation: ${parts.join(', ')}.`;

    captureEvent(innerDialogue, {
      type: 'inner_dialogue',
      tags: ['agency', 'evaluation', 'inner'],
      metadata: {
        agency: true,
        ...result,
      },
    });
  }

  return result;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  initGlobalLogger();
  console.log(`${LOG_PREFIX} Starting desire evaluator agent...`);

  // Check lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Another instance is running, exiting`);
    process.exit(0);
  }

  // Acquire lock
  const lock = await acquireLock(LOCK_NAME);
  if (!lock) {
    console.error(`${LOG_PREFIX} Failed to acquire lock`);
    process.exit(1);
  }

  try {
    // Process all users
    const users = listUsers();
    console.log(`${LOG_PREFIX} Processing ${users.length} user(s)`);

    const totals = {
      decayed: 0,
      abandoned: 0,
      reinforced: 0,
      activated: 0,
      promoted: 0,
    };

    for (const username of users) {
      try {
        const result = await withUserContext({ username, role: 'owner' }, async () => {
          return await evaluateDesiresForUser(username);
        });

        totals.decayed += result.decayed;
        totals.abandoned += result.abandoned;
        totals.reinforced += result.reinforced;
        totals.activated += result.activated;
        totals.promoted += result.promoted;
      } catch (error) {
        console.error(`${LOG_PREFIX} Error processing user ${username}:`, error);
        audit({
          category: 'system',
          level: 'error',
          message: `Desire evaluator error for user ${username}`,
          actor: 'desire-evaluator',
          details: { error: String(error) },
        });
      }
    }

    console.log(`${LOG_PREFIX} Complete. Decayed: ${totals.decayed}, Abandoned: ${totals.abandoned}, Reinforced: ${totals.reinforced}, Activated: ${totals.activated}, Promoted: ${totals.promoted}`);

    audit({
      category: 'system',
      level: 'info',
      message: 'Desire evaluator completed',
      actor: 'desire-evaluator',
      details: { ...totals, usersProcessed: users.length },
    });
  } finally {
    lock.release();
  }
}

main().catch(error => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});
