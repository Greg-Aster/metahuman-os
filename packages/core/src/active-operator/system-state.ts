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
import { listActiveTasks } from '../memory.js';
import { loadPersonaCore } from '../identity.js';

/**
 * Generic/system tags that don't count as "meaningful" semantic tags.
 * Must match the organizer's logic exactly to avoid infinite loops.
 */
const GENERIC_TAGS = new Set(['ingested', 'inbox', 'ai', 'curated', 'audio', 'transcript']);

/**
 * Get count of memories that actually need processing.
 * IMPORTANT: This logic must match organizer/core.ts findUnprocessedMemories()
 * to avoid counting memories the organizer will skip.
 * Searches the full YYYY/MM/DD directory structure.
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
    if (!fs.statSync(yearDir).isDirectory()) continue;

    // Get months
    const months = fs.readdirSync(yearDir)
      .filter((f) => /^\d{2}$/.test(f) && fs.statSync(path.join(yearDir, f)).isDirectory());

    for (const month of months) {
      const monthDir = path.join(yearDir, month);

      // Get days
      const days = fs.readdirSync(monthDir)
        .filter((f) => /^\d{2}$/.test(f) && fs.statSync(path.join(monthDir, f)).isDirectory());

      for (const day of days) {
        const dayDir = path.join(monthDir, day);
        const files = fs.readdirSync(dayDir).filter((f) => f.endsWith('.json'));

        for (const file of files) {
          try {
            const filePath = path.join(dayDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const memory = JSON.parse(content);

            // Check if memory has only generic tags (no semantic enrichment)
            const hasOnlyGenericTags = memory.tags && memory.tags.length > 0 &&
              memory.tags.every((tag: string) => GENERIC_TAGS.has(tag.toLowerCase()));

            // Memory needs processing if:
            // NOT already processed AND (has no tags OR only generic tags) AND has no entities
            // This logic MUST match organizer/core.ts to avoid infinite loops
            const needsProcessing = (
              !memory.metadata?.processed &&
              (!memory.tags || memory.tags.length === 0 || hasOnlyGenericTags) &&
              (!memory.entities || memory.entities.length === 0)
            );

            if (needsProcessing) {
              count++;
            }
          } catch {
            // Skip malformed files
          }
        }
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
    const status = await getIndexStatus(undefined, username);
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
 * Get desire counts from the folder-based storage system.
 * This reads from the same source as the Agency UI (folders/[id]/manifest.json).
 *
 * Counts are categorized as:
 * - pending: nascent, pending (not yet ready for execution)
 * - active: evaluating, planning, executing (in progress)
 * - awaitingApproval: awaiting_approval (needs user action before approval)
 * - approved: approved (ready for autonomous execution!)
 *
 * @param username - The user profile to query (required for multi-user support)
 */
async function getDesireCounts(username: string): Promise<{
  pending: number;
  active: number;
  awaitingApproval: number;
  approved: number;
}> {
  try {
    // Use folder-based storage (same as Agency UI)
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const allDesires = await listDesiresFromFolders(username);

    let pending = 0;
    let active = 0;
    let awaitingApproval = 0;
    let approved = 0;

    for (const desire of allDesires) {
      switch (desire.status) {
        case 'pending':
        case 'nascent':
          pending++;
          break;
        case 'evaluating':
        case 'planning':
        case 'executing':
          active++;
          break;
        case 'reviewing':
        case 'awaiting_approval':
          // 'reviewing' desires are waiting for the review process to complete
          // and will transition to awaiting_approval - count them together
          awaitingApproval++;
          break;
        case 'approved':
          // READY FOR EXECUTION! These have been approved and can be run autonomously
          approved++;
          break;
        // completed, abandoned, rejected are not counted as actionable
      }
    }

    return { pending, active, awaitingApproval, approved };
  } catch (error) {
    console.warn('[system-state] Failed to get desire counts:', error);
    return { pending: 0, active: 0, awaitingApproval: 0, approved: 0 };
  }
}

// Cache desire counts within a single gatherSystemState call
// This prevents multiple queries to the storage system
let cachedDesireCounts: { pending: number; active: number; awaitingApproval: number; approved: number } | null = null;
let cacheUsername: string | null = null;

/**
 * Get count of pending desires (nascent + pending status).
 */
async function getPendingDesireCount(username: string): Promise<number> {
  if (!cachedDesireCounts || cacheUsername !== username) {
    cachedDesireCounts = await getDesireCounts(username);
    cacheUsername = username;
  }
  return cachedDesireCounts.pending;
}

/**
 * Get count of active desires (evaluating, planning, reviewing, executing).
 */
async function getActiveDesireCount(username: string): Promise<number> {
  if (!cachedDesireCounts || cacheUsername !== username) {
    cachedDesireCounts = await getDesireCounts(username);
    cacheUsername = username;
  }
  return cachedDesireCounts.active;
}

/**
 * Get count of desires awaiting user approval.
 */
async function getAwaitingApprovalDesireCount(username: string): Promise<number> {
  if (!cachedDesireCounts || cacheUsername !== username) {
    cachedDesireCounts = await getDesireCounts(username);
    cacheUsername = username;
  }
  return cachedDesireCounts.awaitingApproval;
}

/**
 * Get count of approved desires ready for autonomous execution.
 */
async function getApprovedDesireCount(username: string): Promise<number> {
  if (!cachedDesireCounts || cacheUsername !== username) {
    cachedDesireCounts = await getDesireCounts(username);
    cacheUsername = username;
  }
  return cachedDesireCounts.approved;
}

// ============================================================================
// Task Metrics
// ============================================================================

/**
 * Get task metrics for the Lizard Brain.
 * Returns counts of active, high-priority, and overdue tasks.
 */
function getTaskMetrics(): {
  activeTasks: number;
  highPriorityTasks: number;
  overdueTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
} {
  try {
    const tasks = listActiveTasks();
    const now = new Date();

    let highPriority = 0;
    let overdue = 0;
    let inProgress = 0;
    let blocked = 0;

    for (const task of tasks) {
      // High priority: P0 or P1
      if (task.priority === 'P0' || task.priority === 'P1') {
        highPriority++;
      }

      // Overdue: has due date in the past
      if (task.due) {
        const dueDate = new Date(task.due);
        if (dueDate < now && task.status !== 'done' && task.status !== 'cancelled') {
          overdue++;
        }
      }

      // Status counts
      if (task.status === 'in_progress') {
        inProgress++;
      } else if (task.status === 'blocked') {
        blocked++;
      }
    }

    return {
      activeTasks: tasks.length,
      highPriorityTasks: highPriority,
      overdueTasks: overdue,
      inProgressTasks: inProgress,
      blockedTasks: blocked,
    };
  } catch (error) {
    console.warn('[system-state] Failed to get task metrics:', error);
    return {
      activeTasks: 0,
      highPriorityTasks: 0,
      overdueTasks: 0,
      inProgressTasks: 0,
      blockedTasks: 0,
    };
  }
}

// ============================================================================
// Goal Metrics
// ============================================================================

/**
 * Get persona goal metrics for the Lizard Brain.
 * Returns counts of goals by tier and status.
 */
function getGoalMetrics(): {
  shortTermGoals: number;
  midTermGoals: number;
  longTermGoals: number;
  proposedGoals: number;
  activeGoals: number;
} {
  try {
    const persona = loadPersonaCore();
    const goals = persona?.goals || {};

    const shortTerm = goals.shortTerm || [];
    const midTerm = goals.midTerm || [];
    const longTerm = goals.longTerm || [];

    // Count proposed goals (awaiting user approval)
    let proposed = 0;
    let active = 0;

    for (const tier of [shortTerm, midTerm, longTerm]) {
      for (const goal of tier) {
        if (goal.status === 'proposed') {
          proposed++;
        } else if (goal.status === 'active' || goal.status === 'planning') {
          active++;
        }
      }
    }

    return {
      shortTermGoals: shortTerm.length,
      midTermGoals: midTerm.length,
      longTermGoals: longTerm.length,
      proposedGoals: proposed,
      activeGoals: active,
    };
  } catch (error) {
    console.warn('[system-state] Failed to get goal metrics:', error);
    return {
      shortTermGoals: 0,
      midTermGoals: 0,
      longTermGoals: 0,
      proposedGoals: 0,
      activeGoals: 0,
    };
  }
}

/**
 * Get hours since last event of a specific type.
 * Searches the full YYYY/MM/DD directory structure.
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

  yearLoop:
  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;

    // Get months, sorted in reverse (most recent first)
    const months = fs.readdirSync(yearDir)
      .filter((f) => /^\d{2}$/.test(f) && fs.statSync(path.join(yearDir, f)).isDirectory())
      .sort()
      .reverse();

    for (const month of months) {
      const monthDir = path.join(yearDir, month);

      // Get days, sorted in reverse (most recent first)
      const days = fs.readdirSync(monthDir)
        .filter((f) => /^\d{2}$/.test(f) && fs.statSync(path.join(monthDir, f)).isDirectory())
        .sort()
        .reverse();

      for (const day of days) {
        const dayDir = path.join(monthDir, day);
        const files = fs.readdirSync(dayDir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse();

        for (const file of files) {
          try {
            const filePath = path.join(dayDir, file);
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

            // Found one in most recent day, we can stop
            break yearLoop;
          } catch {
            // Skip malformed files
          }
        }
      }
    }
  }

  if (!latestTimestamp) {
    return 999;
  }

  const now = new Date();
  const diffMs = now.getTime() - latestTimestamp.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Get the most recent message timestamp from a conversation buffer file.
 * Returns null if file doesn't exist or has no messages.
 */
function getLastActivityFromBuffer(bufferPath: string): Date | null {
  if (!fs.existsSync(bufferPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(bufferPath, 'utf-8');
    const buffer = JSON.parse(content);
    const lastMessage = buffer.messages?.[buffer.messages.length - 1];

    if (!lastMessage?.timestamp) {
      return null;
    }

    return new Date(lastMessage.timestamp);
  } catch {
    return null;
  }
}

/**
 * Get idle time in minutes from conversation buffers.
 * Checks both conversation and inner dialogue buffers, using the most recent activity.
 */
function getIdleMinutes(username: string): number {
  const profilePaths = getProfilePaths(username);

  // Check both buffer files and use the most recent activity
  const conversationBuffer = path.join(profilePaths.state, 'conversation-buffer-conversation.json');
  const innerBuffer = path.join(profilePaths.state, 'conversation-buffer-inner.json');

  const conversationActivity = getLastActivityFromBuffer(conversationBuffer);
  const innerActivity = getLastActivityFromBuffer(innerBuffer);

  // Find the most recent activity across both buffers
  let lastActivity: Date | null = null;
  if (conversationActivity && innerActivity) {
    lastActivity = conversationActivity > innerActivity ? conversationActivity : innerActivity;
  } else {
    lastActivity = conversationActivity || innerActivity;
  }

  if (!lastActivity) {
    return 999; // Never active
  }

  const now = new Date();
  return (now.getTime() - lastActivity.getTime()) / (1000 * 60);
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
    activeDesires,
    awaitingApprovalDesires,
    approvedDesires,
    hoursSinceReflection,
    hoursSinceDream,
    hoursSincePsychoanalysis,
    codeErrors,
  ] = await Promise.all([
    getUnprocessedMemoryCount(username),
    getIndexAgeHours(username),
    getPendingDesireCount(username),
    getActiveDesireCount(username),
    getAwaitingApprovalDesireCount(username),
    getApprovedDesireCount(username),
    getHoursSinceEventType(username, 'inner_dialogue', ['idle-thought']),
    getHoursSinceEventType(username, 'dream'),
    getHoursSinceEventType(username, 'inner_dialogue', ['psychoanalysis']),
    getCodeErrorCount(),
  ]);

  // Synchronous lizard brain checks
  const idleMinutes = getIdleMinutes(username);
  const inboxFileCount = getInboxFileCount(username);

  // Get task and goal metrics
  const taskMetrics = getTaskMetrics();
  const goalMetrics = getGoalMetrics();

  return {
    gatheredAt: new Date().toISOString(),
    unprocessedMemories,
    indexAgeHours,
    pendingDesires,
    activeDesires,
    awaitingApprovalDesires,
    approvedDesires,
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
    // Task metrics
    activeTasks: taskMetrics.activeTasks,
    highPriorityTasks: taskMetrics.highPriorityTasks,
    overdueTasks: taskMetrics.overdueTasks,
    inProgressTasks: taskMetrics.inProgressTasks,
    blockedTasks: taskMetrics.blockedTasks,
    // Goal metrics
    shortTermGoals: goalMetrics.shortTermGoals,
    midTermGoals: goalMetrics.midTermGoals,
    longTermGoals: goalMetrics.longTermGoals,
    proposedGoals: goalMetrics.proposedGoals,
    activeGoals: goalMetrics.activeGoals,
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
    `⚡ Active desires: ${state.activeDesires}`,
    `🔔 Awaiting approval: ${state.awaitingApprovalDesires}`,
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

  // NOTE: index_build removed from automatic recommendations - user-triggered only
  // Index updates happen incrementally via appendEventToIndex when memories are saved

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

  // Desire system recommendations
  // HIGHEST PRIORITY: Approved desires ready for execution!
  if (state.approvedDesires > 0) {
    recommendations.push({
      task: 'desire_execute',
      reason: `🚀 ${state.approvedDesires} APPROVED desire(s) ready for autonomous execution!`,
      urgency: 'high', // Approved = user has blessed this, execute now!
    });
  }

  if (state.activeDesires > 0) {
    recommendations.push({
      task: 'desire_execute',
      reason: `${state.activeDesires} desires actively being processed`,
      urgency: 'high', // Active desires should be prioritized
    });
  } else if (state.pendingDesires > 0) {
    recommendations.push({
      task: 'desire_execute',
      reason: `${state.pendingDesires} desires ready for execution`,
      urgency: 'medium',
    });
  }

  if (state.awaitingApprovalDesires > 0) {
    // Don't recommend execution, but note it for the LLM
    recommendations.push({
      task: 'desire_execute',
      reason: `${state.awaitingApprovalDesires} desires awaiting user approval (requires user action)`,
      urgency: 'low', // Can't proceed without user
    });
  }

  // Only recommend memory_curate at medium if there are at least 5 unprocessed
  // (1-4 is too few to warrant attention - batch them up)
  if (state.unprocessedMemories >= 5 && state.unprocessedMemories <= 10) {
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

  // Desire generation - the system should actively create goals!
  // Priority based on whether the system has any desires at all
  const totalDesires = state.pendingDesires + state.activeDesires + state.awaitingApprovalDesires;
  if (totalDesires === 0) {
    // No desires at all - system has no goals! This is high priority.
    recommendations.push({
      task: 'desire_generate',
      reason: 'System has no active desires - needs goals to be proactive',
      urgency: 'high',
    });
  } else if (state.pendingDesires < 2 && state.activeDesires === 0) {
    // Few desires and none being worked on - generate more
    recommendations.push({
      task: 'desire_generate',
      reason: `Only ${state.pendingDesires} pending desires, should generate more goals`,
      urgency: 'medium',
    });
  } else {
    // Has some desires, regular cycle
    recommendations.push({
      task: 'desire_generate',
      reason: 'Regular desire generation cycle to maintain goal pipeline',
      urgency: 'low',
    });
  }

  // Sort by urgency
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return recommendations;
}
