/** In-process mobile executors attached to the sole work coordinator. */

import path from 'node:path';
import { ensureQueueSystemStarted, getQueueSystem } from '../queue/queue-system.js';
import { claimWorkCoordinatorOwnership } from '../queue/work-submission.js';

export type MobileAgentPriority = 'low' | 'normal' | 'high';

export interface MobileAgentContext {
  username?: string;
  profileRoot: string;
  dataDir: string;
  signal?: AbortSignal;
}

export interface MobileAgentRegistration {
  id: string;
  name: string;
  run: (context: MobileAgentContext) => Promise<void>;
  usesLLM?: boolean;
  priority?: MobileAgentPriority;
  intervalSeconds?: number;
}

const registeredAgentIds = new Set<string>();

export async function initializeMobileAgents(
  dataDir: string,
  username = '',
  agents: MobileAgentRegistration[] = [],
): Promise<void> {
  claimWorkCoordinatorOwnership();
  const system = await ensureQueueSystemStarted();
  for (const agent of agents) {
    const handlerId = `agent.${agent.id}`;
    system.engine.registerHandler(handlerId, async (task, context) => {
      await agent.run({
        username: task.username || username,
        profileRoot: path.join(dataDir, 'profiles', task.username || username || 'default'),
        dataDir,
        signal: context.signal,
      });
      return { agentId: agent.id };
    });
    system.triggers.registerTrigger({
      id: agent.id,
      enabled: true,
      type: agent.intervalSeconds ? 'interval' : 'manual',
      priority: agent.priority ?? 'normal',
      usesLLM: agent.usesLLM ?? true,
      interval: agent.intervalSeconds,
      maxRetries: 1,
    });
    registeredAgentIds.add(agent.id);
  }
}

export function stopMobileAgents(): void {
  const system = getQueueSystem();
  for (const agentId of registeredAgentIds) {
    system.engine.unregisterHandler(`agent.${agentId}`);
    system.triggers.unregisterTrigger(agentId);
  }
  registeredAgentIds.clear();
}
