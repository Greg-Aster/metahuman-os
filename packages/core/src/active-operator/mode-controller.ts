/**
 * Mode Controller for Active Operator
 *
 * Manages switching between passive and active operator modes:
 * - Passive: Timer-based scheduler triggers agents on schedules
 * - Active: LLM-controlled continuous decision loop
 *
 * The controller ensures safe transitions and state cleanup.
 */

import { EventEmitter } from 'events';
import { audit } from '../audit.js';
import type { OperatorMode, OperatorStatus } from './types.js';
import {
  loadConfig,
  saveConfig,
  loadMetrics,
  loadScratchpad,
  clearScratchpad,
  resetMetrics,
  loadQueueState,
  clearAllState,
} from './state-persister.js';
import { UnifiedQueue } from './unified-queue.js';

/**
 * Events emitted by the mode controller.
 */
export interface ModeControllerEvents {
  /** Emitted when mode changes */
  modeChanged: (mode: OperatorMode) => void;
  /** Emitted when operator starts */
  started: () => void;
  /** Emitted when operator stops */
  stopped: () => void;
  /** Emitted on error */
  error: (error: Error) => void;
}

/**
 * Mode Controller
 *
 * Central control point for the Active Operator system.
 * Handles mode switching, lifecycle, and coordination.
 */
export class ModeController extends EventEmitter {
  private _mode: OperatorMode = 'passive';
  private _isRunning: boolean = false;
  private _queue: UnifiedQueue | null = null;
  private _shutdownRequested: boolean = false;

  constructor() {
    super();
    this.loadInitialState();
  }

  /**
   * Load initial state from config.
   */
  private loadInitialState(): void {
    const config = loadConfig();
    this._mode = config.enabled ? 'active' : 'passive';
  }

  /**
   * Get current mode.
   */
  get mode(): OperatorMode {
    return this._mode;
  }

  /**
   * Check if active mode is enabled.
   */
  get isActive(): boolean {
    return this._mode === 'active';
  }

  /**
   * Check if operator is currently running.
   */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Check if shutdown was requested.
   */
  get shutdownRequested(): boolean {
    return this._shutdownRequested;
  }

  /**
   * Get the queue instance.
   */
  get queue(): UnifiedQueue | null {
    return this._queue;
  }

  /**
   * Switch to active mode.
   * This enables the LLM-controlled continuous thinking system.
   */
  async activateActiveMode(): Promise<void> {
    if (this._mode === 'active') {
      console.log('[mode-controller] Already in active mode');
      return;
    }

    console.log('[mode-controller] Switching to ACTIVE mode...');

    // Update config
    const config = loadConfig();
    config.enabled = true;
    saveConfig(config);

    // Initialize queue
    this._queue = new UnifiedQueue({
      initialQueue: loadQueueState() || [],
    });

    // Clear scratchpad for fresh start
    clearScratchpad();

    this._mode = 'active';
    this._shutdownRequested = false;

    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_mode_changed',
      actor: 'mode-controller',
      details: {
        previousMode: 'passive',
        newMode: 'active',
      },
    });

    this.emit('modeChanged', 'active');
    console.log('[mode-controller] Active mode ENABLED');
  }

  /**
   * Switch to passive mode.
   * This returns to timer-based scheduler operation.
   */
  async activatePassiveMode(): Promise<void> {
    if (this._mode === 'passive') {
      console.log('[mode-controller] Already in passive mode');
      return;
    }

    console.log('[mode-controller] Switching to PASSIVE mode...');

    // Request shutdown if running
    if (this._isRunning) {
      this._shutdownRequested = true;
      // Wait for current task to complete (up to 30 seconds)
      await this.waitForShutdown(30000);
    }

    // Update config
    const config = loadConfig();
    config.enabled = false;
    saveConfig(config);

    this._mode = 'passive';
    this._queue = null;

    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_mode_changed',
      actor: 'mode-controller',
      details: {
        previousMode: 'active',
        newMode: 'passive',
      },
    });

    this.emit('modeChanged', 'passive');
    console.log('[mode-controller] Passive mode ENABLED');
  }

  /**
   * Toggle between modes.
   */
  async toggleMode(): Promise<OperatorMode> {
    if (this._mode === 'active') {
      await this.activatePassiveMode();
    } else {
      await this.activateActiveMode();
    }
    return this._mode;
  }

  /**
   * Start the operator (called when entering active mode).
   */
  start(): void {
    if (this._isRunning) {
      console.log('[mode-controller] Operator already running');
      return;
    }

    if (this._mode !== 'active') {
      throw new Error('Cannot start operator in passive mode');
    }

    this._isRunning = true;
    this._shutdownRequested = false;

    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_started',
      actor: 'mode-controller',
      details: {},
    });

    this.emit('started');
    console.log('[mode-controller] Operator STARTED');
  }

  /**
   * Stop the operator.
   */
  stop(): void {
    if (!this._isRunning) {
      console.log('[mode-controller] Operator already stopped');
      return;
    }

    this._shutdownRequested = true;
    this._isRunning = false;

    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_stopped',
      actor: 'mode-controller',
      details: {},
    });

    this.emit('stopped');
    console.log('[mode-controller] Operator STOPPED');
  }

  /**
   * Emergency stop - immediately halt all operations.
   */
  emergencyStop(): void {
    console.log('[mode-controller] EMERGENCY STOP requested');

    this._shutdownRequested = true;
    this._isRunning = false;

    audit({
      category: 'system',
      level: 'warn',
      event: 'active_operator_emergency_stop',
      actor: 'mode-controller',
      details: {},
    });

    this.emit('stopped');
  }

  /**
   * Wait for shutdown to complete.
   */
  private async waitForShutdown(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    while (this._isRunning && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this._isRunning) {
      console.warn('[mode-controller] Shutdown timeout - forcing stop');
      this._isRunning = false;
    }
  }

  /**
   * Get current operator status.
   */
  getStatus(): OperatorStatus {
    const metrics = loadMetrics();
    const scratchpad = loadScratchpad();

    return {
      mode: this._mode,
      isExecuting: this._isRunning,
      currentTask: undefined, // Will be set by executor
      queueLength: this._queue?.length || 0,
      lastActivityAt: scratchpad.entries.length > 0
        ? scratchpad.entries[scratchpad.entries.length - 1].timestamp
        : new Date().toISOString(),
      metrics,
      health: this.getHealthStatus(metrics),
      healthMessage: this.getHealthMessage(metrics),
    };
  }

  /**
   * Determine health status based on metrics.
   */
  private getHealthStatus(metrics: typeof loadMetrics extends () => infer R ? R : never): 'healthy' | 'degraded' | 'error' {
    if (metrics.consecutiveErrors >= 10) {
      return 'error';
    }
    if (metrics.consecutiveErrors >= 3) {
      return 'degraded';
    }
    return 'healthy';
  }

  /**
   * Get health message.
   */
  private getHealthMessage(metrics: typeof loadMetrics extends () => infer R ? R : never): string | undefined {
    if (metrics.consecutiveErrors >= 10) {
      return `Critical: ${metrics.consecutiveErrors} consecutive errors. Last: ${metrics.lastError}`;
    }
    if (metrics.consecutiveErrors >= 3) {
      return `Warning: ${metrics.consecutiveErrors} consecutive errors`;
    }
    return undefined;
  }

  /**
   * Reset operator state (for debugging/testing).
   */
  reset(): void {
    console.log('[mode-controller] Resetting operator state...');

    if (this._isRunning) {
      this.stop();
    }

    clearAllState();
    this._queue = null;
    this._mode = 'passive';

    // Update config
    const config = loadConfig();
    config.enabled = false;
    saveConfig(config);

    console.log('[mode-controller] Reset complete');
  }
}

// Singleton instance
let modeControllerInstance: ModeController | null = null;

/**
 * Get the mode controller singleton.
 */
export function getModeController(): ModeController {
  if (!modeControllerInstance) {
    modeControllerInstance = new ModeController();
  }
  return modeControllerInstance;
}

/**
 * Check if active operator mode is enabled.
 */
export function isActiveOperatorEnabled(): boolean {
  const config = loadConfig();
  return config.enabled;
}

/**
 * Quick mode check without full controller initialization.
 */
export function getOperatorMode(): OperatorMode {
  const config = loadConfig();
  return config.enabled ? 'active' : 'passive';
}
