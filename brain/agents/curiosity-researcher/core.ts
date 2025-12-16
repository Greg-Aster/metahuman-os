/**
 * Curiosity Researcher Agent — Core Logic
 *
 * Performs deeper research on curiosity questions by:
 * - Sampling related memories based on question topics
 * - Running semantic searches for context
 * - Optionally performing web searches (if trust level permits)
 * - Storing research notes for future reference
 *
 * This module provides:
 * - processUserResearch() for single-user processing
 * - runCycle() for CLI usage
 * - run() for agent-runtime (mobile) usage
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  callLLM,
  type RouterMessage,
  storageClient,
  audit,
  getLoggedInUsers,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel,
  loadPersonaCore,
  searchMemory,
  captureEvent,
} from '@metahuman/core';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CuriosityResearcherOptions {
  singleUser?: boolean;
  username?: string;
}

export interface CuriosityResearcherResult {
  success: boolean;
  usersProcessed: number;
  researchCompleted: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────

/**
 * Perform research on a single question
 */
export async function researchQuestion(
  questionData: any,
  username: string
): Promise<{ notes: string; summary: string } | null> {
  const config = loadCuriosityConfig(username);
  const trust = loadTrustLevel();

  // Check if research is enabled
  if (config.researchMode === 'off') {
    return null;
  }

  console.log(`[curiosity-researcher] Researching question: ${questionData.id}`);

  let researchNotes = `# Research Notes: ${questionData.id}\n\n`;
  researchNotes += `**Question:** ${questionData.question}\n\n`;
  researchNotes += `**Asked:** ${new Date(questionData.askedAt).toLocaleString()}\n\n`;
  researchNotes += `---\n\n`;

  // Local memory research
  if (config.researchMode === 'local' || config.researchMode === 'web') {
    try {
      // Extract key topics from the question
      const topicPrompt = `Extract 2-3 key topics or themes from this question: "${questionData.question}"\nReturn only the topics, comma-separated.`;
      const topicMessages: RouterMessage[] = [
        { role: 'user', content: topicPrompt }
      ];

      const topicResponse = await callLLM({
        role: 'persona',
        messages: topicMessages,
        options: { temperature: 0.3, max_tokens: 50 }
      });

      const topics = topicResponse.content.trim().split(',').map((t: string) => t.trim()).filter(Boolean);
      researchNotes += `## Key Topics\n`;
      topics.forEach((topic: string) => {
        researchNotes += `- ${topic}\n`;
      });
      researchNotes += `\n`;

      // Search memories for each topic
      researchNotes += `## Related Memories\n\n`;
      for (const topic of topics.slice(0, 3)) { // Limit to 3 topics
        try {
          const results = await searchMemory(topic, { limit: 5 });
          if (results.length > 0) {
            researchNotes += `### ${topic}\n\n`;
            results.forEach((result: any) => {
              const content = result.content?.substring(0, 200) || '';
              researchNotes += `- ${content}${content.length >= 200 ? '...' : ''}\n`;
              researchNotes += `  *${new Date(result.timestamp).toLocaleDateString()}*\n\n`;
            });
          }
        } catch (err) {
          console.warn(`[curiosity-researcher] Failed to search for topic "${topic}":`, err);
        }
      }

      researchNotes += `\n`;
    } catch (err) {
      console.error(`[curiosity-researcher] Error extracting topics:`, err);
    }
  }

  // Web research (requires higher trust)
  if (config.researchMode === 'web') {
    const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
    const currentTrustIdx = trustLevels.indexOf(trust);
    const requiredTrustIdx = trustLevels.indexOf('supervised_auto');

    if (currentTrustIdx >= requiredTrustIdx) {
      researchNotes += `## Web Research\n`;
      researchNotes += `*Web research capability available but not yet implemented.*\n`;
      researchNotes += `*Trust level: ${trust} (sufficient for web search)*\n\n`;
    } else {
      researchNotes += `## Web Research\n`;
      researchNotes += `*Skipped: Trust level ${trust} below required level (supervised_auto)*\n\n`;
    }
  }

  // Generate research summary using LLM
  let summary = '';
  try {
    const summaryPrompt = `Based on the following research notes about a curiosity question, provide a 2-3 sentence summary of the most interesting insights or patterns discovered:\n\n${researchNotes}`;
    const summaryMessages: RouterMessage[] = [
      { role: 'user', content: summaryPrompt }
    ];

    const summaryResponse = await callLLM({
      role: 'persona',
      messages: summaryMessages,
      options: { temperature: 0.7, max_tokens: 150 }
    });

    summary = summaryResponse.content.trim();
    researchNotes += `## Summary\n`;
    researchNotes += summary + `\n\n`;
  } catch (err) {
    console.error(`[curiosity-researcher] Error generating summary:`, err);
  }

  researchNotes += `---\n`;
  researchNotes += `*Generated: ${new Date().toISOString()}*\n`;

  return { notes: researchNotes, summary };
}

/**
 * Process research for a single user
 */
export async function processUserResearch(username: string): Promise<number> {
  return await withUserContext(username, async () => {
    // Resolve curiosity paths using storage router
    const curiosityResult = storageClient.resolvePath({ category: 'memory', subcategory: 'curiosity' });
    if (!curiosityResult.success || !curiosityResult.path) {
      console.error('[curiosity-researcher] Cannot resolve curiosity path');
      return 0;
    }
    const pendingDir = path.join(curiosityResult.path, 'questions', 'pending');
    const researchDir = path.join(curiosityResult.path, 'research');

    if (!fsSync.existsSync(pendingDir)) {
      return 0;
    }

    await fs.mkdir(researchDir, { recursive: true });

    let researchCount = 0;
    const files = await fs.readdir(pendingDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const questionPath = path.join(pendingDir, file);
        const questionData = JSON.parse(await fs.readFile(questionPath, 'utf-8'));

        // Check if research already exists
        const researchFilename = `${questionData.id}-research.md`;
        const researchPath = path.join(researchDir, researchFilename);

        if (fsSync.existsSync(researchPath)) {
          console.log(`[curiosity-researcher] Research already exists for ${questionData.id}, skipping`);
          continue;
        }

        // Perform research
        const researchResult = await researchQuestion(questionData, username);

        if (researchResult) {
          await fs.writeFile(researchPath, researchResult.notes, 'utf-8');
          researchCount++;

          // Save research summary as inner dialogue event
          if (researchResult.summary) {
            const summaryText = `🔍 Research observation: ${researchResult.summary}`;
            captureEvent(summaryText, {
              type: 'inner_dialogue',
              tags: ['curiosity', 'research', 'inner'],
              metadata: {
                curiosity: {
                  questionId: questionData.id,
                  researchFile: researchFilename,
                  question: questionData.question
                }
              }
            });
          }

          audit({
            category: 'action',
            level: 'info',
            message: 'Curiosity research completed',
            actor: 'curiosity-researcher',
            metadata: {
              questionId: questionData.id,
              username,
              researchFile: researchFilename
            }
          });

          console.log(`[curiosity-researcher] Completed research for ${questionData.id}`);
        }

        // Rate limit: only process one question per run to avoid overwhelming the system
        break;
      } catch (err) {
        console.error(`[curiosity-researcher] Error processing ${file}:`, err);
      }
    }

    return researchCount;
  });
}

/**
 * Find a logged-in user to process (returns first logged-in user or null)
 */
export function getMostRecentlyActiveUser(): { userId: string; username: string; role: string } | null {
  const users = getLoggedInUsers();
  if (users.length === 0) return null;

  // Prefer owner if logged in
  const owner = users.find(u => u.role === 'owner');
  if (owner) {
    return owner;
  }

  // Return first logged-in user
  return users[0];
}

// ─────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Run curiosity researcher cycle (CLI usage)
 */
export async function runCycle(options: CuriosityResearcherOptions = {}): Promise<CuriosityResearcherResult> {
  const result: CuriosityResearcherResult = {
    success: true,
    usersProcessed: 0,
    researchCompleted: 0,
    errors: [],
  };

  try {
    // Determine user to process
    let targetUser: { username: string } | null = null;

    if (options.username) {
      targetUser = { username: options.username };
    } else if (options.singleUser) {
      targetUser = { username: 'default' };
    } else {
      // Default: process most recently active user only
      const activeUser = getMostRecentlyActiveUser();
      if (activeUser) {
        targetUser = { username: activeUser.username };
      }
    }

    if (!targetUser) {
      console.log('[curiosity-researcher] No users found, exiting.');
      return result;
    }

    console.log(`[curiosity-researcher] Processing user: ${targetUser.username}`);

    try {
      const count = await processUserResearch(targetUser.username);
      result.researchCompleted += count;
      result.usersProcessed++;

      if (count > 0) {
        audit({
          category: 'action',
          level: 'info',
          message: 'Curiosity researcher completed cycle',
          actor: 'curiosity-researcher',
          metadata: { researchCompleted: count, username: targetUser.username }
        });
      }
    } catch (error) {
      const errorMsg = `Error processing ${targetUser.username}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(`[curiosity-researcher] ${errorMsg}`);
    }

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    console.error('[curiosity-researcher] Fatal error:', error);
    return result;
  }
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  // Extract username from args or options
  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: CuriosityResearcherOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      researchCompleted: result.researchCompleted,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
