#!/usr/bin/env node
/**
 * Conversation Summarizer Agent — CLI Entry Point
 *
 * Usage:
 *   tsx brain/agents/summarizer/cli.ts --session=conv-1699358400-x7k2p9q1
 *   tsx brain/agents/summarizer/cli.ts --auto
 *   tsx brain/agents/summarizer/cli.ts --auto --user=<userId>
 */

import {
  initGlobalLogger,
  getLoggedInUsers,
  withUserContext,
} from '@metahuman/core';
import { summarizeSession, autoSummarize } from './core.js';

async function main() {
  initGlobalLogger();

  const args = process.argv.slice(2);
  const sessionArg = args.find(a => a.startsWith('--session='));
  const autoMode = args.includes('--auto');
  const userArg = args.find(a => a.startsWith('--user='));

  let targetUserId: string | undefined;
  if (userArg) {
    targetUserId = userArg.split('=')[1];
  }

  const users = getLoggedInUsers();
  const userIds = targetUserId ? [targetUserId] : users.map(u => u.userId);

  if (userIds.length === 0) {
    console.log('[summarizer] No users found');
    return;
  }

  try {
    for (const userId of userIds) {
      console.log(`[summarizer] Processing user: ${userId}`);

      await withUserContext({ userId, username: userId, role: 'owner' }, async () => {
        if (sessionArg) {
          const sessionId = sessionArg.split('=')[1];
          await summarizeSession(sessionId);
        } else if (autoMode) {
          await autoSummarize();
        } else {
          console.error('[summarizer] Usage: --session=<id> OR --auto');
          console.error('[summarizer] Optional: --user=<userId>');
        }
      });
    }
  } catch (error) {
    console.error('[summarizer] Error:', error);
  }
}

// Run if called directly
main();
