/** In-process mobile executors attached to the sole work coordinator. */

import { ensureQueueSystemStarted, getQueueSystem } from '../queue/queue-system.js';
import { claimWorkCoordinatorOwnership } from '../queue/work-submission.js';

export interface MobileAgentContext {
  username?: string;
  dataDir: string;
  taskId: string;
  createdAt: string;
  args: string[];
  options: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface MobileAgentRegistration {
  id: string;
  name: string;
  handler?: string;
  run: (context: MobileAgentContext) => Promise<void>;
}

const registeredHandlerIds = new Set<string>();

export async function initializeMobileAgents(
  dataDir: string,
  username = '',
  agents: MobileAgentRegistration[] = [],
): Promise<void> {
  claimWorkCoordinatorOwnership();
  const system = await ensureQueueSystemStarted();
  for (const agent of agents) {
    const handlerId = agent.handler || `agent.${agent.id}`;
    system.engine.registerHandler(handlerId, async (task, context) => {
      const taskOptions = task.input.options;
      await agent.run({
        username: task.username || username,
        dataDir,
        taskId: task.id,
        createdAt: task.createdAt,
        args: Array.isArray(task.input.args)
          ? task.input.args.filter((value): value is string => typeof value === 'string')
          : [],
        options: taskOptions && typeof taskOptions === 'object' && !Array.isArray(taskOptions)
          ? { ...taskOptions as Record<string, unknown> }
          : {},
        signal: context.signal,
      });
      return { agentId: agent.id };
    });
    registeredHandlerIds.add(handlerId);
  }
}

export function stopMobileAgents(): void {
  const system = getQueueSystem();
  for (const handlerId of registeredHandlerIds) {
    system.engine.unregisterHandler(handlerId);
  }
  registeredHandlerIds.clear();
}
