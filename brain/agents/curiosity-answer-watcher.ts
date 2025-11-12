#!/usr/bin/env tsx
/**
 * Curiosity Answer Watcher Agent
 *
 * Watches for episodic events with answerTo metadata and marks
 * corresponding questions as answered.
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  paths,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext
} from '@metahuman/core';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Process answered questions for a single user
 */
async function processUserAnswers(username: string): Promise<number> {
  const episodicDir = paths.episodic;
  const pendingDir = paths.curiosityQuestionsPending;
  const answeredDir = paths.curiosityQuestionsAnswered;

  if (!fsSync.existsSync(episodicDir) || !fsSync.existsSync(pendingDir)) {
    return 0;
  }

  await fs.mkdir(answeredDir, { recursive: true });

  let answersProcessed = 0;
  const processedQuestionIds = new Set<string>();

  // Walk episodic events looking for answerTo metadata
  async function walkDirectory(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
            const questionId = content.metadata?.curiosity?.answerTo;

            if (questionId && !processedQuestionIds.has(questionId)) {
              // Find matching question
              const questionFile = path.join(pendingDir, `${questionId}.json`);
              if (fsSync.existsSync(questionFile)) {
                // Move to answered
                const question = JSON.parse(await fs.readFile(questionFile, 'utf-8'));
                question.status = 'answered';
                question.answeredAt = new Date().toISOString();
                question.answerEvent = path.relative(paths.root, fullPath);

                await fs.writeFile(
                  path.join(answeredDir, `${questionId}.json`),
                  JSON.stringify(question, null, 2)
                );
                await fs.unlink(questionFile);

                processedQuestionIds.add(questionId);
                answersProcessed++;

                audit({
                  category: 'action',
                  level: 'info',
                  message: 'Curiosity question answered',
                  actor: 'curiosity-answer-watcher',
                  metadata: { questionId, answerEvent: question.answerEvent, username }
                });

                console.log(`[curiosity-answer-watcher] Marked question ${questionId} as answered for ${username}`);
              }
            }
          } catch (err) {
            // Silently skip malformed files
          }
        }
      }
    } catch (err) {
      console.warn(`[curiosity-answer-watcher] Error walking directory ${dir}:`, err);
    }
  }

  await walkDirectory(episodicDir);
  return answersProcessed;
}

/**
 * Main entry point (multi-user)
 */
async function run() {
  initGlobalLogger('curiosity-answer-watcher');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-curiosity-answer-watcher')) {
      console.log('[curiosity-answer-watcher] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-curiosity-answer-watcher');
  } catch {
    console.log('[curiosity-answer-watcher] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[curiosity-answer-watcher] Starting answer detection cycle (multi-user)...');

  try {
    const users = listUsers();
    let totalAnswers = 0;

    for (const user of users) {
      try {
        const answers = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => processUserAnswers(user.username)
        );
        totalAnswers += answers;
      } catch (error) {
        console.error(`[curiosity-answer-watcher] Failed to process user ${user.username}:`, (error as Error).message);
      }
    }

    if (totalAnswers > 0) {
      console.log(`[curiosity-answer-watcher] Processed ${totalAnswers} answers across ${users.length} users.`);

      audit({
        category: 'action',
        level: 'info',
        message: 'Curiosity answer watcher completed cycle',
        actor: 'curiosity-answer-watcher',
        metadata: { answersProcessed: totalAnswers, userCount: users.length }
      });
    }
  } finally {
    lock.release();
  }
}

run().catch(console.error);
