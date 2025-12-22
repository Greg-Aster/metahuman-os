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
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths, systemPaths } from '../paths.js';
import { audit } from '../audit.js';
import { getFocusWindow } from '../connectors/calendar-connector.js';
import type { TaskType, Priority, QueuedTask } from './types.js';

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
    tasks: ['memory_curate', 'index_build', 'code_analyze'],
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
 * Check if user has been idle for a specified duration.
 */
async function checkIdle(username: string, idleThresholdMinutes: number = 15): Promise<TriggerResult> {
  const profilePaths = getProfilePaths(username);
  const bufferFile = path.join(profilePaths.state, `conversation-buffer-${username}.json`);

  if (!fs.existsSync(bufferFile)) {
    return { shouldTrigger: true, reason: 'No conversation history found', urgency: 'whenever' };
  }

  try {
    const content = fs.readFileSync(bufferFile, 'utf-8');
    const buffer = JSON.parse(content);
    const messages = buffer.messages || [];

    if (messages.length === 0) {
      return { shouldTrigger: true, reason: 'No messages in buffer', urgency: 'whenever' };
    }

    const lastMessage = messages[messages.length - 1];
    const lastActivity = new Date(lastMessage.timestamp);
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
  } catch {
    return { shouldTrigger: false };
  }
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

    if (unprocessedCount > 0) {
      return {
        shouldTrigger: true,
        reason: `${unprocessedCount} unprocessed memories need curation`,
        urgency: unprocessedCount > 10 ? 'immediate' : 'soon',
        data: { unprocessedCount },
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

// ============================================================================
// Index Staleness
// ============================================================================

/**
 * Check if vector index needs rebuilding.
 */
async function checkIndexStaleness(username: string): Promise<TriggerResult> {
  const profilePaths = getProfilePaths(username);
  const indexDir = path.join(profilePaths.root, 'memory', 'index');
  const metaFile = path.join(indexDir, 'meta.json');

  if (!fs.existsSync(metaFile)) {
    return {
      shouldTrigger: true,
      reason: 'Vector index has never been built',
      urgency: 'immediate',
    };
  }

  try {
    const content = fs.readFileSync(metaFile, 'utf-8');
    const meta = JSON.parse(content);
    const lastBuilt = new Date(meta.createdAt || meta.lastUpdated);
    const now = new Date();
    const hoursSince = (now.getTime() - lastBuilt.getTime()) / (1000 * 60 * 60);

    if (hoursSince > 24) {
      return {
        shouldTrigger: true,
        reason: `Vector index is ${Math.round(hoursSince)} hours old`,
        urgency: hoursSince > 48 ? 'immediate' : 'soon',
        data: { hoursSince: Math.round(hoursSince) },
      };
    }

    return { shouldTrigger: false };
  } catch {
    return {
      shouldTrigger: true,
      reason: 'Could not read index metadata',
      urgency: 'soon',
    };
  }
}

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
  {
    id: 'index_staleness',
    name: 'Index Staleness',
    description: 'Rebuild stale vector index',
    taskType: 'index_build',
    priority: 'normal',
    checkInterval: 300000, // 5 minutes
    condition: checkIndexStaleness,
  },
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
];

// ============================================================================
// Trigger Evaluation
// ============================================================================

/**
 * Evaluate all triggers and return tasks that should be queued.
 */
export async function evaluateTriggers(username: string): Promise<QueuedTask[]> {
  const tasks: QueuedTask[] = [];
  const now = new Date().toISOString();

  for (const trigger of TRIGGERS) {
    try {
      const result = await trigger.condition(username);

      if (result.shouldTrigger) {
        // Determine task type (circadian may override)
        let taskType = trigger.taskType;
        if (trigger.id === 'circadian_activity' && result.data) {
          const recommended = (result.data as any).recommendedTasks;
          if (recommended && recommended.length > 0) {
            taskType = recommended[0];
          }
        }

        // Determine priority based on urgency
        let priority = trigger.priority;
        if (result.urgency === 'immediate') {
          priority = 'high';
        } else if (result.urgency === 'whenever') {
          priority = 'background';
        }

        tasks.push({
          id: `trigger-${trigger.id}-${Date.now()}`,
          type: taskType,
          priority,
          queuedAt: now,
          username,
          payload: {
            type: 'trigger',
            triggerId: trigger.id,
            reason: result.reason,
            data: result.data,
          },
        });

        audit({
          category: 'system',
          level: 'info',
          event: 'lizard_brain_trigger',
          actor: 'active-operator',
          details: {
            triggerId: trigger.id,
            taskType,
            priority,
            reason: result.reason,
            username,
          },
        });
      }
    } catch (error) {
      console.error(`[lizard-brain] Error evaluating trigger ${trigger.id}:`, error);
    }
  }

  return tasks;
}

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
