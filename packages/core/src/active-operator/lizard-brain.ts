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
import type { TaskType, Priority, QueuedTask, TaskDecision } from './types.js';

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

/**
 * Candidate trigger info for LLM filtering.
 */
interface TriggerCandidate {
  triggerId: string;
  triggerName: string;
  taskType: TaskType;
  priority: Priority;
  reason: string;
  urgency: string;
  data?: unknown;
}

/**
 * Task descriptions for unified LLM decision prompt.
 */
const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  user_message: 'Process a user chat message (highest priority)',
  memory_curate: 'Run organizer to enrich memories with tags and entities',
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

// Tasks that are considered "quick" and can run when an event is approaching
const QUICK_TASKS: TaskType[] = ['reflect', 'inner_curiosity', 'memory_curate'];

/**
 * Unified LLM decision - evaluates triggers + queue + system state and decides what to execute.
 * This is the "merged" lizard brain that handles both trigger filtering AND task selection.
 */
export async function makeUnifiedDecision(
  username: string,
  currentQueue: readonly QueuedTask[],
  systemState: {
    unprocessedMemories: number;
    indexAgeHours: number;
    pendingDesires: number;
    hoursSinceReflection: number;
    userActive: boolean;
  },
  enabledTaskTypes: TaskType[],
  quickTasksOnly: boolean = false
): Promise<TaskDecision | null> {
  // Collect trigger candidates first
  const candidates: TriggerCandidate[] = [];

  for (const trigger of TRIGGERS) {
    // Skip calendar_focus_window - it's a constraint, not a task generator
    if (trigger.id === 'calendar_focus_window') {
      continue;
    }

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

        candidates.push({
          triggerId: trigger.id,
          triggerName: trigger.name,
          taskType,
          priority,
          reason: result.reason || 'Condition met',
          urgency: result.urgency || 'soon',
          data: result.data,
        });
      }
    } catch (error) {
      console.error(`[lizard-brain] Error evaluating trigger ${trigger.id}:`, error);
    }
  }

  // Get recent activity context
  const { getScratchpadContext } = await import('./state-persister.js');
  const recentActivity = getScratchpadContext(10);

  // Filter task types based on quick mode constraint
  let allowedTaskTypes = enabledTaskTypes.filter(
    (t: TaskType) => t !== 'user_message' && TASK_DESCRIPTIONS[t]
  );

  if (quickTasksOnly) {
    allowedTaskTypes = allowedTaskTypes.filter((t: TaskType) => QUICK_TASKS.includes(t));
    if (allowedTaskTypes.length === 0) {
      return null;
    }
  }

  // Format trigger list
  const triggerList = candidates.length > 0
    ? candidates.map((c) => `- [${c.urgency.toUpperCase()}] ${c.triggerName} → ${c.taskType}: ${c.reason}`).join('\n')
    : '(No triggers fired this cycle)';

  // Format queue list
  const queueList = currentQueue.length > 0
    ? currentQueue.slice(0, 5).map((t) => `- [${t.priority}] ${t.type}: queued ${Math.round((Date.now() - new Date(t.queuedAt).getTime()) / 60000)}m ago`).join('\n')
    : '(Queue is empty)';

  // Format task options
  const taskOptions = allowedTaskTypes
    .map((t: TaskType) => `- ${t}: ${TASK_DESCRIPTIONS[t]}`)
    .join('\n');

  // Build unified decision prompt
  const { callLLM } = await import('../model-router.js');

  const messages = [
    {
      role: 'system' as const,
      content: `You are the Lizard Brain for MetaHuman OS - the unified decision maker for autonomous behavior.

Your job is to look at:
1. Triggers that just fired (conditions detected)
2. Tasks already in queue
3. System state
4. Recent activity

And decide: What ONE task should I execute next?

Available Tasks:
${taskOptions}

Guidelines:
1. IMMEDIATE urgency triggers usually warrant action
2. Don't repeat tasks that ran recently (check recent activity)
3. Prioritize HIGH urgency items, but don't neglect maintenance
4. If queue has items, consider executing those before adding more
5. Balance reactive (triggers) with proactive (recommendations)
6. Consider system state - high unprocessed memories → memory_curate

Respond with JSON only: {"task": "<type>", "reasoning": "<why>"}
If nothing should run, respond: {"task": null, "reasoning": "<why waiting>"}`,
    },
    {
      role: 'user' as const,
      content: `=== TRIGGERS FIRED ===
${triggerList}

=== CURRENT QUEUE ===
${queueList}

=== SYSTEM STATE ===
- Unprocessed memories: ${systemState.unprocessedMemories}
- Index age: ${systemState.indexAgeHours.toFixed(1)} hours
- Pending desires: ${systemState.pendingDesires}
- Last reflection: ${systemState.hoursSinceReflection.toFixed(1)} hours ago
- User active: ${systemState.userActive ? 'Yes' : 'No'}

=== RECENT ACTIVITY ===
${recentActivity}

What should I do next?`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'orchestrator', // Use orchestrator for decision routing
      messages,
      userId: username,
      options: {
        maxTokens: 256,
        temperature: 0.2,
      },
    });

    // Parse response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Log the unified decision
      audit({
        category: 'system',
        level: 'info',
        event: 'lizard_brain_unified_decision',
        actor: 'active-operator',
        details: {
          triggerCount: candidates.length,
          queueLength: currentQueue.length,
          task: parsed.task,
          reasoning: parsed.reasoning,
          triggers: candidates.map((c) => c.triggerId),
        },
      });

      if (parsed.task && TASK_DESCRIPTIONS[parsed.task as TaskType]) {
        const { recordDecision } = await import('./state-persister.js');
        const decision: TaskDecision = {
          task: parsed.task as TaskType,
          reasoning: parsed.reasoning || 'No reasoning provided',
        };
        recordDecision(decision);
        return decision;
      }

      // Explicit null means wait
      if (parsed.task === null) {
        return null;
      }
    }

    // Fallback: if immediate triggers exist, run the first one
    const immediateTrigger = candidates.find((c) => c.urgency === 'immediate');
    if (immediateTrigger && allowedTaskTypes.includes(immediateTrigger.taskType)) {
      const { recordDecision } = await import('./state-persister.js');
      const decision: TaskDecision = {
        task: immediateTrigger.taskType,
        reasoning: `Fallback: ${immediateTrigger.reason}`,
      };
      recordDecision(decision);
      return decision;
    }

    return null;
  } catch (error) {
    console.error('[lizard-brain] Unified decision error:', error);
    return null;
  }
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
