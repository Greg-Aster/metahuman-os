/**
 * System State Gatherer for Active Operator
 *
 * Collects current system metrics to inform the decision engine:
 * - Unprocessed memories count
 * - Vector index age
 * - Pending desires
 * - Time since last reflection/dream/psychoanalysis
 * - Queue status
 * - User activity status
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths, systemPaths } from '../paths.js';
import { getIndexStatus } from '../vector-index.js';
import { loadMetrics } from './state-persister.js';
import { getErrorCount } from './self-healing.js';
import {
  getCurrentCircadianWindow,
  isTaskCircadianAppropriate,
} from './lizard-brain.js';
import type { SystemState, TaskType } from './types.js';

/**
 * Get count of unprocessed memories for a user.
 */
async function getUnprocessedMemoryCount(username: string): Promise<number> {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;

  if (!fs.existsSync(episodicDir)) {
    return 0;
  }

  let count = 0;
  const years = fs.readdirSync(episodicDir).filter((f) => /^\d{4}$/.test(f));

  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    const files = fs.readdirSync(yearDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const filePath = path.join(yearDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content);

        if (!memory.metadata?.processed) {
          count++;
        }
      } catch {
        // Skip malformed files
      }
    }
  }

  return count;
}

/**
 * Get hours since last vector index build.
 */
async function getIndexAgeHours(username: string): Promise<number> {
  try {
    const status = await getIndexStatus(username);
    if (!status.exists || !status.createdAt) {
      return 999; // Never built
    }

    const lastUpdated = new Date(status.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - lastUpdated.getTime();
    return diffMs / (1000 * 60 * 60);
  } catch {
    return 999;
  }
}

/**
 * Get count of pending desires.
 */
async function getPendingDesireCount(username: string): Promise<number> {
  const profilePaths = getProfilePaths(username);
  const pendingDir = path.join(profilePaths.persona, 'desires', 'pending');

  if (!fs.existsSync(pendingDir)) {
    return 0;
  }

  const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json'));
  return files.length;
}

/**
 * Get hours since last event of a specific type.
 */
async function getHoursSinceEventType(
  username: string,
  eventType: string,
  tags?: string[]
): Promise<number> {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;

  if (!fs.existsSync(episodicDir)) {
    return 999;
  }

  let latestTimestamp: Date | null = null;
  const years = fs.readdirSync(episodicDir)
    .filter((f) => /^\d{4}$/.test(f))
    .sort()
    .reverse(); // Most recent first

  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    const files = fs.readdirSync(yearDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const filePath = path.join(yearDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content);

        if (memory.type !== eventType) continue;

        if (tags && tags.length > 0) {
          const memoryTags = memory.tags || [];
          if (!tags.some((t) => memoryTags.includes(t))) continue;
        }

        const timestamp = new Date(memory.timestamp);
        if (!latestTimestamp || timestamp > latestTimestamp) {
          latestTimestamp = timestamp;
        }

        // Found one, we can stop checking older files
        break;
      } catch {
        // Skip malformed files
      }
    }

    if (latestTimestamp) break;
  }

  if (!latestTimestamp) {
    return 999;
  }

  const now = new Date();
  const diffMs = now.getTime() - latestTimestamp.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Get idle time in minutes from conversation buffer.
 */
function getIdleMinutes(username: string): number {
  const profilePaths = getProfilePaths(username);
  const bufferFile = path.join(profilePaths.state, `conversation-buffer-${username}.json`);

  if (!fs.existsSync(bufferFile)) {
    return 999; // Never active
  }

  try {
    const content = fs.readFileSync(bufferFile, 'utf-8');
    const buffer = JSON.parse(content);
    const lastMessage = buffer.messages?.[buffer.messages.length - 1];

    if (!lastMessage?.timestamp) {
      return 999;
    }

    const lastActivity = new Date(lastMessage.timestamp);
    const now = new Date();
    return (now.getTime() - lastActivity.getTime()) / (1000 * 60);
  } catch {
    return 999;
  }
}

/**
 * Check if user has been active recently (within last 5 minutes).
 */
function isUserActive(username: string): boolean {
  return getIdleMinutes(username) < 5;
}

/**
 * Get count of files in the memory inbox awaiting ingestion.
 */
function getInboxFileCount(username: string): number {
  const profilePaths = getProfilePaths(username);
  const inboxDir = path.join(profilePaths.root, 'memory', 'inbox');

  if (!fs.existsSync(inboxDir)) {
    return 0;
  }

  try {
    const files = fs.readdirSync(inboxDir).filter((f) => {
      // Skip archive directory and hidden files
      if (f.startsWith('.') || f === '_archive') return false;
      const stat = fs.statSync(path.join(inboxDir, f));
      return stat.isFile();
    });
    return files.length;
  } catch {
    return 0;
  }
}

/**
 * Get TypeScript error count (for self-healing).
 */
async function getCodeErrorCount(): Promise<number> {
  try {
    return getErrorCount();
  } catch {
    // If type checking fails, return 0 to not block other operations
    return 0;
  }
}

/**
 * Gather complete system state for decision engine.
 * Integrates lizard brain awareness (circadian, idle, inbox).
 */
export async function gatherSystemState(
  username: string,
  queueLength: number = 0
): Promise<SystemState> {
  const metrics = loadMetrics();

  // Get current hour for token tracking
  const currentHour = new Date().toISOString().slice(0, 13);
  const tokensUsedThisHour = metrics.tokensPerHour[currentHour] || 0;

  // Get circadian window (lizard brain)
  const circadianWindow = getCurrentCircadianWindow();

  const [
    unprocessedMemories,
    indexAgeHours,
    pendingDesires,
    hoursSinceReflection,
    hoursSinceDream,
    hoursSincePsychoanalysis,
    codeErrors,
  ] = await Promise.all([
    getUnprocessedMemoryCount(username),
    getIndexAgeHours(username),
    getPendingDesireCount(username),
    getHoursSinceEventType(username, 'inner_dialogue', ['idle-thought']),
    getHoursSinceEventType(username, 'dream'),
    getHoursSinceEventType(username, 'inner_dialogue', ['psychoanalysis']),
    getCodeErrorCount(),
  ]);

  // Synchronous lizard brain checks
  const idleMinutes = getIdleMinutes(username);
  const inboxFileCount = getInboxFileCount(username);

  return {
    gatheredAt: new Date().toISOString(),
    unprocessedMemories,
    indexAgeHours,
    pendingDesires,
    hoursSinceReflection,
    hoursSinceDream,
    hoursSincePsychoanalysis,
    queueLength,
    userActive: idleMinutes < 5,
    tokensUsedThisHour,
    codeErrors,
    // Lizard brain additions
    circadianWindow: {
      name: circadianWindow.name,
      recommendedTasks: circadianWindow.tasks as TaskType[],
      description: circadianWindow.description,
    },
    idleMinutes: Math.round(idleMinutes),
    inboxFileCount,
  };
}

/**
 * Get a human-readable summary of system state.
 */
export function formatSystemStateForLLM(state: SystemState): string {
  const lines: string[] = [
    `System State (as of ${new Date(state.gatheredAt).toLocaleTimeString()}):`,
    '',
    `📝 Unprocessed memories: ${state.unprocessedMemories}`,
    `🔍 Vector index age: ${state.indexAgeHours.toFixed(1)} hours`,
    `💭 Pending desires: ${state.pendingDesires}`,
    `🪞 Last reflection: ${state.hoursSinceReflection.toFixed(1)} hours ago`,
    `💤 Last dream: ${state.hoursSinceDream.toFixed(1)} hours ago`,
    `🧠 Last psychoanalysis: ${state.hoursSincePsychoanalysis.toFixed(1)} hours ago`,
    `📋 Queue length: ${state.queueLength}`,
    `👤 User active: ${state.userActive ? 'Yes' : 'No'}`,
    `💰 Tokens used this hour: ${state.tokensUsedThisHour}`,
  ];

  // Lizard brain info
  if (state.circadianWindow) {
    lines.push(`🌙 Circadian window: ${state.circadianWindow.name} (${state.circadianWindow.description})`);
  }
  if (state.idleMinutes !== undefined) {
    lines.push(`⏰ Idle time: ${state.idleMinutes} minutes`);
  }
  if (state.inboxFileCount !== undefined && state.inboxFileCount > 0) {
    lines.push(`📥 Inbox files: ${state.inboxFileCount} awaiting ingestion`);
  }

  if (state.codeErrors !== undefined && state.codeErrors > 0) {
    lines.push(`⚠️ Code errors detected: ${state.codeErrors}`);
  }

  return lines.join('\n');
}

/**
 * Get task recommendations based on system state.
 * Integrates lizard brain awareness (circadian, inbox, idle).
 * Returns tasks sorted by urgency.
 */
export function getTaskRecommendations(state: SystemState): {
  task: TaskType;
  reason: string;
  urgency: 'high' | 'medium' | 'low';
}[] {
  const recommendations: { task: TaskType; reason: string; urgency: 'high' | 'medium' | 'low' }[] = [];

  // === HIGH URGENCY ITEMS ===

  // Inbox files need immediate ingestion
  if (state.inboxFileCount && state.inboxFileCount > 5) {
    recommendations.push({
      task: 'memory_curate',
      reason: `${state.inboxFileCount} files in inbox awaiting ingestion (immediate)`,
      urgency: 'high',
    });
  }

  if (state.unprocessedMemories > 10) {
    recommendations.push({
      task: 'memory_curate',
      reason: `${state.unprocessedMemories} unprocessed memories need curation`,
      urgency: 'high',
    });
  }

  if (state.indexAgeHours > 24) {
    recommendations.push({
      task: 'index_build',
      reason: `Vector index is ${state.indexAgeHours.toFixed(0)} hours old`,
      urgency: 'high',
    });
  }

  if (state.codeErrors && state.codeErrors > 0) {
    recommendations.push({
      task: 'code_analyze',
      reason: `${state.codeErrors} code errors detected`,
      urgency: 'high',
    });
  }

  // === MEDIUM URGENCY ITEMS ===

  // Inbox with fewer files
  if (state.inboxFileCount && state.inboxFileCount > 0 && state.inboxFileCount <= 5) {
    recommendations.push({
      task: 'memory_curate',
      reason: `${state.inboxFileCount} files in inbox awaiting ingestion`,
      urgency: 'medium',
    });
  }

  if (state.hoursSinceReflection > 4) {
    recommendations.push({
      task: 'reflect',
      reason: `No reflection in ${state.hoursSinceReflection.toFixed(0)} hours`,
      urgency: 'medium',
    });
  }

  if (state.pendingDesires > 0) {
    recommendations.push({
      task: 'desire_execute',
      reason: `${state.pendingDesires} desires pending execution`,
      urgency: 'medium',
    });
  }

  if (state.unprocessedMemories > 0 && state.unprocessedMemories <= 10) {
    recommendations.push({
      task: 'memory_curate',
      reason: `${state.unprocessedMemories} memories need curation`,
      urgency: 'medium',
    });
  }

  // === LOW URGENCY / CIRCADIAN-AWARE ITEMS ===

  // Use circadian window to boost appropriate tasks
  const circadianTasks = state.circadianWindow?.recommendedTasks || [];

  if (state.hoursSinceDream > 8) {
    const urgency = circadianTasks.includes('dream') ? 'medium' : 'low';
    recommendations.push({
      task: 'dream',
      reason: `No dream in ${state.hoursSinceDream.toFixed(0)} hours` +
        (circadianTasks.includes('dream') ? ' (circadian: good time for dreams)' : ''),
      urgency,
    });
  }

  if (state.hoursSincePsychoanalysis > 24) {
    const urgency = circadianTasks.includes('psychoanalyze') ? 'medium' : 'low';
    recommendations.push({
      task: 'psychoanalyze',
      reason: `No psychoanalysis in ${state.hoursSincePsychoanalysis.toFixed(0)} hours` +
        (circadianTasks.includes('psychoanalyze') ? ' (circadian: night-time activity)' : ''),
      urgency,
    });
  }

  // Idle-aware curiosity (lizard brain: idle > 15 min = suggest curiosity)
  if (state.idleMinutes && state.idleMinutes > 15 && state.hoursSinceReflection > 1) {
    recommendations.push({
      task: 'curiosity',
      reason: `User idle for ${state.idleMinutes} minutes, good time for curiosity`,
      urgency: circadianTasks.includes('curiosity') ? 'medium' : 'low',
    });
  } else if (!state.userActive && state.hoursSinceReflection > 1) {
    recommendations.push({
      task: 'curiosity',
      reason: 'User inactive, good time for curiosity',
      urgency: 'low',
    });
  }

  // Circadian-recommended tasks that haven't been triggered yet
  for (const task of circadianTasks) {
    // Skip if already recommended
    if (recommendations.some((r) => r.task === task)) continue;

    // Add circadian recommendation with low urgency
    if (isTaskCircadianAppropriate(task)) {
      recommendations.push({
        task,
        reason: `Circadian: ${state.circadianWindow?.name} is good time for ${task}`,
        urgency: 'low',
      });
    }
  }

  recommendations.push({
    task: 'desire_generate',
    reason: 'Regular desire generation cycle',
    urgency: 'low',
  });

  // Sort by urgency
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return recommendations;
}
