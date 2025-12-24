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
  getTargetUser,
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

  // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
  let userId = targetUserId;
  if (!userId) {
    const activeUser = getTargetUser();
    if (activeUser) {
      userId = activeUser.userId;
    }
  }

  if (!userId) {
    console.log('[summarizer] No active user found');
    return;
  }

  try {
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
  } catch (error) {
    console.error('[summarizer] Error:', error);
  }
}

// Run if called directly
main();
