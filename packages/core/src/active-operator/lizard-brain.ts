/**
 * Lizard Brain - Low-Level Triggers for Active Operator
 *
 * Provides primitive stimulus detection for autonomous behavior:
 * - Idle detection: User hasn't interacted recently
 * - Inbox monitoring: New files awaiting ingestion
 * - Circadian rhythm: Time-of-day appropriate activities
 * - Health watchdogs: System health checks
 *
 * These triggers suggest tasks to the Active Operator decision engine
 * rather than executing directly.
 *
 * ============================================================================
 * ARCHITECTURE NOTE (2024-12-23):
 * ============================================================================
 * The Lizard Brain is now executed via the cognitive graph system.
 * See: etc/cognitive-graphs/lizard-brain.json
 *
 * STILL IN USE (imported by graph nodes):
 * - TRIGGERS array → trigger-candidates.node.ts
 * - TriggerResult type → trigger-candidates.node.ts
 * - checkFocusConstraints() → service-manager.ts
 * - CIRCADIAN_WINDOWS, circadian helpers → various
 * - evaluateTrigger(), getTriggerStatuses() → API endpoints
 *
 * DEPRECATED (replaced by graph nodes):
 * - makeUnifiedDecision() → unified-decision-llm.node.ts
 * - TASK_DESCRIPTIONS → unified-decision-llm.node.ts
 * - QUICK_TASKS → not needed (graph handles this)
 * - TriggerCandidate interface → trigger-candidates.node.ts
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths } from '../paths.js';
import { getFocusWindow } from '../connectors/calendar-connector.js';
import type { TaskType, Priority } from './types.js';
// Note: QueuedTask, TaskDecision, SystemState, audit were used by makeUnifiedDecision (now deprecated)

// ============================================================================
// Types
// ============================================================================

export interface Trigger {
  id: string;
  name: string;
  description: string;
  taskType: TaskType;
  priority: Priority;
  checkInterval: number; // ms
  lastChecked?: string;
  lastTriggered?: string;
  condition: (username: string) => Promise<TriggerResult>;
}

export interface TriggerResult {
  shouldTrigger: boolean;
  reason?: string;
  urgency?: 'immediate' | 'soon' | 'whenever';
  data?: unknown;
}

export interface CircadianWindow {
  name: string;
  startHour: number; // 0-23
  endHour: number; // 0-23
  tasks: TaskType[];
  description: string;
}

// ============================================================================
// Circadian Configuration
// ============================================================================

/**
 * Time-of-day windows for different cognitive activities.
 * Based on natural human rhythms and appropriate activity types.
 */
export const CIRCADIAN_WINDOWS: CircadianWindow[] = [
  {
    name: 'night',
    startHour: 0,
    endHour: 6,
    tasks: ['dream', 'psychoanalyze'],
    description: 'Deep reflection and dreaming during sleep hours',
  },
  {
    name: 'early_morning',
    startHour: 6,
    endHour: 9,
    tasks: ['reflect', 'desire_generate'],
    description: 'Morning reflection and goal setting',
  },
  {
    name: 'morning',
    startHour: 9,
    endHour: 12,
    tasks: ['memory_curate', 'code_analyze'],
    description: 'Productive work hours - organization and maintenance',
  },
  {
    name: 'afternoon',
    startHour: 12,
    endHour: 17,
    tasks: ['curiosity', 'desire_execute'],
    description: 'Active engagement and curiosity',
  },
  {
    name: 'evening',
    startHour: 17,
    endHour: 21,
    tasks: ['reflect', 'inner_curiosity'],
    description: 'Evening reflection and inner exploration',
  },
  {
    name: 'late_night',
    startHour: 21,
    endHour: 24,
    tasks: ['dream', 'reflect'],
    description: 'Wind down with light reflection',
  },
];

// ============================================================================
// Idle Detection
// ============================================================================

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
    const messages = buffer.messages || [];

    if (messages.length === 0) {
      return null;
    }

    const lastMessage = messages[messages.length - 1];
    return new Date(lastMessage.timestamp);
  } catch {
    return null;
  }
}

/**
 * Check if user has been idle for a specified duration.
 * Checks both conversation and inner dialogue buffers, using the most recent activity.
 */
async function checkIdle(username: string, idleThresholdMinutes: number = 15): Promise<TriggerResult> {
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
    return { shouldTrigger: true, reason: 'No conversation history found', urgency: 'whenever' };
  }

  const now = new Date();
  const idleMinutes = (now.getTime() - lastActivity.getTime()) / (1000 * 60);

  if (idleMinutes >= idleThresholdMinutes) {
    return {
      shouldTrigger: true,
      reason: `User idle for ${Math.round(idleMinutes)} minutes`,
      urgency: idleMinutes > 60 ? 'whenever' : 'soon',
      data: { idleMinutes: Math.round(idleMinutes) },
    };
  }

  return { shouldTrigger: false };
}

// ============================================================================
// Inbox Monitoring
// ============================================================================

/**
 * Check for new files in the memory inbox.
 */
async function checkInbox(username: string): Promise<TriggerResult> {
  const profilePaths = getProfilePaths(username);
  const inboxDir = path.join(profilePaths.root, 'memory', 'inbox');

  if (!fs.existsSync(inboxDir)) {
    return { shouldTrigger: false };
  }

  try {
    const files = fs.readdirSync(inboxDir).filter((f) => {
      // Skip archive directory and hidden files
      if (f.startsWith('.') || f === '_archive') return false;
      const stat = fs.statSync(path.join(inboxDir, f));
      return stat.isFile();
    });

    if (files.length > 0) {
      return {
        shouldTrigger: true,
        reason: `${files.length} file(s) in inbox awaiting ingestion`,
        urgency: files.length > 5 ? 'immediate' : 'soon',
        data: { fileCount: files.length, files: files.slice(0, 5) },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// ============================================================================
// Circadian Rhythm
// ============================================================================

/**
 * Get the current circadian window.
 */
export function getCurrentCircadianWindow(): CircadianWindow {
  const hour = new Date().getHours();

  for (const window of CIRCADIAN_WINDOWS) {
    if (window.startHour <= hour && hour < window.endHour) {
      return window;
    }
    // Handle overnight window (e.g., 21-24 wraps to 0-6)
    if (window.startHour > window.endHour) {
      if (hour >= window.startHour || hour < window.endHour) {
        return window;
      }
    }
  }

  // Default to night if no match
  return CIRCADIAN_WINDOWS[0];
}

/**
 * Check if a task type is appropriate for the current time.
 */
export function isTaskCircadianAppropriate(taskType: TaskType): boolean {
  const window = getCurrentCircadianWindow();
  return window.tasks.includes(taskType);
}

/**
 * Get recommended tasks for the current circadian window.
 */
export function getCircadianRecommendations(): TaskType[] {
  const window = getCurrentCircadianWindow();
  return [...window.tasks];
}

/**
 * Check if it's time for a circadian-appropriate activity.
 */
async function checkCircadian(username: string): Promise<TriggerResult> {
  const window = getCurrentCircadianWindow();
  const hour = new Date().getHours();

  // Check if we're in a transition period (first 15 minutes of a window)
  const isTransition = new Date().getMinutes() < 15;

  if (isTransition) {
    return {
      shouldTrigger: true,
      reason: `Entering ${window.name} period - good time for ${window.tasks.join(', ')}`,
      urgency: 'soon',
      data: {
        window: window.name,
        recommendedTasks: window.tasks,
        hour,
      },
    };
  }

  return { shouldTrigger: false };
}

// ============================================================================
// Memory Staleness
// ============================================================================

/**
 * Check if memories need processing.
 */
async function checkMemoryStaleness(username: string): Promise<TriggerResult> {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;

  if (!fs.existsSync(episodicDir)) {
    return { shouldTrigger: false };
  }

  try {
    let unprocessedCount = 0;
    const years = fs.readdirSync(episodicDir).filter((f) => /^\d{4}$/.test(f));

    for (const year of years) {
      const yearDir = path.join(episodicDir, year);
      const files = fs.readdirSync(yearDir).filter((f) => f.endsWith('.json'));

      for (const file of files.slice(-50)) {
        // Check last 50 files
        try {
          const content = fs.readFileSync(path.join(yearDir, file), 'utf-8');
          const memory = JSON.parse(content);
          if (!memory.metadata?.processed) {
            unprocessedCount++;
          }
        } catch {
          // Skip malformed files
        }
      }
    }

    // Require at least 5 unprocessed memories before triggering curation
    // This prevents constant triggering for every single new memory
    const CURATION_THRESHOLD = 5;
    if (unprocessedCount >= CURATION_THRESHOLD) {
      return {
        shouldTrigger: true,
        reason: `${unprocessedCount} unprocessed memories need curation (threshold: ${CURATION_THRESHOLD})`,
        urgency: unprocessedCount > 10 ? 'immediate' : 'soon',
        data: { unprocessedCount, threshold: CURATION_THRESHOLD },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// ============================================================================
// Failed Agent Retry
// ============================================================================

/**
 * Check for recently failed agent runs that might benefit from retry.
 */
async function checkFailedAgents(username: string): Promise<TriggerResult> {
  const profilePaths = getProfilePaths(username);
  const stateDir = path.join(profilePaths.state, 'agent-failures');

  if (!fs.existsSync(stateDir)) {
    return { shouldTrigger: false };
  }

  try {
    const files = fs.readdirSync(stateDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    if (files.length === 0) {
      return { shouldTrigger: false };
    }

    // Check failures from last hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentFailures: { agent: string; error: string; timestamp: string }[] = [];

    for (const file of files.slice(0, 10)) {
      try {
        const content = fs.readFileSync(path.join(stateDir, file), 'utf-8');
        const failure = JSON.parse(content);
        const failureTime = new Date(failure.timestamp).getTime();

        if (failureTime > oneHourAgo && !failure.retried) {
          recentFailures.push({
            agent: failure.agent,
            error: failure.error,
            timestamp: failure.timestamp,
          });
        }
      } catch {
        // Skip malformed files
      }
    }

    if (recentFailures.length > 0) {
      return {
        shouldTrigger: true,
        reason: `${recentFailures.length} agent(s) failed recently and may benefit from retry`,
        urgency: recentFailures.length > 3 ? 'immediate' : 'soon',
        data: {
          failureCount: recentFailures.length,
          agents: recentFailures.map((f) => f.agent),
        },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// NOTE: Index staleness check removed - index_build is now user-triggered only
// Incremental index updates happen via appendEventToIndex when memories are saved

// ============================================================================
// Calendar Focus Window
// ============================================================================

/**
 * Check if user is in or approaching a calendar focus window.
 * This is a NEGATIVE trigger - it suggests NOT doing tasks during focus time.
 */
async function checkCalendarFocusWindow(username: string): Promise<TriggerResult> {
  try {
    const focusWindow = await getFocusWindow(username);

    if (focusWindow.active) {
      // User is currently in a meeting/event
      return {
        shouldTrigger: true,
        reason: focusWindow.recommendation,
        urgency: 'immediate',
        data: {
          inFocusWindow: true,
          currentEvent: focusWindow.currentEvent,
          recommendation: 'pause', // Signal to pause autonomous tasks
        },
      };
    }

    if (focusWindow.nextEvent && focusWindow.minutesUntilNextEvent !== undefined) {
      const minutes = focusWindow.minutesUntilNextEvent;

      // If next event is within 10 minutes, signal to wrap up
      if (minutes <= 10) {
        return {
          shouldTrigger: true,
          reason: `Event "${focusWindow.nextEvent.title}" starting in ${minutes} minutes - wrap up current task`,
          urgency: 'immediate',
          data: {
            inFocusWindow: false,
            approachingEvent: true,
            minutesUntil: minutes,
            nextEvent: focusWindow.nextEvent,
            recommendation: 'wrap_up',
          },
        };
      }

      // If next event is within 30 minutes, avoid starting long tasks
      if (minutes <= 30) {
        return {
          shouldTrigger: true,
          reason: `Event "${focusWindow.nextEvent.title}" in ${minutes} minutes - prefer quick tasks`,
          urgency: 'soon',
          data: {
            inFocusWindow: false,
            approachingEvent: true,
            minutesUntil: minutes,
            nextEvent: focusWindow.nextEvent,
            recommendation: 'quick_tasks_only',
          },
        };
      }
    }

    // No focus constraints
    return { shouldTrigger: false };
  } catch (error) {
    // Calendar not configured or error - don't block
    return { shouldTrigger: false };
  }
}

// ============================================================================
// Desire System Triggers
// ============================================================================

const EXPLORATION_THRESHOLD = 0.5; // Lower than activation (0.7) - explore early

/**
 * Check if any desires need exploration (research + smart questions).
 * Fires for pending desires that have crossed the exploration threshold
 * but haven't been explored yet.
 */
async function checkDesiresNeedExploration(username: string): Promise<TriggerResult> {
  try {
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const allDesires = await listDesiresFromFolders(username);

    // Find pending/evaluating desires above exploration threshold that haven't been explored
    const needsExploration = allDesires.filter(d => {
      // Must be in pending or evaluating status
      if (d.status !== 'pending' && d.status !== 'evaluating') {
        return false;
      }
      // Must be above exploration threshold
      if ((d.strength || 0) < EXPLORATION_THRESHOLD) {
        return false;
      }
      // Must not already have exploration research (stored by desire-explorer agent)
      // Using type assertion since explorationResearch is dynamically added
      const desireAny = d as any;
      if (desireAny.metadata?.explorationResearch) {
        return false;
      }
      // Must not already have clarifying questions
      if (d.clarifyingQuestions?.questions && d.clarifyingQuestions.questions.length > 0) {
        return false;
      }
      return true;
    });

    if (needsExploration.length > 0) {
      return {
        shouldTrigger: true,
        reason: `🔍 ${needsExploration.length} desire(s) need exploration/research`,
        urgency: 'soon',
        data: {
          count: needsExploration.length,
          desireIds: needsExploration.map(d => d.id),
          titles: needsExploration.map(d => d.title),
        },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

/**
 * Check if any APPROVED desires are ready for execution.
 * Only fires for desires that have been approved (by user or auto-approval).
 */
async function checkDesiresReadyForExecution(username: string): Promise<TriggerResult> {
  try {
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const allDesires = await listDesiresFromFolders(username);

    // APPROVED desires are the ONLY ones ready for execution via Big Brother!
    const approvedDesires = allDesires.filter(d => d.status === 'approved');

    if (approvedDesires.length > 0) {
      return {
        shouldTrigger: true,
        reason: `🚀 ${approvedDesires.length} APPROVED desire(s) ready for execution!`,
        urgency: 'immediate',
        data: { approvedCount: approvedDesires.length, desireIds: approvedDesires.map(d => d.id) },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// Track recently advanced desires to prevent loop re-triggering
// Maps desireId -> timestamp of last advancement attempt
const recentAdvancementAttempts = new Map<string, number>();
const ADVANCEMENT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown per desire
const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes = stuck

/**
 * Check if any desires need to be advanced through the approval pipeline.
 *
 * IMPORTANT: This trigger is ONLY for pending/nascent desires that need to
 * START the pipeline (move to planning). Desires already IN the pipeline
 * (planning, reviewing) are handled by their respective agents, not by
 * re-triggering desire_advance.
 *
 * Fires for:
 * 1. Pending/nascent desires that have crossed the activation threshold
 *    AND have not been recently attempted (cooldown prevents loops)
 * 2. In-pipeline desires ONLY if they appear stuck (no progress for 30+ minutes)
 */
async function checkDesiresNeedAdvancement(username: string): Promise<TriggerResult> {
  try {
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const { loadConfig } = await import('../agency/config.js');
    const allDesires = await listDesiresFromFolders(username);
    const config = await loadConfig(username);
    const now = Date.now();

    // Clean up old cooldown entries
    for (const [id, timestamp] of recentAdvancementAttempts.entries()) {
      if (now - timestamp > ADVANCEMENT_COOLDOWN_MS) {
        recentAdvancementAttempts.delete(id);
      }
    }

    // Get pending/nascent desires that are above the activation threshold
    // AND not on cooldown from recent advancement attempt
    const pendingDesires = allDesires.filter(d =>
      (d.status === 'pending' || d.status === 'nascent') &&
      d.strength >= config.thresholds.activation &&
      !recentAdvancementAttempts.has(d.id)
    );

    // Get desires in active pipeline stages - but ONLY trigger if they appear STUCK
    // (no updatedAt change in 30+ minutes). Normal pipeline flow is handled by agents.
    const activeStages = ['evaluating', 'planning', 'reviewing'];
    const stuckDesires = allDesires.filter(d => {
      if (!activeStages.includes(d.status)) return false;
      if (recentAdvancementAttempts.has(d.id)) return false; // On cooldown

      // Check if stuck (no update in 30+ minutes)
      const updatedAt = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
      const timeSinceUpdate = now - updatedAt;
      return timeSinceUpdate > STUCK_THRESHOLD_MS;
    });

    // Check for desires awaiting approval (info only, don't trigger - user must approve)
    const awaitingApproval = allDesires.filter(d => d.status === 'awaiting_approval');

    // Also track in-pipeline desires that are NOT stuck (for info)
    const activeNotStuck = allDesires.filter(d =>
      activeStages.includes(d.status) && !stuckDesires.some(s => s.id === d.id)
    );

    // Only trigger if there are pending desires ready OR stuck desires
    // In-pipeline desires that are progressing normally should NOT trigger
    const desiresToAdvance = [...pendingDesires, ...stuckDesires];

    if (desiresToAdvance.length > 0) {
      const reasons: string[] = [];
      if (pendingDesires.length > 0) {
        reasons.push(`${pendingDesires.length} pending ready for activation`);
      }
      if (stuckDesires.length > 0) {
        const stuckInfo = stuckDesires.map(d => `"${d.title}" (${d.status})`).join(', ');
        reasons.push(`${stuckDesires.length} STUCK in pipeline: ${stuckInfo}`);
      }

      // Mark these desires as attempted to prevent immediate re-triggering
      for (const d of desiresToAdvance) {
        recentAdvancementAttempts.set(d.id, now);
      }

      return {
        shouldTrigger: true,
        reason: `📋 ${desiresToAdvance.length} desire(s) need advancement: ${reasons.join('; ')}`,
        urgency: stuckDesires.length > 0 ? 'immediate' : 'soon',
        data: {
          pendingCount: pendingDesires.length,
          stuckCount: stuckDesires.length,
          desireIds: desiresToAdvance.map(d => d.id),
          activationThreshold: config.thresholds.activation,
        },
      };
    }

    // Info about desires awaiting approval (don't trigger, but inform)
    if (awaitingApproval.length > 0) {
      return {
        shouldTrigger: false,
        reason: `⏳ ${awaitingApproval.length} desire(s) awaiting user approval`,
        urgency: 'whenever',
        data: { awaitingCount: awaitingApproval.length, requiresUserAction: true },
      };
    }

    // Info about in-pipeline desires progressing normally (don't trigger)
    if (activeNotStuck.length > 0) {
      return {
        shouldTrigger: false,
        reason: `🔄 ${activeNotStuck.length} desire(s) progressing in pipeline (no intervention needed)`,
        urgency: 'whenever',
        data: { inProgressCount: activeNotStuck.length, status: 'progressing' },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

/**
 * Check if any executed desires need outcome review.
 * These are desires in 'awaiting_review' status that need the outcome reviewer
 * to determine: retry, escalate, complete, or abandon.
 */
async function checkDesiresNeedReview(username: string): Promise<TriggerResult> {
  try {
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const allDesires = await listDesiresFromFolders(username);

    // Get desires awaiting outcome review (post-execution)
    const awaitingReview = allDesires.filter(d => d.status === 'awaiting_review');

    if (awaitingReview.length > 0) {
      // Prioritize failed executions
      const failed = awaitingReview.filter(d =>
        d.execution?.status === 'failed' || d.currentStage === 'failed'
      );
      const succeeded = awaitingReview.filter(d =>
        d.execution?.status === 'completed' && d.currentStage !== 'failed'
      );

      const urgency = failed.length > 0 ? 'immediate' : 'soon';
      const reasons: string[] = [];
      if (failed.length > 0) {
        reasons.push(`${failed.length} FAILED (need retry/escalate decision)`);
      }
      if (succeeded.length > 0) {
        reasons.push(`${succeeded.length} completed (need verification)`);
      }

      return {
        shouldTrigger: true,
        reason: `🔍 ${awaitingReview.length} desire(s) need outcome review: ${reasons.join('; ')}`,
        urgency,
        data: {
          awaitingReviewCount: awaitingReview.length,
          failedCount: failed.length,
          succeededCount: succeeded.length,
          desireIds: awaitingReview.map(d => d.id),
        },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

/**
 * Check if the system needs to generate new desires.
 * Uses folder-based storage (same as Agency UI).
 */
async function checkNeedsDesireGeneration(username: string): Promise<TriggerResult> {
  try {
    const { listDesiresFromFolders } = await import('../agency/storage.js');
    const allDesires = await listDesiresFromFolders(username);

    // Count actionable desires (not completed/abandoned/rejected)
    const activeStatuses = ['evaluating', 'planning', 'reviewing', 'executing'];
    const pendingStatuses = ['pending', 'nascent'];

    const activeDesires = allDesires.filter(d => activeStatuses.includes(d.status));
    const pendingDesires = allDesires.filter(d => pendingStatuses.includes(d.status));
    const awaitingApproval = allDesires.filter(d => d.status === 'awaiting_approval');

    const totalActionable = activeDesires.length + pendingDesires.length + awaitingApproval.length;

    if (totalActionable === 0) {
      return {
        shouldTrigger: true,
        reason: 'No active desires - system needs goals to be proactive',
        urgency: 'soon',
        data: { totalDesires: 0, needsGeneration: true },
      };
    }

    // If we have very few pending desires, suggest generating more
    if (pendingDesires.length < 2 && activeDesires.length === 0) {
      return {
        shouldTrigger: true,
        reason: `Only ${pendingDesires.length} pending desire(s) - should generate more goals`,
        urgency: 'whenever',
        data: { pendingCount: pendingDesires.length, needsGeneration: true },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// ============================================================================
// Help Ticket System Trigger
// ============================================================================

/**
 * Check if help tickets need review.
 * Triggered by user negative feedback to drive system self-improvement.
 */
async function checkHelpTickets(username: string): Promise<TriggerResult> {
  try {
    // Dynamic import to avoid circular dependency
    const { shouldReviewTickets } = await import('../help-tickets/index.js');
    const result = shouldReviewTickets(username);

    if (result.shouldRun) {
      return {
        shouldTrigger: true,
        reason: result.reason,
        urgency: result.urgentCount > 0 ? 'immediate' : 'soon',
        data: {
          ticketCount: result.ticketCount,
          urgentCount: result.urgentCount,
        },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return { shouldTrigger: false };
  }
}

// ============================================================================
// Trigger Registry
// ============================================================================

/**
 * All available triggers.
 */
export const TRIGGERS: Trigger[] = [
  {
    id: 'idle_reflection',
    name: 'Idle Reflection',
    description: 'Trigger reflection when user is idle',
    taskType: 'reflect',
    priority: 'low',
    checkInterval: 60000, // 1 minute
    condition: (username) => checkIdle(username, 15),
  },
  {
    id: 'idle_curiosity',
    name: 'Idle Curiosity',
    description: 'Trigger curiosity when user is idle longer',
    taskType: 'curiosity',
    priority: 'low',
    checkInterval: 120000, // 2 minutes
    condition: (username) => checkIdle(username, 30),
  },
  {
    id: 'idle_inner_curiosity',
    name: 'Inner Curiosity',
    description: 'Trigger inner curiosity (self-directed questions) when user is idle',
    taskType: 'inner_curiosity',
    priority: 'low',
    checkInterval: 180000, // 3 minutes
    condition: (username) => checkIdle(username, 45), // 45 min idle threshold
  },
  {
    id: 'idle_curation',
    name: 'Idle Training Curation',
    description: 'Curate memories for training data when user is idle',
    taskType: 'training_curate',
    priority: 'low',
    checkInterval: 600000, // 10 minutes (matches agents.json inactivityThreshold)
    condition: (username) => checkIdle(username, 10), // 10 min idle threshold
  },
  {
    id: 'inbox_ingestion',
    name: 'Inbox Ingestion',
    description: 'Process new files in inbox',
    taskType: 'memory_curate',
    priority: 'normal',
    checkInterval: 30000, // 30 seconds
    condition: checkInbox,
  },
  {
    id: 'circadian_activity',
    name: 'Circadian Activity',
    description: 'Suggest activities based on time of day',
    taskType: 'reflect', // Will be overridden based on window
    priority: 'low',
    checkInterval: 300000, // 5 minutes
    condition: checkCircadian,
  },
  {
    id: 'memory_staleness',
    name: 'Memory Staleness',
    description: 'Process unprocessed memories',
    taskType: 'memory_curate',
    priority: 'normal',
    checkInterval: 60000, // 1 minute
    condition: checkMemoryStaleness,
  },
  // NOTE: index_build removed from automatic triggers - user-triggered only
  // Index updates happen incrementally via appendEventToIndex when memories are saved
  {
    id: 'failed_agent_retry',
    name: 'Failed Agent Retry',
    description: 'Retry agents that failed recently',
    taskType: 'memory_curate', // Default, will be overridden based on failed agent
    priority: 'normal',
    checkInterval: 120000, // 2 minutes
    condition: checkFailedAgents,
  },
  {
    id: 'calendar_focus_window',
    name: 'Calendar Focus Window',
    description: 'Detect when user is in or approaching a calendar event',
    taskType: 'reflect', // Placeholder - this trigger signals constraints, not a task to run
    priority: 'critical', // Focus window constraints are high priority
    checkInterval: 60000, // 1 minute
    condition: checkCalendarFocusWindow,
  },
  // === DESIRE SYSTEM TRIGGERS ===
  {
    id: 'desire_exploration',
    name: 'Desire Exploration',
    description: 'Research desires and generate smart questions before planning',
    taskType: 'desire_explore',
    priority: 'normal',
    checkInterval: 120000, // 2 minutes - less frequent than advancement
    condition: checkDesiresNeedExploration,
  },
  {
    id: 'desire_advancement',
    name: 'Desire Advancement',
    description: 'Advance pending desires through planning/review/approval',
    taskType: 'desire_advance',
    priority: 'normal',
    checkInterval: 60000, // 1 minute
    condition: checkDesiresNeedAdvancement,
  },
  {
    id: 'desire_execution',
    name: 'Desire Execution',
    description: 'Execute APPROVED desires only',
    taskType: 'desire_execute',
    priority: 'high', // Higher priority than advancement
    checkInterval: 60000, // 1 minute
    condition: checkDesiresReadyForExecution,
  },
  {
    id: 'desire_review',
    name: 'Desire Outcome Review',
    description: 'Review execution outcomes to determine: retry, escalate, complete, or abandon',
    taskType: 'desire_review',
    priority: 'high', // Must process failures quickly for retry/escalate
    checkInterval: 60000, // 1 minute
    condition: checkDesiresNeedReview,
  },
  {
    id: 'desire_generation',
    name: 'Desire Generation',
    description: 'Generate new desires when none exist',
    taskType: 'desire_generate',
    priority: 'low',
    checkInterval: 300000, // 5 minutes
    condition: checkNeedsDesireGeneration,
  },
  // === HELP TICKET SYSTEM ===
  {
    id: 'help_ticket_review',
    name: 'Help Ticket Review',
    description: 'Review user feedback tickets and propose fixes',
    taskType: 'help_ticket_review',
    priority: 'high', // User feedback is important
    checkInterval: 300000, // 5 minutes
    condition: checkHelpTickets,
  },
];

// ============================================================================
// Trigger Evaluation
// ============================================================================

/**
 * Check if we're in a focus window that should pause autonomous tasks.
 * Returns constraint info if active, null otherwise.
 */
export async function checkFocusConstraints(username: string): Promise<{
  shouldPause: boolean;
  quickTasksOnly: boolean;
  reason: string;
  minutesUntilEvent?: number;
} | null> {
  try {
    const result = await checkCalendarFocusWindow(username);
    if (!result.shouldTrigger) {
      return null;
    }

    const data = result.data as any;
    if (data?.recommendation === 'pause') {
      return {
        shouldPause: true,
        quickTasksOnly: false,
        reason: result.reason || 'In focus window',
      };
    } else if (data?.recommendation === 'wrap_up') {
      return {
        shouldPause: true,
        quickTasksOnly: false,
        reason: result.reason || 'Event approaching',
        minutesUntilEvent: data?.minutesUntil,
      };
    } else if (data?.recommendation === 'quick_tasks_only') {
      return {
        shouldPause: false,
        quickTasksOnly: true,
        reason: result.reason || 'Event soon, prefer quick tasks',
        minutesUntilEvent: data?.minutesUntil,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// DEPRECATED CODE - Now handled by lizard-brain.json graph
// ============================================================================
// The following code has been replaced by graph nodes:
// - TriggerCandidate → trigger-candidates.node.ts
// - TASK_DESCRIPTIONS → unified-decision-llm.node.ts
// - QUICK_TASKS → graph handles quickTasksOnly via focus constraints
// - makeUnifiedDecision() → unified-decision-llm.node.ts + task-execution.node.ts
//
// Keeping commented out for reference during transition period.
// Can be fully removed once graph-based system is verified stable.
// ============================================================================

/*
interface TriggerCandidate {
  triggerId: string;
  triggerName: string;
  taskType: TaskType;
  priority: Priority;
  reason: string;
  urgency: string;
  data?: unknown;
}

const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  user_message: 'Process a user chat message (highest priority)',
  memory_curate: 'Run organizer to enrich memories with tags and entities',
  training_curate: 'Run curator to prepare memories for LoRA training data',
  index_build: 'Build/update vector embeddings index for semantic search',
  reflect: 'Generate internal reflections using associative memory chains',
  curiosity: 'Generate user-facing curiosity questions',
  inner_curiosity: 'Generate and answer internal curiosity questions',
  dream: 'Create surreal dreams from memory fragments',
  desire_generate: 'Generate new desires from goals, tasks, and memories',
  desire_execute: 'Execute a pending desire that reached activation threshold',
  psychoanalyze: 'Run psychoanalyzer to update persona based on memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
};

const QUICK_TASKS: TaskType[] = ['reflect', 'inner_curiosity', 'memory_curate'];

export async function makeUnifiedDecision(
  username: string,
  currentQueue: readonly QueuedTask[],
  systemState: SystemState,
  enabledTaskTypes: TaskType[],
  quickTasksOnly: boolean = false
): Promise<TaskDecision | null> {
  // ... implementation moved to unified-decision-llm.node.ts
  // The graph now handles:
  // 1. trigger_candidates node - evaluates TRIGGERS
  // 2. current_queue node - gets queue state
  // 3. system_state node - gathers metrics
  // 4. scratchpad_context node - loads recent activity
  // 5. unified_decision_llm node - LLM decision
  // 6. task_execution node - runs the task
  // 7. audit_logger, inner_dialogue_capture, tts nodes - side effects
  throw new Error('makeUnifiedDecision is deprecated - use lizard-brain.json graph via service-manager');
}
*/

/**
 * Evaluate a specific trigger by ID.
 */
export async function evaluateTrigger(triggerId: string, username: string): Promise<TriggerResult | null> {
  const trigger = TRIGGERS.find((t) => t.id === triggerId);
  if (!trigger) {
    return null;
  }

  try {
    return await trigger.condition(username);
  } catch (error) {
    console.error(`[lizard-brain] Error evaluating trigger ${triggerId}:`, error);
    return null;
  }
}

/**
 * Get all trigger statuses.
 */
export function getTriggerStatuses(): { id: string; name: string; lastChecked?: string; lastTriggered?: string }[] {
  return TRIGGERS.map((t) => ({
    id: t.id,
    name: t.name,
    lastChecked: t.lastChecked,
    lastTriggered: t.lastTriggered,
  }));
}
