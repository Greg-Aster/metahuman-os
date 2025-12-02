/**
 * Agent Scheduler
 *
 * Central event bus for managing all autonomous agent triggers.
 * Supports interval-based, time-of-day, event-based, and activity-based triggers.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { systemPaths, ROOT } from './path-builder.js';
import { storageClient } from './storage-client.js';
import { audit } from './audit.js';
import { recordSystemActivity, readSystemActivityTimestamp } from './system-activity.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type TriggerType = 'interval' | 'time-of-day' | 'event' | 'activity';
export type AgentPriority = 'low' | 'normal' | 'high';
export type AgentStatus = 'idle' | 'running' | 'paused' | 'error';

export interface AgentConfig {
  id: string;
  enabled: boolean;
  type: TriggerType;
  priority: AgentPriority;
  agentPath?: string;  // Path to agent file (e.g., 'reflector.ts')
  usesLLM?: boolean;   // Does this agent use GPU/LLM? (for queue management)

  // Interval-based config
  interval?: number;  // Seconds

  // Time-of-day config
  schedule?: string;  // HH:MM format

  // Event-based config
  eventPattern?: string;
  debounce?: number;  // Seconds

  // Activity-based config
  inactivityThreshold?: number;  // Seconds

  // Task config (for operator tasks)
  task?: {
    goal: string;
    autoApprove?: boolean;
    profile?: string;
  };

  // Conditions
  conditions?: {
    requiresSleepMode?: boolean;
    [key: string]: any;
  };

  // Behavior
  runOnBoot?: boolean;
  autoRestart?: boolean;
  maxRetries?: number;
}

export interface GlobalSchedulerSettings {
  pauseAll: boolean;
  quietHours?: {
    enabled: boolean;
    start: string;  // HH:MM
    end: string;    // HH:MM
  };
  maxConcurrentAgents: number;
  maxConcurrentLLMAgents: number;      // Max GPU agents (serialized execution)
  maxConcurrentNonLLMAgents: number;   // Max non-GPU agents (unlimited by default)
  pauseQueueOnActivity: boolean;        // Pause queue when user is active
  activityResumeDelay: number;          // Seconds to wait before resuming queue
}

export interface SchedulerConfig {
  version: string;
  globalSettings: GlobalSchedulerSettings;
  agents: Record<string, AgentConfig>;
}

interface AgentState {
  config: AgentConfig;
  status: AgentStatus;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
  process?: ChildProcess;
  timerId?: NodeJS.Timeout;
}

interface QueuedAgent {
  id: string;
  priority: AgentPriority;
  queuedAt: Date;
}

// ============================================================================
// Agent Scheduler (Singleton)
// ============================================================================

export class AgentScheduler extends EventEmitter {
  private static instance: AgentScheduler | null = null;
  private config: SchedulerConfig | null = null;
  private agents: Map<string, AgentState> = new Map();
  private running: boolean = false;
  private activityTimer?: NodeJS.Timeout;
  private lastActivity: Date = new Date();

  // GPU Queue Management
  private llmQueue: QueuedAgent[] = [];
  private currentLLMAgent: string | null = null;
  private queuePaused: boolean = false;
  private queueResumeTimer?: NodeJS.Timeout;

  /**
   * Get config file path (lazy evaluation to allow user context resolution)
   */
  private get configPath(): string {
    // Try user-specific config first
    const result = storageClient.resolvePath({
      category: 'config',
      subcategory: 'etc',
      relativePath: 'agents.json',
    });
    return result.success && result.path ? result.path : path.join(systemPaths.etc, 'agents.json');
  }

  private constructor() {
    super();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AgentScheduler {
    if (!AgentScheduler.instance) {
      AgentScheduler.instance = new AgentScheduler();
    }
    return AgentScheduler.instance;
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Load configuration from etc/agents.json
   */
  public loadConfig(): boolean {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn('[AgentScheduler] No agents.json found, using defaults');
        this.config = this.getDefaultConfig();
        return false;
      }

      const data = fs.readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(data);

      audit({
        level: 'info',
        category: 'system',
        event: 'scheduler_config_loaded',
        actor: 'agent_scheduler',
        details: {
          agentCount: this.config ? Object.keys(this.config.agents).length : 0,
          pauseAll: this.config?.globalSettings.pauseAll ?? false,
        },
      });

      return true;
    } catch (error) {
      console.error('[AgentScheduler] Failed to load config:', error);
      this.config = this.getDefaultConfig();
      return false;
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): SchedulerConfig {
    return {
      version: '1.0.0',
      globalSettings: {
        pauseAll: false,
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
        },
        maxConcurrentAgents: 3,
        maxConcurrentLLMAgents: 1,
        maxConcurrentNonLLMAgents: 10,
        pauseQueueOnActivity: true,
        activityResumeDelay: 60,
      },
      agents: {},
    };
  }

  /**
   * Save configuration to disk
   */
  public saveConfig(): boolean {
    try {
      if (!this.config) return false;

      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));

      audit({
        level: 'info',
        category: 'system',
        event: 'scheduler_config_saved',
        actor: 'agent_scheduler',
      });

      return true;
    } catch (error) {
      console.error('[AgentScheduler] Failed to save config:', error);
      return false;
    }
  }

  // ==========================================================================
  // Agent Registration
  // ==========================================================================

  /**
   * Register an agent with the scheduler
   */
  public register(config: AgentConfig): boolean {
    try {
      if (!this.config) {
        this.loadConfig();
      }

      // Add to config
      if (this.config) {
        this.config.agents[config.id] = config;
        this.saveConfig();
      }

      // Create agent state
      const state: AgentState = {
        config,
        status: config.enabled ? 'idle' : 'paused',
        runCount: 0,
        errorCount: 0,
      };

      this.agents.set(config.id, state);

      audit({
        level: 'info',
        category: 'system',
        event: 'agent_registered',
        actor: 'agent_scheduler',
        details: {
          agentId: config.id,
          type: config.type,
          enabled: config.enabled,
        },
      });

      // Schedule if enabled and scheduler is running
      if (config.enabled && this.running) {
        this.scheduleAgent(config.id);
      }

      return true;
    } catch (error) {
      console.error(`[AgentScheduler] Failed to register agent ${config.id}:`, error);
      return false;
    }
  }

  /**
   * Unregister an agent
   */
  public unregister(agentId: string): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;

    // Stop the agent if running
    this.stopAgent(agentId);

    // Remove from state
    this.agents.delete(agentId);

    // Remove from config
    if (this.config && this.config.agents[agentId]) {
      delete this.config.agents[agentId];
      this.saveConfig();
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'agent_unregistered',
      actor: 'agent_scheduler',
      details: { agentId },
    });

    return true;
  }

  // ==========================================================================
  // Scheduler Control
  // ==========================================================================

  /**
   * Start the scheduler
   */
  public start(): boolean {
    try {
      if (this.running) {
        console.warn('[AgentScheduler] Already running');
        return false;
      }

      if (!this.config) {
        this.loadConfig();
      }

      // Load agents from config if not already registered
      if (this.config && this.agents.size === 0) {
        for (const [agentId, agentConfig] of Object.entries(this.config.agents)) {
          const state: AgentState = {
            config: agentConfig,
            status: agentConfig.enabled ? 'idle' : 'paused',
            runCount: 0,
            errorCount: 0,
          };
          this.agents.set(agentId, state);
        }
      }

      this.running = true;
      this.syncLastActivityFromDisk();

      audit({
        level: 'info',
        category: 'system',
        event: 'scheduler_started',
        actor: 'agent_scheduler',
        details: {
          agentCount: this.agents.size,
          pauseAll: this.config?.globalSettings.pauseAll,
        },
      });

      // Schedule all enabled agents
      for (const [agentId, state] of this.agents.entries()) {
        if (state.config.enabled && state.status !== 'paused') {
          this.scheduleAgent(agentId);
        }
      }

      // Start activity monitoring
      this.startActivityMonitoring();

      console.log(`[AgentScheduler] Started with ${this.agents.size} agents`);
      return true;
    } catch (error) {
      console.error('[AgentScheduler] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop the scheduler
   */
  public stop(): boolean {
    try {
      if (!this.running) {
        console.warn('[AgentScheduler] Not running');
        return false;
      }

      this.running = false;

      // Stop all agents
      for (const agentId of this.agents.keys()) {
        this.stopAgent(agentId);
      }

      // Stop activity monitoring
      if (this.activityTimer) {
        clearInterval(this.activityTimer);
        this.activityTimer = undefined;
      }

      // Clear LLM queue
      this.clearLLMQueue();

      audit({
        level: 'info',
        category: 'system',
        event: 'scheduler_stopped',
        actor: 'agent_scheduler',
      });

      console.log('[AgentScheduler] Stopped');
      return true;
    } catch (error) {
      console.error('[AgentScheduler] Failed to stop:', error);
      return false;
    }
  }

  /**
   * Pause all agents
   */
  public pauseAll(): void {
    if (this.config) {
      this.config.globalSettings.pauseAll = true;
      this.saveConfig();
    }

    for (const agentId of this.agents.keys()) {
      this.pauseAgent(agentId);
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'scheduler_paused_all',
      actor: 'agent_scheduler',
    });
  }

  /**
   * Resume all agents
   */
  public resumeAll(): void {
    if (this.config) {
      this.config.globalSettings.pauseAll = false;
      this.saveConfig();
    }

    for (const agentId of this.agents.keys()) {
      this.resumeAgent(agentId);
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'scheduler_resumed_all',
      actor: 'agent_scheduler',
    });
  }

  // ==========================================================================
  // Agent Control
  // ==========================================================================

  /**
   * Schedule an agent based on its trigger type
   */
  private scheduleAgent(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state || state.status === 'paused') return;

    const { config } = state;

    // Clear existing timer
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = undefined;
    }

    switch (config.type) {
      case 'interval':
        this.scheduleInterval(agentId);
        break;

      case 'time-of-day':
        this.scheduleTimeOfDay(agentId);
        break;

      case 'event':
        // Event-based agents are triggered externally via triggerEvent()
        console.log(`[AgentScheduler] Agent ${agentId} registered for event: ${config.eventPattern}`);
        break;

      case 'activity':
        // Activity-based agents are checked by activity monitor
        console.log(`[AgentScheduler] Agent ${agentId} registered for inactivity: ${config.inactivityThreshold}s`);
        break;

      default:
        console.warn(`[AgentScheduler] Unknown trigger type for agent ${agentId}: ${config.type}`);
    }
  }

  /**
   * Schedule interval-based agent
   */
  private scheduleInterval(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const { config } = state;
    if (!config.interval) {
      console.error(`[AgentScheduler] No interval specified for agent ${agentId}`);
      return;
    }

    const delay = config.runOnBoot ? 1000 : config.interval * 1000;
    state.nextRun = new Date(Date.now() + delay);

    state.timerId = setTimeout(() => {
      this.runAgent(agentId);

      // Reschedule for next interval
      if (state.config.enabled && this.running) {
        this.scheduleInterval(agentId);
      }
    }, delay);

    console.log(`[AgentScheduler] Agent ${agentId} scheduled in ${delay / 1000}s`);
  }

  /**
   * Schedule time-of-day agent
   */
  private scheduleTimeOfDay(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    const { config } = state;
    if (!config.schedule) {
      console.error(`[AgentScheduler] No schedule specified for agent ${agentId}`);
      return;
    }

    // Parse schedule (HH:MM format)
    const [hours, minutes] = config.schedule.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) {
      console.error(`[AgentScheduler] Invalid schedule format for agent ${agentId}: ${config.schedule}`);
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
      this.runAgent(agentId);

      // Reschedule for next day
      if (state.config.enabled && this.running) {
        this.scheduleTimeOfDay(agentId);
      }
    }, delay);

    console.log(`[AgentScheduler] Agent ${agentId} scheduled for ${nextRun.toLocaleString()}`);
  }

  /**
   * Run an agent (with queue management for LLM agents)
   */
  private async runAgent(agentId: string): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Check if scheduler is paused
    if (this.config?.globalSettings.pauseAll) {
      console.log(`[AgentScheduler] Agent ${agentId} skipped (scheduler paused)`);
      return;
    }

    // Check if in quiet hours
    if (this.isQuietHours()) {
      console.log(`[AgentScheduler] Agent ${agentId} skipped (quiet hours)`);
      return;
    }

    // Check conditions
    if (!this.checkConditions(state.config)) {
      console.log(`[AgentScheduler] Agent ${agentId} skipped (conditions not met)`);
      return;
    }

    // NEW: Queue-based concurrency management
    const usesLLM = state.config.usesLLM ?? true;  // Default to true for safety

    if (usesLLM) {
      // LLM agents: enforce serialization via queue
      if (this.currentLLMAgent !== null) {
        // Already running an LLM agent, enqueue this one
        console.log(`[AgentScheduler] Agent ${agentId} queued (LLM agent ${this.currentLLMAgent} is running)`);
        this.enqueueLLMAgent(agentId, state.config.priority);
        return;
      }

      // No LLM agent running, check global max
      const runningCount = Array.from(this.agents.values()).filter(s => s.status === 'running').length;
      if (runningCount >= (this.config?.globalSettings.maxConcurrentAgents || 3)) {
        console.log(`[AgentScheduler] Agent ${agentId} queued (max concurrent agents reached)`);
        this.enqueueLLMAgent(agentId, state.config.priority);
        return;
      }

      // Can run now
      await this.executeAgent(agentId);
    } else {
      // Non-LLM agents: check separate limit
      const runningNonLLM = Array.from(this.agents.values()).filter(
        s => s.status === 'running' && !s.config.usesLLM
      ).length;
      const maxNonLLM = this.config?.globalSettings.maxConcurrentNonLLMAgents || 10;

      if (runningNonLLM >= maxNonLLM) {
        console.log(`[AgentScheduler] Agent ${agentId} skipped (max concurrent non-LLM agents reached)`);
        return;
      }

      // Can run now
      await this.executeAgent(agentId);
    }
  }

  /**
   * Execute an agent (actual execution logic)
   */
  private async executeAgent(agentId: string): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) return;

    state.status = 'running';
    state.lastRun = new Date();
    state.runCount++;

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_triggered',
      actor: 'agent_scheduler',
      details: {
        agentId,
        type: state.config.type,
        runCount: state.runCount,
        usesLLM: state.config.usesLLM ?? true,
      },
    });

    console.log(`[AgentScheduler] Running agent: ${agentId}`);

    try {
      if (state.config.task) {
        // Run operator task
        await this.runOperatorTask(state.config);
      } else if (state.config.agentPath) {
        // Run agent file
        await this.runAgentFile(state.config);
      } else {
        console.error(`[AgentScheduler] No task or agent path specified for ${agentId}`);
      }

      state.status = 'idle';
      state.errorCount = 0;
    } catch (error) {
      console.error(`[AgentScheduler] Agent ${agentId} failed:`, error);
      state.status = 'error';
      state.errorCount++;

      audit({
        level: 'error',
        category: 'system',
        event: 'agent_error',
        actor: 'agent_scheduler',
        details: {
          agentId,
          error: (error as Error).message,
          errorCount: state.errorCount,
        },
      });
    }
  }

  /**
   * Run an operator task
   */
  private async runOperatorTask(config: AgentConfig): Promise<void> {
    if (!config.task) return;

    // Dynamically import operator to avoid circular dependencies
    const { runTask } = await import(/* @vite-ignore */ path.join(systemPaths.agents, 'operator.js'));

    await runTask(
      { goal: config.task.goal },
      0,
      {
        autoApprove: config.task.autoApprove ?? true,
        profile: config.task.profile,
      }
    );
  }

  /**
   * Run an agent file
   */
  private async runAgentFile(config: AgentConfig): Promise<void> {
    if (!config.agentPath) return;

    return new Promise((resolve, reject) => {
      const agentFullPath = path.join(systemPaths.agents, config.agentPath!);

      const child = spawn('tsx', [agentFullPath], {
        stdio: 'inherit',
        cwd: ROOT,
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Agent exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Stop an agent
   */
  private stopAgent(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state) return;

    // Clear timer
    if (state.timerId) {
      clearTimeout(state.timerId);
      state.timerId = undefined;
    }

    // Kill process if running
    if (state.process && !state.process.killed) {
      state.process.kill();
      state.process = undefined;
    }

    state.status = 'idle';
    state.nextRun = undefined;
  }

  /**
   * Pause an agent
   */
  private pauseAgent(agentId: string): void {
    this.stopAgent(agentId);
    const state = this.agents.get(agentId);
    if (state) {
      state.status = 'paused';
    }
  }

  /**
   * Resume an agent
   */
  private resumeAgent(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state || !state.config.enabled) return;

    state.status = 'idle';
    if (this.running) {
      this.scheduleAgent(agentId);
    }
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

      // Check all activity-based agents
      for (const [agentId, state] of this.agents.entries()) {
        if (
          state.config.type === 'activity' &&
          state.config.enabled &&
          state.status === 'idle' &&
          state.config.inactivityThreshold
        ) {
          const threshold = state.config.inactivityThreshold;
          const secondsSinceAgentRun = state.lastRun
            ? (now - state.lastRun.getTime()) / 1000
            : Number.POSITIVE_INFINITY;

          if (inactiveSeconds >= threshold && secondsSinceAgentRun >= threshold) {
            this.runAgent(agentId);
          }
        }
      }
    }, 30000);
  }

  /**
   * Record user activity
   */
  public recordActivity(): void {
    this.lastActivity = new Date();
    recordSystemActivity(this.lastActivity.getTime());

    // Pause queue on user activity if configured
    if (this.config?.globalSettings.pauseQueueOnActivity && !this.queuePaused) {
      this.pauseLLMQueue();
    }
  }

  // ==========================================================================
  // LLM Queue Management
  // ==========================================================================

  /**
   * Add an agent to the LLM queue
   */
  private enqueueLLMAgent(agentId: string, priority: AgentPriority): void {
    // Check if already queued
    if (this.llmQueue.some(q => q.id === agentId)) {
      console.log(`[AgentScheduler] Agent ${agentId} already in LLM queue`);
      return;
    }

    this.llmQueue.push({
      id: agentId,
      priority,
      queuedAt: new Date(),
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_queued',
      actor: 'agent_scheduler',
      details: {
        agentId,
        priority,
        queueSize: this.llmQueue.length,
      },
    });

    console.log(`[AgentScheduler] Agent ${agentId} added to LLM queue (${this.llmQueue.length} in queue)`);

    // Try to process queue
    this.processLLMQueue();
  }

  /**
   * Process the LLM queue - runs agents sequentially (one at a time)
   */
  private async processLLMQueue(): Promise<void> {
    // Don't process if queue is paused
    if (this.queuePaused) {
      console.log('[AgentScheduler] LLM queue is paused');
      return;
    }

    // Don't process if already running an LLM agent
    if (this.currentLLMAgent) {
      console.log(`[AgentScheduler] LLM agent ${this.currentLLMAgent} is running, queue processing delayed`);
      return;
    }

    // Check if queue is empty
    if (this.llmQueue.length === 0) {
      return;
    }

    // Sort queue by priority (high > normal > low), then by queuedAt
    this.llmQueue.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });

    // Dequeue next agent
    const queued = this.llmQueue.shift();
    if (!queued) return;

    const state = this.agents.get(queued.id);
    if (!state) {
      console.warn(`[AgentScheduler] Queued agent ${queued.id} not found in state`);
      // Continue processing next in queue
      this.processLLMQueue();
      return;
    }

    // Mark as current LLM agent
    this.currentLLMAgent = queued.id;

    console.log(`[AgentScheduler] Processing LLM agent ${queued.id} from queue (${this.llmQueue.length} remaining)`);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_dequeued',
      actor: 'agent_scheduler',
      details: {
        agentId: queued.id,
        priority: queued.priority,
        queuedFor: Date.now() - queued.queuedAt.getTime(),
        remainingInQueue: this.llmQueue.length,
      },
    });

    // Execute the agent
    await this.executeAgent(queued.id);

    // Clear current LLM agent
    this.currentLLMAgent = null;

    // Process next in queue
    if (this.llmQueue.length > 0) {
      // Small delay to allow system cleanup between agents
      setTimeout(() => this.processLLMQueue(), 1000);
    }
  }

  /**
   * Pause the LLM queue (user activity detected)
   */
  private pauseLLMQueue(): void {
    if (this.queuePaused) return;

    this.queuePaused = true;
    console.log('[AgentScheduler] LLM queue paused (user activity detected)');

    audit({
      level: 'info',
      category: 'system',
      event: 'llm_queue_paused',
      actor: 'agent_scheduler',
      details: {
        queueSize: this.llmQueue.length,
      },
    });

    // Clear any existing resume timer
    if (this.queueResumeTimer) {
      clearTimeout(this.queueResumeTimer);
    }

    // Schedule resume after inactivity delay
    const resumeDelay = (this.config?.globalSettings.activityResumeDelay || 60) * 1000;
    this.queueResumeTimer = setTimeout(() => {
      this.resumeLLMQueue();
    }, resumeDelay);
  }

  /**
   * Resume the LLM queue (after inactivity period)
   */
  private resumeLLMQueue(): void {
    if (!this.queuePaused) return;

    // Check if user is still inactive
    const now = Date.now();
    const inactiveSeconds = (now - this.lastActivity.getTime()) / 1000;
    const requiredInactivity = this.config?.globalSettings.activityResumeDelay || 60;

    if (inactiveSeconds < requiredInactivity) {
      console.log(`[AgentScheduler] Not resuming queue yet (only ${inactiveSeconds.toFixed(0)}s inactive, need ${requiredInactivity}s)`);
      // Reschedule resume check
      const remainingDelay = (requiredInactivity - inactiveSeconds) * 1000;
      this.queueResumeTimer = setTimeout(() => {
        this.resumeLLMQueue();
      }, remainingDelay);
      return;
    }

    this.queuePaused = false;
    console.log('[AgentScheduler] LLM queue resumed (user inactive)');

    audit({
      level: 'info',
      category: 'system',
      event: 'llm_queue_resumed',
      actor: 'agent_scheduler',
      details: {
        queueSize: this.llmQueue.length,
      },
    });

    // Process queue
    this.processLLMQueue();
  }

  /**
   * Clear the LLM queue
   */
  private clearLLMQueue(): void {
    this.llmQueue = [];
    this.currentLLMAgent = null;
    this.queuePaused = false;

    if (this.queueResumeTimer) {
      clearTimeout(this.queueResumeTimer);
      this.queueResumeTimer = undefined;
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'llm_queue_cleared',
      actor: 'agent_scheduler',
    });
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

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
  private checkConditions(config: AgentConfig): boolean {
    if (!config.conditions) return true;

    // Check sleep mode condition
    if (config.conditions.requiresSleepMode) {
      // TODO: Implement sleep mode detection
      // For now, always return true
      return true;
    }

    return true;
  }

  // ==========================================================================
  // Public Query Methods
  // ==========================================================================

  /**
   * Get all registered agents
   */
  public getAgents(): Map<string, AgentState> {
    return new Map(this.agents);
  }

  /**
   * Get agent status
   */
  public getAgentStatus(agentId: string): AgentState | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get all running agents
   */
  public getRunningAgents(): string[] {
    return Array.from(this.agents.entries())
      .filter(([_, state]) => state.status === 'running')
      .map(([id, _]) => id);
  }

  /**
   * Get next triggers for all agents
   */
  public getNextTriggers(): Array<{ agentId: string; nextRun: Date }> {
    return Array.from(this.agents.entries())
      .filter(([_, state]) => state.nextRun)
      .map(([id, state]) => ({
        agentId: id,
        nextRun: state.nextRun!,
      }))
      .sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
  }

  private syncLastActivityFromDisk(): void {
    const persisted = readSystemActivityTimestamp();
    if (persisted && persisted > this.lastActivity.getTime()) {
      this.lastActivity = new Date(persisted);
    }
  }
}

// Export singleton instance
export const scheduler = AgentScheduler.getInstance();
