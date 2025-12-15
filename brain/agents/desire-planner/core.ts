/**
 * Desire Planner Agent — Core Logic
 *
 * Generates execution plans for desires using cognitive graph workflow.
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { audit, getLoggedInUsers, withUserContext, getActiveBackend } from '@metahuman/core';

export { processPlanningDesires, loadPlannerConfig, loadGraph } from '../desire-planner.js';
import { processPlanningDesires, loadPlannerConfig } from '../desire-planner.js';

export interface DesirePlannerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesirePlannerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: { planned: number; approved: number; needsApproval: number; rejected: number; failed: number };
}

export async function runCycle(options: DesirePlannerOptions = {}): Promise<DesirePlannerResult> {
  const result: DesirePlannerResult = {
    success: true, usersProcessed: 0, errors: [],
    stats: { planned: 0, approved: 0, needsApproval: 0, rejected: 0, failed: 0 },
  };

  try {
    const config = await loadPlannerConfig();
    if (!config.enabled) {
      console.log('[desire-planner] Disabled in config');
      return result;
    }

    try { console.log(`[desire-planner] Using LLM backend: ${getActiveBackend()}`); } catch {}

    let users: Array<{ userId: string; username: string; role: string }>;
    if (options.username) users = [{ userId: options.username, username: options.username, role: 'owner' }];
    else if (options.singleUser) users = [{ userId: 'default', username: 'default', role: 'owner' }];
    else users = getLoggedInUsers();

    for (const user of users) {
      try {
        await withUserContext(user, async () => {
          const r = await processPlanningDesires(user.username, config);
          result.stats.planned += r.planned;
          result.stats.approved += r.approved;
          result.stats.needsApproval += r.needsApproval;
          result.stats.rejected += r.rejected;
          result.stats.failed += r.failed;
        });
        result.usersProcessed++;
      } catch (error) {
        result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
      }
    }

    audit({ category: 'agent', level: 'info', event: 'desire_planner_completed', actor: 'desire-planner',
      details: { ...result.stats, usersProcessed: result.usersProcessed } });
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) { username = args[i + 1]; break; }
  }

  const options: DesirePlannerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);
  return { success: result.success, data: result.stats, errors: result.errors.length > 0 ? result.errors : undefined, durationMs: Date.now() - startTime };
}
