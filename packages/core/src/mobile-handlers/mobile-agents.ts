/** In-process mobile executors attached to the sole work coordinator. */

import path from 'node:path';
import { ensureQueueSystemStarted, getQueueSystem } from '../queue/queue-system.js';
import { claimWorkCoordinatorOwnership } from '../queue/work-submission.js';

export interface MobileAgentContext {
  username?: string;
  profileRoot: string;
  dataDir: string;
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
      await agent.run({
        username: task.username || username,
        profileRoot: path.join(dataDir, 'profiles', task.username || username || 'default'),
        dataDir,
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
