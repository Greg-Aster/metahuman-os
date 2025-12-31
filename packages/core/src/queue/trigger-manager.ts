/**
 * Trigger Manager
 *
 * Manages all agent triggers:
 * - Interval-based (runs every X seconds)
 * - Time-of-day (runs at specific time)
 * - Activity-based (runs after X seconds of inactivity)
 * - Event-based (triggered by external events)
 *
 * When triggers fire, tasks are enqueued via UnifiedQueueManager.
 * Replaces the trigger logic from AgentScheduler.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { UnifiedQueueManager } from './unified-queue-manager.js';
import { TaskType, Priority, TaskInput } from './types.js';
import { systemPaths } from '../path-builder.js';
import { storageClient } from '../storage-client.js';
import { audit } from '../audit.js';
import {
  recordSystemActivity,
  readSystemActivityTimestamp,
  readLastActiveUsername,
} from '../system-activity.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type TriggerType = 'interval' | 'time-of-day' | 'event' | 'activity' | 'manual';

export interface AgentTriggerConfig {
  id: string;
  enabled: boolean;
  type: TriggerType;
  priority: 'low' | 'normal' | 'high';
  agentPath?: string;
  usesLLM?: boolean;

  // Interval-based config
  interval?: number; // Seconds

  // Time-of-day config
  schedule?: string; // HH:MM format

  // Activity-based config
  inactivityThreshold?: number; // Seconds

  // Event-based config
  eventPattern?: string;
  debounce?: number; // Seconds

  // Behavior
  runOnBoot?: boolean;
  autoRestart?: boolean;
  maxRetries?: number;

  // Conditions
  conditions?: {
    requiresSleepMode?: boolean;
    [key: string]: any;
  };
}

export interface TriggerManagerConfig {
  version: string;
  globalSettings: {
    pauseAll: boolean;
    quietHours?: {
      enabled: boolean;
      start: string; // HH:MM
      end: string; // HH:MM
    };
    pauseQueueOnActivity: boolean;
    activityResumeDelay: number; // Seconds
  };
  agents: Record<string, AgentTriggerConfig>;
}

interface TriggerState {
  config: AgentTriggerConfig;
  timerId?: NodeJS.Timeout;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
}

// Map agent IDs to task types
const AGENT_TASK_MAP: Record<string, TaskType> = {
  organizer: 'memory_curate',
  curator: 'training_curate',
  reflector: 'reflect',
  curiosity: 'curiosity',
  'curiosity-researcher': 'inner_curiosity',
  'inner-curiosity': 'inner_curiosity',
  dreamer: 'dream',
  'night-pipeline': 'dream',
  psychoanalyzer: 'psychoanalyze',
  'desire-generator': 'desire_generate',
  'desire-executor': 'desire_execute',
  'desire-planner': 'desire_generate',
  'desire-outcome-reviewer': 'desire_generate',
  'auto-indexer': 'index_build',
};

// ============================================================================
// Trigger Manager
// ============================================================================

export class TriggerManager extends EventEmitter {
  private queueManager: UnifiedQueueManager;
  private config: TriggerManagerConfig | null = null;
  private triggers: Map<string, TriggerState> = new Map();
  private running: boolean = false;

  // Activity tracking
  private activityTimer?: NodeJS.Timeout;
  private lastActivity: Date = new Date();
  private lastActiveUsername: string | null = null;

  // Queue pause for user activity
  private queuePaused: boolean = false;
  private queueResumeTimer?: NodeJS.Timeout;

  constructor(queueManager: UnifiedQueueManager) {
    super();
    this.queueManager = queueManager;
  }

  /**
   * Get config file path
   */
  private get configPath(): string {
    const result = storageClient.resolvePath({
      category: 'config',
      subcategory: 'etc',
      relativePath: 'agents.json',
    });
    return result.success && result.path
      ? result.path
      : path.join(systemPaths.etc, 'agents.json');
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Load configuration from etc/agents.json
   */
  loadConfig(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn('[TriggerManager] No agents.json found, using defaults');
        this.config = this.getDefaultConfig();
        return false;
      }

      const data = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(data);

      audit({
        level: 'info',
        category: 'system',
        event: 'trigger_config_loaded',
        actor: 'trigger_manager',
        details: {
          agentCount: this.config ? Object.keys(this.config.agents).length : 0,
          pauseAll: this.config?.globalSettings.pauseAll ?? false,
        },
      });

      return true;
    } catch (error) {
      console.error('[TriggerManager] Failed to load config:', error);
      this.config = this.getDefaultConfig();
      return false;
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): TriggerManagerConfig {
    return {
      version: '1.0.0',
      globalSettings: {
        pauseAll: false,
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
        },
        pauseQueueOnActivity: true,
        activityResumeDelay: 60,
      },
      agents: {},
    };
  }

  /**
   * Reload configuration (hot reload support)
   */
  reloadConfig(): boolean {
    const wasRunning = this.running;

    if (wasRunning) {
      this.stop();
    }

    const success = this.loadConfig();

    if (wasRunning) {
      this.start();
    }

    return success;
  }

  // ==========================================================================
  // Lifecycle Management
  // ==========================================================================

  /**
   * Start the trigger manager
   */
  start(): boolean {
    try {
      if (this.running) {
        console.warn('[TriggerManager] Already running');
        return false;
      }

      if (!this.config) {
        this.loadConfig();
      }

      // Initialize trigger states from config
      if (this.config) {
        for (const [agentId, agentConfig] of Object.entries(this.config.agents)) {
          this.triggers.set(agentId, {
            config: agentConfig,
            runCount: 0,
            errorCount: 0,
          });
        }
      }

      this.running = true;
      this.syncLastActivityFromDisk();

      audit({
        level: 'info',
        category: 'system',
        event: 'trigger_manager_started',
        actor: 'trigger_manager',
        details: {
          triggerCount: this.triggers.size,
          pauseAll: this.config?.globalSettings.pauseAll,
        },
      });

      // Schedule all enabled triggers
      for (const [agentId, state] of this.triggers.entries()) {
        if (state.config.enabled && state.config.type !== 'manual') {
          this.scheduleTrigger(agentId);
        }
      }

      // Start activity monitoring
      this.startActivityMonitoring();

      console.log(`[TriggerManager] Started with ${this.triggers.size} triggers`);
      return true;
    } catch (error) {
      console.error('[TriggerManager] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop the trigger manager
   */
  stop(): boolean {
    try {
      if (!this.running) {
        console.warn('[TriggerManager] Not running');
        return false;
      }

      this.running = false;

      // Clear all timers
      for (const [agentId, state] of this.triggers.entries()) {
        if (state.timerId) {
          clearTimeout(state.timerId);
          state.timerId = undefined;
        }
      }

      // Stop activity monitoring
      if (this.activityTimer) {
        clearInterval(this.activityTimer);
        this.activityTimer = undefined;
      }

      // Clear resume timer
      if (this.queueResumeTimer) {
        clearTimeout(this.queueResumeTimer);
        this.queueResumeTimer = undefined;
      }

      this.queuePaused = false;

      audit({
        level: 'info',
        category: 'system',
        event: 'trigger_manager_stopped',
        actor: 'trigger_manager',
      });

      console.log('[TriggerManager] Stopped');
      return true;
    } catch (error) {
      console.error('[TriggerManager] Failed to stop:', error);
      return false;
    }
  }

  /**
   * Pause all triggers
   */
  pauseAll(): void {
    if (this.config) {
      this.config.globalSettings.pauseAll = true;
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'triggers_paused_all',
      actor: 'trigger_manager',
    });
  }

  /**
   * Resume all triggers
   */
  resumeAll(): void {
    if (this.config) {
      this.config.globalSettings.pauseAll = false;
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'triggers_resumed_all',
      actor: 'trigger_manager',
    });
  }

  // ==========================================================================
  // Trigger Scheduling
  // ==========================================================================

  /**
   * Schedule a trigger based on its type
   */
  private scheduleTrigger(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state || !state.config.enabled) return;

    // Clear existing timer
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = undefined;
    }

    switch (state.config.type) {
      case 'interval':
        this.scheduleInterval(agentId);
        break;

      case 'time-of-day':
        this.scheduleTimeOfDay(agentId);
        break;

      case 'event':
        // Event-based triggers are handled via triggerEvent()
        console.log(
          `[TriggerManager] Agent ${agentId} registered for event: ${state.config.eventPattern}`
        );
        break;

      case 'activity':
        // Activity-based triggers are checked by activity monitor
        console.log(
          `[TriggerManager] Agent ${agentId} registered for inactivity: ${state.config.inactivityThreshold}s`
        );
        break;

      case 'manual':
        // Manual triggers are only fired via triggerManual()
        break;

      default:
        console.warn(
          `[TriggerManager] Unknown trigger type for ${agentId}: ${state.config.type}`
        );
    }
  }

  /**
   * Schedule interval-based trigger
   */
  private scheduleInterval(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state || !state.config.interval) return;

    const delay = state.config.runOnBoot ? 1000 : state.config.interval * 1000;
    state.nextRun = new Date(Date.now() + delay);

    state.timerId = setTimeout(() => {
      this.fireTrigger(agentId);

      // Reschedule for next interval
      if (state.config.enabled && this.running) {
        this.scheduleInterval(agentId);
      }
    }, delay);

    console.log(`[TriggerManager] Agent ${agentId} scheduled in ${delay / 1000}s`);
  }

  /**
   * Schedule time-of-day trigger
   */
  private scheduleTimeOfDay(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state || !state.config.schedule) return;

    // Parse schedule (HH:MM format)
    const [hours, minutes] = state.config.schedule.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      console.error(
        `[TriggerManager] Invalid schedule format for ${agentId}: ${state.config.schedule}`
      );
      return;
    }

    // Calculate next run time
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(hours, minutes, 0, 0);

    // If time has already passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const delay = nextRun.getTime() - now.getTime();
    state.nextRun = nextRun;

    state.timerId = setTimeout(() => {
      this.fireTrigger(agentId);

      // Reschedule for next day
      if (state.config.enabled && this.running) {
        this.scheduleTimeOfDay(agentId);
      }
    }, delay);

    console.log(`[TriggerManager] Agent ${agentId} scheduled for ${nextRun.toLocaleString()}`);
  }

  // ==========================================================================
  // Trigger Firing
  // ==========================================================================

  /**
   * Fire a trigger - enqueue task to the queue manager
   */
  private fireTrigger(agentId: string): void {
    const state = this.triggers.get(agentId);
    if (!state) return;

    // Check if scheduler is paused
    if (this.config?.globalSettings.pauseAll) {
      console.log(`[TriggerManager] Agent ${agentId} skipped (triggers paused)`);
      return;
    }

    // Check if in quiet hours
    if (this.isQuietHours()) {
      console.log(`[TriggerManager] Agent ${agentId} skipped (quiet hours)`);
      return;
    }

    // Check conditions
    if (!this.checkConditions(state.config)) {
      console.log(`[TriggerManager] Agent ${agentId} skipped (conditions not met)`);
      return;
    }

    // Create task input
    const taskType = this.getTaskTypeForAgent(agentId);
    const priority = this.mapPriority(state.config.priority);
    const username = this.lastActiveUsername || readLastActiveUsername() || 'system';

    const taskInput: TaskInput = {
      type: taskType,
      priority,
      payload: {
        agentId,
        agentPath: state.config.agentPath,
        triggeredBy: state.config.type,
        usesLLM: state.config.usesLLM ?? true,
      },
      username,
      metadata: {
        source: 'trigger_manager',
        triggerType: state.config.type,
        runCount: state.runCount + 1,
      },
    };

    // Enqueue the task
    const task = this.queueManager.enqueue(taskInput);

    // Update state
    state.lastRun = new Date();
    state.runCount++;

    audit({
      level: 'info',
      category: 'action',
      event: 'trigger_fired',
      actor: 'trigger_manager',
      details: {
        agentId,
        taskId: task.id,
        taskType,
        triggerType: state.config.type,
        runCount: state.runCount,
      },
    });

    console.log(`[TriggerManager] Trigger fired: ${agentId} → task ${task.id}`);

    // Emit event for external listeners
    this.emit('trigger', { agentId, taskId: task.id, taskType });
  }

  /**
   * Manually trigger an agent (for 'manual' type agents)
   */
  triggerManual(agentId: string, username?: string): string | null {
    const state = this.triggers.get(agentId);
    if (!state) {
      console.warn(`[TriggerManager] Unknown agent: ${agentId}`);
      return null;
    }

    const taskType = this.getTaskTypeForAgent(agentId);
    const priority = this.mapPriority(state.config.priority);

    const taskInput: TaskInput = {
      type: taskType,
      priority,
      payload: {
        agentId,
        agentPath: state.config.agentPath,
        triggeredBy: 'manual',
        usesLLM: state.config.usesLLM ?? true,
      },
      username: username || this.lastActiveUsername || 'system',
      metadata: {
        source: 'trigger_manager',
        triggerType: 'manual',
      },
    };

    const task = this.queueManager.enqueue(taskInput);

    audit({
      level: 'info',
      category: 'action',
      event: 'trigger_manual',
      actor: 'trigger_manager',
      details: {
        agentId,
        taskId: task.id,
        username: taskInput.username,
      },
    });

    return task.id;
  }

  /**
   * Trigger an event-based agent
   */
  triggerEvent(eventName: string, data?: any): string[] {
    const triggeredTasks: string[] = [];

    for (const [agentId, state] of this.triggers.entries()) {
      if (
        state.config.type === 'event' &&
        state.config.enabled &&
        state.config.eventPattern
      ) {
        // Simple pattern matching (could be enhanced with regex)
        if (
          eventName === state.config.eventPattern ||
          eventName.includes(state.config.eventPattern)
        ) {
          const taskId = this.triggerManual(agentId);
          if (taskId) {
            triggeredTasks.push(taskId);
          }
        }
      }
    }

    return triggeredTasks;
  }

  // ==========================================================================
  // Activity Monitoring
  // ==========================================================================

  /**
   * Start activity monitoring
   */
  private startActivityMonitoring(): void {
    // Check every 30 seconds
    this.activityTimer = setInterval(() => {
      this.syncLastActivityFromDisk();
      const now = Date.now();
      const inactiveSeconds = (now - this.lastActivity.getTime()) / 1000;

      // Check all activity-based triggers
      for (const [agentId, state] of this.triggers.entries()) {
        if (
          state.config.type === 'activity' &&
          state.config.enabled &&
          state.config.inactivityThreshold
        ) {
          const threshold = state.config.inactivityThreshold;
          const secondsSinceRun = state.lastRun
            ? (now - state.lastRun.getTime()) / 1000
            : Number.POSITIVE_INFINITY;

          if (inactiveSeconds >= threshold && secondsSinceRun >= threshold) {
            this.fireTrigger(agentId);
          }
        }
      }

      // Check if we should resume the queue
      if (this.queuePaused) {
        const requiredInactivity = this.config?.globalSettings.activityResumeDelay || 60;
        if (inactiveSeconds >= requiredInactivity) {
          this.resumeQueue();
        }
      }
    }, 30000);
  }

  /**
   * Record user activity
   */
  recordActivity(username?: string): void {
    this.lastActivity = new Date();
    this.lastActiveUsername = username || null;
    recordSystemActivity(this.lastActivity.getTime(), username);

    // Pause queue on user activity if configured
    if (this.config?.globalSettings.pauseQueueOnActivity && !this.queuePaused) {
      this.pauseQueue();
    }

    // Emit activity event
    this.emit('activity', { timestamp: this.lastActivity, username });
  }

  /**
   * Pause the queue due to user activity
   */
  private pauseQueue(): void {
    if (this.queuePaused) return;

    this.queuePaused = true;
    this.queueManager.pause();

    audit({
      level: 'info',
      category: 'system',
      event: 'queue_paused_activity',
      actor: 'trigger_manager',
    });

    console.log('[TriggerManager] Queue paused (user activity detected)');
  }

  /**
   * Resume the queue after inactivity
   */
  private resumeQueue(): void {
    if (!this.queuePaused) return;

    this.queuePaused = false;
    this.queueManager.resume();

    audit({
      level: 'info',
      category: 'system',
      event: 'queue_resumed_inactivity',
      actor: 'trigger_manager',
    });

    console.log('[TriggerManager] Queue resumed (user inactive)');
  }

  /**
   * Sync last activity from disk
   */
  private syncLastActivityFromDisk(): void {
    const persisted = readSystemActivityTimestamp();
    if (persisted && persisted > this.lastActivity.getTime()) {
      this.lastActivity = new Date(persisted);
    }

    const username = readLastActiveUsername();
    if (username) {
      this.lastActiveUsername = username;
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get task type for an agent
   */
  private getTaskTypeForAgent(agentId: string): TaskType {
    return AGENT_TASK_MAP[agentId] || 'generic';
  }

  /**
   * Map priority string to Priority type
   */
  private mapPriority(priority: 'low' | 'normal' | 'high'): Priority {
    return priority as Priority;
  }

  /**
   * Check if currently in quiet hours
   */
  private isQuietHours(): boolean {
    if (!this.config?.globalSettings.quietHours?.enabled) return false;

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const { start, end } = this.config.globalSettings.quietHours;
    const [startH, startM] = start.split(':').map(Number);
    const [endH, endM] = end.split(':').map(Number);

    const startTime = startH * 60 + startM;
    const endTime = endH * 60 + endM;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    } else {
      return currentTime >= startTime && currentTime < endTime;
    }
  }

  /**
   * Check agent conditions
   */
  private checkConditions(config: AgentTriggerConfig): boolean {
    if (!config.conditions) return true;

    // Check sleep mode condition
    if (config.conditions.requiresSleepMode) {
      // TODO: Implement sleep mode detection
      return true;
    }

    return true;
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get all triggers
   */
  getTriggers(): Map<string, TriggerState> {
    return new Map(this.triggers);
  }

  /**
   * Get trigger state
   */
  getTriggerState(agentId: string): TriggerState | null {
    return this.triggers.get(agentId) || null;
  }

  /**
   * Get next scheduled triggers
   */
  getNextTriggers(): Array<{ agentId: string; nextRun: Date }> {
    return Array.from(this.triggers.entries())
      .filter(([_, state]) => state.nextRun)
      .map(([id, state]) => ({
        agentId: id,
        nextRun: state.nextRun!,
      }))
      .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
  }

  /**
   * Check if queue is paused due to activity
   */
  isQueuePaused(): boolean {
    return this.queuePaused;
  }

  /**
   * Get last activity info
   */
  getLastActivity(): { timestamp: Date; username: string | null } {
    return {
      timestamp: this.lastActivity,
      username: this.lastActiveUsername,
    };
  }
}
