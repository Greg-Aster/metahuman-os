/**
 * Mobile agent scheduler compatibility helpers.
 *
 * Concrete brain agent registrations live above core. Core owns only the
 * scheduler primitives and accepts registrations injected by an app/brain
 * integration layer.
 */

import {
  mobileScheduler,
  type MobileAgentRegistration,
} from './mobile-scheduler.js';

export function registerMobileAgents(agents: MobileAgentRegistration[] = []): void {
  for (const agent of agents) {
    mobileScheduler.register(agent);
  }
}

export function initializeMobileAgents(
  dataDir: string,
  username?: string,
  agents: MobileAgentRegistration[] = [],
): void {
  mobileScheduler.initialize(dataDir, username);
  registerMobileAgents(agents);
  mobileScheduler.start();
}

export function stopMobileAgents(): void {
  mobileScheduler.stop();
}
