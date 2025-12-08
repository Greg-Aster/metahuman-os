/**
 * Mobile Agent Scheduler
 *
 * Runs agents in-process instead of spawning child processes.
 * Designed for nodejs-mobile where child process spawning is limited.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.js';

// ============================================================================
// Type Definitions
// ============================================================================

export type MobileAgentPriority = 'low' | 'normal' | 'high';
export type MobileAgentStatus = 'idle' | 'running' | 'paused' | 'error';

/**
 * Agent run function signature
 * Agents export a run() function that the scheduler calls directly
 */
export type AgentRunFunction = (context: MobileAgentContext) => Promise<void>;

/**
 * Context passed to agent run functions
 */
export interface MobileAgentContext {
  username?: string;
  profileRoot: string;
  dataDir: string;
  signal?: AbortSignal;
}

/**
 * Agent registration
 */
export interface MobileAgentRegistration {
  id: string;
  name: string;
  run: AgentRunFunction;
  usesLLM?: boolean;
  priority?: MobileAgentPriority;
  intervalSeconds?: number;
}

/**
 * Agent state
 */
interface AgentState {
  registration: MobileAgentRegistration;
  status: MobileAgentStatus;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
  timerId?: ReturnType<typeof setTimeout>;
}

/**
 * Queued agent for LLM serialization
 */
interface QueuedAgent {
  id: string;
  priority: MobileAgentPriority;
  queuedAt: Date;
}

// ============================================================================
// Mobile Agent Scheduler
// ============================================================================

export class MobileAgentScheduler extends EventEmitter {
  private static instance: MobileAgentScheduler | null = null;
  private agents: Map<string, AgentState> = new Map();
  private running: boolean = false;
  private dataDir: string = '';
  private username: string = '';

  // LLM queue management (serialize GPU-intensive agents)
  private llmQueue: QueuedAgent[] = [];
  private currentLLMAgent: string | null = null;

  private constructor() {
    super();
  }

  static getInstance(): MobileAgentScheduler {
    if (!MobileAgentScheduler.instance) {
      MobileAgentScheduler.instance = new MobileAgentScheduler();
    }
    return MobileAgentScheduler.instance;
  }

  /**
   * Initialize scheduler with mobile data directory
   */
  initialize(dataDir: string, username?: string): void {
    this.dataDir = dataDir;
    this.username = username || '';
    console.log(`[MobileScheduler] Initialized with dataDir: ${dataDir}`);
  }

  /**
   * Register an agent
   */
  register(registration: MobileAgentRegistration): boolean {
    try {
      if (this.agents.has(registration.id)) {
        console.warn(`[MobileScheduler] Agent ${registration.id} already registered`);
        return false;
      }

      const state: AgentState = {
        registration,
        status: 'idle',
        runCount: 0,
        errorCount: 0,
      };

      this.agents.set(registration.id, state);

      console.log(`[MobileScheduler] Registered agent: ${registration.id}`);

      audit({
        level: 'info',
        category: 'system',
        event: 'mobile_agent_registered',
        actor: 'mobile_scheduler',
        details: {
          agentId: registration.id,
          usesLLM: registration.usesLLM ?? true,
        },
      });

      // Schedule if scheduler is running and agent has interval
      if (this.running && registration.intervalSeconds) {
        this.scheduleAgent(registration.id);
      }

      return true;
    } catch (error) {
      console.error(`[MobileScheduler] Failed to register agent ${registration.id}:`, error);
      return false;
    }
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;

    // Clear timer
    if (state.timerId) {
      clearTimeout(state.timerId);
    }

    this.agents.delete(agentId);
    console.log(`[MobileScheduler] Unregistered agent: ${agentId}`);
    return true;
  }

  /**
   * Start the scheduler
   */
  start(): boolean {
    if (this.running) {
      console.warn('[MobileScheduler] Already running');
      return false;
    }

    this.running = true;

    audit({
      level: 'info',
      category: 'system',
      event: 'mobile_scheduler_started',
      actor: 'mobile_scheduler',
      details: {
        agentCount: this.agents.size,
      },
    });

    // Schedule all agents with intervals
    for (const [agentId, state] of this.agents.entries()) {
      if (state.registration.intervalSeconds && state.status !== 'paused') {
        this.scheduleAgent(agentId);
      }
    }

    console.log(`[MobileScheduler] Started with ${this.agents.size} agents`);
    return true;
  }

  /**
   * Stop the scheduler
   */
  stop(): boolean {
    if (!this.running) {
      console.warn('[MobileScheduler] Not running');
      return false;
    }

    this.running = false;

    // Clear all timers
    for (const state of this.agents.values()) {
      if (state.timerId) {
        clearTimeout(state.timerId);
        state.timerId = undefined;
      }
      state.nextRun = undefined;
    }

    // Clear queue
    this.llmQueue = [];
    this.currentLLMAgent = null;

    audit({
      level: 'info',
      category: 'system',
      event: 'mobile_scheduler_stopped',
      actor: 'mobile_scheduler',
    });

    console.log('[MobileScheduler] Stopped');
    return true;
  }

  /**
   * Trigger an agent to run immediately
   */
  async trigger(agentId: string): Promise<boolean> {
    const state = this.agents.get(agentId);
    if (!state) {
      console.error(`[MobileScheduler] Agent ${agentId} not found`);
      return false;
    }

    if (state.status === 'running') {
      console.warn(`[MobileScheduler] Agent ${agentId} is already running`);
      return false;
    }

    await this.runAgent(agentId);
    return true;
  }

  /**
   * Get agent status
   */
  getStatus(agentId: string): AgentState | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get all agents
   */
  getAllAgents(): Map<string, AgentState> {
    return new Map(this.agents);
  }

  /**
   * Get running agents
   */
  getRunningAgents(): string[] {
    return Array.from(this.agents.entries())
      .filter(([_, state]) => state.status === 'running')
      .map(([id, _]) => id);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private scheduleAgent(agentId: string): void {
    const state = this.agents.get(agentId);
    if (!state || !state.registration.intervalSeconds) return;

    // Clear existing timer
    if (state.timerId) {
      clearTimeout(state.timerId);
    }

    const delay = state.registration.intervalSeconds * 1000;
    state.nextRun = new Date(Date.now() + delay);

    state.timerId = setTimeout(() => {
      this.runAgent(agentId);

      // Reschedule
      if (this.running && state.status !== 'paused') {
        this.scheduleAgent(agentId);
      }
    }, delay);

    console.log(`[MobileScheduler] Agent ${agentId} scheduled in ${delay / 1000}s`);
  }

  private async runAgent(agentId: string): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) return;

    const usesLLM = state.registration.usesLLM ?? true;

    if (usesLLM) {
      // Queue LLM agents for serialized execution
      if (this.currentLLMAgent !== null) {
        console.log(`[MobileScheduler] Agent ${agentId} queued (${this.currentLLMAgent} running)`);
        this.enqueueLLMAgent(agentId, state.registration.priority || 'normal');
        return;
      }
    }

    await this.executeAgent(agentId);
  }

  private async executeAgent(agentId: string): Promise<void> {
    const state = this.agents.get(agentId);
    if (!state) return;

    const usesLLM = state.registration.usesLLM ?? true;

    // Mark as current LLM agent if applicable
    if (usesLLM) {
      this.currentLLMAgent = agentId;
    }

    state.status = 'running';
    state.lastRun = new Date();
    state.runCount++;

    audit({
      level: 'info',
      category: 'action',
      event: 'mobile_agent_triggered',
      actor: 'mobile_scheduler',
      details: {
        agentId,
        runCount: state.runCount,
        usesLLM,
      },
    });

    console.log(`[MobileScheduler] Running agent: ${agentId}`);

    try {
      const context: MobileAgentContext = {
        username: this.username,
        profileRoot: path.join(this.dataDir, 'profiles', this.username || 'default'),
        dataDir: this.dataDir,
      };

      await state.registration.run(context);

      state.status = 'idle';
      state.errorCount = 0;

      console.log(`[MobileScheduler] Agent ${agentId} completed successfully`);
    } catch (error) {
      console.error(`[MobileScheduler] Agent ${agentId} failed:`, error);
      state.status = 'error';
      state.errorCount++;

      audit({
        level: 'error',
        category: 'system',
        event: 'mobile_agent_error',
        actor: 'mobile_scheduler',
        details: {
          agentId,
          error: (error as Error).message,
          errorCount: state.errorCount,
        },
      });
    } finally {
      // Clear current LLM agent
      if (usesLLM) {
        this.currentLLMAgent = null;
      }

      // Process next in queue
      if (this.llmQueue.length > 0) {
        setTimeout(() => this.processLLMQueue(), 500);
      }
    }
  }

  private enqueueLLMAgent(agentId: string, priority: MobileAgentPriority): void {
    if (this.llmQueue.some(q => q.id === agentId)) {
      return; // Already queued
    }

    this.llmQueue.push({
      id: agentId,
      priority,
      queuedAt: new Date(),
    });

    console.log(`[MobileScheduler] Agent ${agentId} queued (${this.llmQueue.length} in queue)`);
  }

  private async processLLMQueue(): Promise<void> {
    if (this.currentLLMAgent !== null || this.llmQueue.length === 0) {
      return;
    }

    // Sort by priority
    this.llmQueue.sort((a, b) => {
      const order = { high: 3, normal: 2, low: 1 };
      const diff = order[b.priority] - order[a.priority];
      if (diff !== 0) return diff;
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });

    const next = this.llmQueue.shift();
    if (!next) return;

    console.log(`[MobileScheduler] Dequeuing agent ${next.id} (${this.llmQueue.length} remaining)`);
    await this.executeAgent(next.id);
  }
}

// Export singleton instance
export const mobileScheduler = MobileAgentScheduler.getInstance();
