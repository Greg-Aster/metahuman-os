#!/usr/bin/env tsx
/**
 * Curiosity Researcher Agent
 *
 * Performs deeper research on curiosity questions by:
 * - Sampling related memories based on question topics
 * - Running semantic searches for context
 * - Optionally performing web searches (if trust level permits)
 * - Storing research notes for future reference
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  callLLM,
  type RouterMessage,
  paths,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel,
  loadPersonaCore,
  searchMemory
} from '@metahuman/core';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Perform research on a single question
 */
async function researchQuestion(questionData: any): Promise<{ notes: string; summary: string } | null> {
  const config = loadCuriosityConfig();
  const trust = loadTrustLevel();
  const persona = loadPersonaCore();

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
      // TODO: Implement web search integration
      // For now, just note that it's possible
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
async function processUserResearch(username: string): Promise<number> {
  const pendingDir = paths.curiosityQuestionsPending;
  const researchDir = paths.curiosityResearch;

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
      const researchResult = await researchQuestion(questionData);

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
}

/**
 * Find the most recently active user (based on lastLogin)
 */
function getMostRecentlyActiveUser(): { userId: string; username: string; role: string } | null {
  const users = listUsers();
  if (users.length === 0) return null;

  // Filter users with lastLogin, sort by most recent
  const usersWithLogin = users
    .filter(u => u.lastLogin)
    .sort((a, b) => new Date(b.lastLogin!).getTime() - new Date(a.lastLogin!).getTime());

  if (usersWithLogin.length === 0) {
    // If no users have logged in yet, use the owner
    const owner = users.find(u => u.role === 'owner');
    if (owner) {
      return { userId: owner.id, username: owner.username, role: owner.role };
    }
    // Fallback to first user
    return { userId: users[0].id, username: users[0].username, role: users[0].role };
  }

  const mostRecent = usersWithLogin[0];
  return { userId: mostRecent.id, username: mostRecent.username, role: mostRecent.role };
}

/**
 * Main entry point (single active user only)
 */
async function run() {
  initGlobalLogger('curiosity-researcher');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-curiosity-researcher')) {
      console.log('[curiosity-researcher] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-curiosity-researcher');
  } catch {
    console.log('[curiosity-researcher] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[curiosity-researcher] Starting research cycle (active user only)...');

  try {
    // Find most recently active user
    const activeUser = getMostRecentlyActiveUser();

    if (!activeUser) {
      console.log('[curiosity-researcher] No active users found, exiting.');
      return;
    }

    console.log(`[curiosity-researcher] Processing active user: ${activeUser.username}`);

    let totalResearch = 0;

    try {
      const count = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => processUserResearch(activeUser.username)
      );
      totalResearch += count;
    } catch (error) {
      console.error(`[curiosity-researcher] Failed to process user ${activeUser.username}:`, (error as Error).message);
    }

    if (totalResearch > 0) {
      console.log(`[curiosity-researcher] Completed ${totalResearch} research tasks for user ${activeUser.username}.`);

      audit({
        category: 'action',
        level: 'info',
        message: 'Curiosity researcher completed cycle',
        actor: 'curiosity-researcher',
        metadata: { researchCompleted: totalResearch, username: activeUser.username }
      });
    }
  } finally {
    lock.release();
  }
}

run().catch(console.error);
