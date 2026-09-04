/**
 * Active Operator autonomy-mode controller.
 *
 * It owns no queue and executes no task. It only selects the operating mode;
 * Robot Operator owns robot-side autonomy admission.
 */

import { EventEmitter } from 'node:events';
import { audit } from '../audit.js';
import { ensureQueueSystemStarted, getQueueManager } from '../queue/index.js';
import type { AutonomyMode } from '../queue/types.js';
import { isRobotAutonomyWorkItem, readRobotOperatorRuntimeState } from '../robot-operator.js';
import { readLastActiveUsername } from '../system-activity.js';
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
    return this.currentMode !== 'reactive';
  }

  get shutdownRequested(): boolean {
    return this.currentMode === 'reactive';
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
      system.setAutonomyMode(mode);
      const config = loadConfig();
      if (mode === 'reactive') {
        for (const task of getQueueManager().getAllTasks()) {
          const robotAutonomyWork = isRobotAutonomyWorkItem(task)
          if (task.source === 'autonomy' && robotAutonomyWork) {
            getQueueManager().cancel(task.id, 'Robot Operator disabled by Active Operator reactive mode')
          }
        }
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

  async start(username = 'system'): Promise<void> {
    await this.setMode('full', username);
  }

  async stop(username = 'system'): Promise<void> {
    await this.setMode('reactive', username);
  }

  async emergencyStop(username = 'system'): Promise<void> {
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
    const robotAutonomyWork = (task: { source: string; handler: string; input: Record<string, any> }) => (
      task.source === 'autonomy'
      && isRobotAutonomyWorkItem(task)
    );
    const currentTask = manager.getAllTasks().find(task => robotAutonomyWork(task) && task.state === 'leased');
    const runtime = readRobotOperatorRuntimeState();
    const fullRuntimeHealthy = this.currentMode !== 'full'
      || Boolean(runtime && runtime.mode === 'full' && runtime.lifecycle !== 'stopped');
    return {
      mode: this.currentMode,
      isExecuting: Boolean(currentTask),
      currentTask: currentTask || undefined,
      queueLength: manager.getAllTasks().length,
      lastActivityAt: manager.getHistory()[0]?.completedAt || new Date().toISOString(),
      health: fullRuntimeHealthy ? 'healthy' as const : 'degraded' as const,
      healthMessage: !fullRuntimeHealthy
        ? 'Full autonomy is selected, but Robot Operator has not published an active Full-mode runtime state'
        : undefined,
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
