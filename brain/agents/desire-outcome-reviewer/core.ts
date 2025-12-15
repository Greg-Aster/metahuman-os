/**
 * Desire Outcome Reviewer Agent — Core Logic
 *
 * Post-execution review of desires using LLM.
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { audit, getLoggedInUsers, withUserContext } from '@metahuman/core';

export { processDesires, reviewOutcome } from '../desire-outcome-reviewer.js';
import { processDesires } from '../desire-outcome-reviewer.js';

export interface DesireOutcomeReviewerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesireOutcomeReviewerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: { reviewed: number; completed: number; retried: number; abandoned: number; escalated: number; continued: number };
}

export async function runCycle(options: DesireOutcomeReviewerOptions = {}): Promise<DesireOutcomeReviewerResult> {
  const result: DesireOutcomeReviewerResult = {
    success: true, usersProcessed: 0, errors: [],
    stats: { reviewed: 0, completed: 0, retried: 0, abandoned: 0, escalated: 0, continued: 0 },
  };

  try {
    let users: Array<{ userId: string; username: string; role: string }>;
    if (options.username) users = [{ userId: options.username, username: options.username, role: 'owner' }];
    else if (options.singleUser) users = [{ userId: 'default', username: 'default', role: 'owner' }];
    else users = getLoggedInUsers();

    for (const user of users) {
      try {
        await withUserContext(user, async () => {
          const r = await processDesires(user.username);
          result.stats.reviewed += r.reviewed;
          result.stats.completed += r.completed;
          result.stats.retried += r.retried;
          result.stats.abandoned += r.abandoned;
          result.stats.escalated += r.escalated;
          result.stats.continued += r.continued;
        });
        result.usersProcessed++;
      } catch (error) {
        result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
      }
    }

    audit({ category: 'agent', level: 'info', event: 'desire_outcome_reviewer_completed', actor: 'desire-outcome-reviewer',
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

  const options: DesireOutcomeReviewerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);
  return { success: result.success, data: result.stats, errors: result.errors.length > 0 ? result.errors : undefined, durationMs: Date.now() - startTime };
}
