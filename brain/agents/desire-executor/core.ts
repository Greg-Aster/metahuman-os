/**
 * Desire Executor Agent — Core Logic
 *
 * Executes approved desires through the operator system.
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { audit, getLoggedInUsers, withUserContext } from '@metahuman/core';

export { processApprovedDesires, executePlan, executeStep } from '../desire-executor.js';
import { processApprovedDesires } from '../desire-executor.js';

export interface DesireExecutorOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesireExecutorResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: { executed: number; succeeded: number; failed: number };
}

export async function runCycle(options: DesireExecutorOptions = {}): Promise<DesireExecutorResult> {
  const result: DesireExecutorResult = {
    success: true, usersProcessed: 0, errors: [],
    stats: { executed: 0, succeeded: 0, failed: 0 },
  };

  try {
    let users: Array<{ userId: string; username: string; role: string }>;
    if (options.username) users = [{ userId: options.username, username: options.username, role: 'owner' }];
    else if (options.singleUser) users = [{ userId: 'default', username: 'default', role: 'owner' }];
    else users = getLoggedInUsers();

    for (const user of users) {
      try {
        await withUserContext(user, async () => {
          const r = await processApprovedDesires(user.username);
          result.stats.executed += r.executed;
          result.stats.succeeded += r.succeeded;
          result.stats.failed += r.failed;
        });
        result.usersProcessed++;
      } catch (error) {
        result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
      }
    }

    audit({ category: 'agent', level: 'info', event: 'desire_executor_completed', actor: 'desire-executor',
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

  const options: DesireExecutorOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);
  return { success: result.success, data: result.stats, errors: result.errors.length > 0 ? result.errors : undefined, durationMs: Date.now() - startTime };
}
