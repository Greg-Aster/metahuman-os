/**
 * Active Operator autonomy-mode controller.
 *
 * It owns no queue and executes no task. It only enables configured timer
 * admission and the bounded full-autonomy policy producer.
 */

import { EventEmitter } from 'node:events';
import { audit } from '../audit.js';
import { ensureQueueSystemStarted, getQueueManager } from '../queue/index.js';
import type { AutonomyMode } from '../queue/types.js';
import { readLastActiveUsername } from '../system-activity.js';
import { getOperatorPolicyService } from './operator-policy-service.js';
import { loadConfig, saveConfig } from './state-persister.js';

export class ModeController extends EventEmitter {
  private currentMode: AutonomyMode;
  private applying = false;

  constructor() {
    super();
    const config = loadConfig();
    this.currentMode = config.autonomyMode;
  }

  get mode(): AutonomyMode {
    return this.currentMode;
  }

  get isActive(): boolean {
    return this.currentMode === 'full';
  }

  get isRunning(): boolean {
    return getOperatorPolicyService().isRunning();
  }

  get shutdownRequested(): boolean {
    return !getOperatorPolicyService().isRunning();
  }

  async applyConfiguredMode(username?: string): Promise<AutonomyMode> {
    const config = loadConfig();
    const mode = config.autonomyMode;
    await this.applyMode(mode, username || readLastActiveUsername() || 'system', false);
    return mode;
  }

  async setMode(mode: AutonomyMode, username: string): Promise<void> {
    if (!['reactive', 'semi', 'full'].includes(mode)) throw new Error(`Invalid autonomy mode: ${mode}`);
    await this.applyMode(mode, username, true);
  }

  private async applyMode(mode: AutonomyMode, username: string, persist: boolean): Promise<void> {
    if (this.applying) throw new Error('Autonomy mode transition already in progress');
    this.applying = true;
    const previousMode = this.currentMode;
    try {
      const system = await ensureQueueSystemStarted();
      system.setProactiveScheduling(mode === 'semi' || mode === 'full');
      const config = loadConfig();
      if (mode === 'full') {
        getOperatorPolicyService().start(username, {
          cooldownMs: config.cooldownMs,
          maxConsecutiveTasks: config.maxConsecutiveTasks,
          maxEvaluationsPerHour: config.maxEvaluationsPerHour,
          userPresenceCooldownMs: config.userPresenceCooldownMs,
        });
      } else {
        getOperatorPolicyService().stop();
      }
      this.currentMode = mode;
      if (persist) {
        saveConfig({ ...config, autonomyMode: mode });
      }
      audit({
        category: 'system',
        level: 'info',
        event: 'active_operator_mode_changed',
        actor: 'mode-controller',
        details: { previousMode, newMode: mode },
      });
      this.emit('modeChanged', mode);
    } finally {
      this.applying = false;
    }
  }

  async toggleMode(username = 'system'): Promise<AutonomyMode> {
    await this.setMode(this.currentMode === 'full' ? 'reactive' : 'full', username);
    return this.currentMode;
  }

  async start(username = 'system'): Promise<void> {
    await this.setMode('full', username);
  }

  async stop(username = 'system'): Promise<void> {
    await this.setMode('reactive', username);
  }

  async emergencyStop(username = 'system'): Promise<void> {
    getOperatorPolicyService().stop();
    const manager = getQueueManager();
    for (const task of manager.getAllTasks()) {
      if (task.source === 'autonomy') manager.cancel(task.id, 'Active Operator emergency stop');
    }
    const { enqueueConnectedEnvironmentStops } = await import('../environment-interface/store.js');
    enqueueConnectedEnvironmentStops(username);
    await this.setMode('reactive', username);
    audit({ category: 'system', level: 'warn', event: 'active_operator_emergency_stop', actor: username });
  }

  getStatus() {
    const manager = getQueueManager();
    const currentTask = manager.getAllTasks().find(task => task.handler === 'operator.policy' && task.state === 'leased');
    return {
      mode: this.currentMode,
      isExecuting: Boolean(currentTask),
      currentTask: currentTask || undefined,
      queueLength: manager.getAllTasks().length,
      lastActivityAt: manager.getHistory()[0]?.completedAt || new Date().toISOString(),
      health: getOperatorPolicyService().isRunning() || this.currentMode !== 'full' ? 'healthy' as const : 'degraded' as const,
      healthMessage: this.currentMode === 'full' && !getOperatorPolicyService().isRunning()
        ? 'Full autonomy policy service is not running'
        : undefined,
      policy: getOperatorPolicyService().getStatus(),
    };
  }

  async reset(username = 'system'): Promise<void> {
    await this.setMode('reactive', username);
  }
}

let instance: ModeController | null = null;

export function getModeController(): ModeController {
  if (!instance) instance = new ModeController();
  return instance;
}

export function getOperatorMode(): AutonomyMode {
  return loadConfig().autonomyMode;
}
