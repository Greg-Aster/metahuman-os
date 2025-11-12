#!/usr/bin/env tsx
/**
 * Curiosity Service Agent
 *
 * Monitors user inactivity and asks thoughtful questions when appropriate.
 * Respects maxOpenQuestions limit and trust/autonomy policies.
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  callLLM,
  type RouterMessage,
  captureEvent,
  paths,
  audit,
  loadPersonaCore,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel
} from '@metahuman/core';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Check if user is currently active
 * TODO: Integrate with activity-ping API once available
 */
async function isUserActive(username: string): Promise<boolean> {
  const config = loadCuriosityConfig();
  const stateDir = paths.state;
  const activityFile = path.join(stateDir, 'last-activity.json');

  if (!fsSync.existsSync(activityFile)) return false;

  try {
    const data = JSON.parse(await fs.readFile(activityFile, 'utf-8'));
    const lastActivity = new Date(data.timestamp);
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastActivity.getTime()) / 1000;
    return elapsedSeconds < config.inactivityThresholdSeconds;
  } catch {
    return false;
  }
}

/**
 * Count pending (unanswered) questions
 */
async function countPendingQuestions(): Promise<number> {
  const pendingDir = paths.curiosityQuestionsPending;

  if (!fsSync.existsSync(pendingDir)) {
    await fs.mkdir(pendingDir, { recursive: true });
    return 0;
  }

  const files = await fs.readdir(pendingDir);
  return files.filter(f => f.endsWith('.json')).length;
}

/**
 * Expire old unanswered questions
 * Default: 7 days for unanswered questions
 */
async function expireOldQuestions(): Promise<number> {
  const pendingDir = paths.curiosityQuestionsPending;
  const expiredDir = path.join(paths.curiosity, 'expired');

  if (!fsSync.existsSync(pendingDir)) {
    return 0;
  }

  await fs.mkdir(expiredDir, { recursive: true });

  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  let expiredCount = 0;

  const files = await fs.readdir(pendingDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const questionPath = path.join(pendingDir, file);
      const questionData = JSON.parse(await fs.readFile(questionPath, 'utf-8'));
      const askedAt = new Date(questionData.askedAt).getTime();
      const age = now - askedAt;

      if (age > maxAgeMs) {
        // Move to expired directory
        questionData.status = 'expired';
        questionData.expiredAt = new Date().toISOString();

        await fs.writeFile(
          path.join(expiredDir, file),
          JSON.stringify(questionData, null, 2)
        );
        await fs.unlink(questionPath);

        expiredCount++;

        audit({
          category: 'action',
          level: 'info',
          message: 'Curiosity question expired',
          actor: 'curiosity-service',
          metadata: { questionId: questionData.id, ageInDays: Math.floor(age / (24 * 60 * 60 * 1000)) }
        });

        console.log(`[curiosity-service] Expired question ${questionData.id} (${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`);
      }
    } catch (err) {
      console.warn(`[curiosity-service] Failed to process ${file} for expiration:`, err);
    }
  }

  return expiredCount;
}

/**
 * Sample recent memories (simple version - enhance later with weighted selection)
 */
async function sampleRecentMemories(count: number): Promise<any[]> {
  const episodicDir = paths.episodic;
  if (!fsSync.existsSync(episodicDir)) return [];

  const memories: any[] = [];
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // Last 7 days

  async function walk(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
            const timestamp = new Date(content.timestamp).getTime();
            const age = now - timestamp;

            // Filter: recent, not self-referential
            if (age < maxAgeMs &&
                content.type !== 'curiosity_question' &&
                content.type !== 'reflection' &&
                content.type !== 'dream') {
              memories.push({ ...content, __file: fullPath });
            }
          } catch {}
        }
      }
    } catch {}
  }

  await walk(episodicDir);

  // Sort by recency and take top N
  memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return memories.slice(0, count);
}

/**
 * Generate a curiosity question for a single user
 */
async function generateUserQuestion(username: string): Promise<boolean> {
  console.log(`[curiosity-service] Processing user: ${username}`);

  const config = loadCuriosityConfig();
  const trust = loadTrustLevel();

  // Check if system is enabled
  if (config.maxOpenQuestions === 0) {
    console.log(`[curiosity-service] Curiosity disabled (maxOpenQuestions = 0)`);
    return false;
  }

  // Check if user has permission (min trust level)
  const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto'];
  const currentTrustIdx = trustLevels.indexOf(trust);
  const requiredTrustIdx = trustLevels.indexOf(config.minTrustLevel);

  if (currentTrustIdx < requiredTrustIdx) {
    console.log(`[curiosity-service] Trust level ${trust} below minimum ${config.minTrustLevel}, skipping`);
    return false;
  }

  // Check inactivity
  const active = await isUserActive(username);
  if (active) {
    console.log(`[curiosity-service] User ${username} is active, skipping question`);
    return false;
  }

  // Check question limit
  const pendingCount = await countPendingQuestions();
  if (pendingCount >= config.maxOpenQuestions) {
    console.log(`[curiosity-service] Already have ${pendingCount} pending questions (max ${config.maxOpenQuestions}), skipping`);
    return false;
  }

  // Sample recent memories for context
  const recentMemories = await sampleRecentMemories(5);
  if (recentMemories.length === 0) {
    console.log(`[curiosity-service] No memories to base questions on yet`);
    return false;
  }

  // Generate question via LLM
  const persona = loadPersonaCore();
  const memoriesText = recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');

  const systemPrompt = `
You are ${persona.identity.name}'s curiosity engine. Based on recent memories, ask ONE thoughtful question that could deepen understanding or uncover interesting connections.

Guidelines:
- Keep questions open-ended and engaging
- Focus on "why" and "how" over "what"
- Connect memories to broader patterns
- Avoid yes/no questions
- Keep under 100 words
- Be genuinely curious, not formulaic
  `.trim();

  const userPrompt = `
Recent memories:
${memoriesText}

What thoughtful question could deepen ${persona.identity.humanName || 'your'} understanding of these experiences or patterns?
  `.trim();

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: { temperature: 0.8 }
    });

    const question = response.content.trim();
    if (!question) {
      console.log(`[curiosity-service] LLM returned empty question`);
      return false;
    }

    // Store question
    const questionId = `cur-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const questionData = {
      id: questionId,
      question,
      askedAt: new Date().toISOString(),
      seedMemories: recentMemories.map(m => m.__file).filter(Boolean),
      status: 'pending',
      trustLevel: trust,
      autonomyMode: 'normal' // TODO: integrate with autonomy system
    };

    const questionFile = path.join(paths.curiosityQuestionsPending, `${questionId}.json`);
    await fs.mkdir(paths.curiosityQuestionsPending, { recursive: true });
    await fs.writeFile(questionFile, JSON.stringify(questionData, null, 2));

    // Emit as episodic event
    captureEvent(question, {
      type: 'curiosity_question',
      tags: ['curiosity', 'question', 'idle'],
      metadata: {
        curiosity: {
          questionId,
          topic: 'general',
          seedMemories: questionData.seedMemories,
          askedAt: questionData.askedAt
        }
      }
    });

    audit({
      category: 'action',
      level: 'info',
      message: 'Curiosity service asked a question',
      actor: 'curiosity-service',
      metadata: {
        questionId,
        question: question.substring(0, 100),
        pendingCount: pendingCount + 1,
        trust,
        autonomy: 'normal'
      }
    });

    console.log(`[curiosity-service] Asked: "${question.substring(0, 60)}..."`);
    return true;

  } catch (error) {
    console.error(`[curiosity-service] Error generating question:`, error);
    audit({
      category: 'system',
      level: 'error',
      message: `Curiosity service error: ${(error as Error).message}`,
      actor: 'curiosity-service',
      metadata: { error: (error as Error).stack, username }
    });
    return false;
  }
}

/**
 * Main entry point (multi-user)
 */
async function run() {
  initGlobalLogger('curiosity-service');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-curiosity')) {
      console.log('[curiosity-service] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-curiosity');
  } catch {
    console.log('[curiosity-service] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[curiosity-service] Starting curiosity cycle (multi-user)...');

  audit({
    category: 'action',
    level: 'info',
    message: 'Curiosity service starting cycle',
    actor: 'curiosity-service'
  });

  try {
    const users = listUsers();
    console.log(`[curiosity-service] Found ${users.length} users to process`);

    let questionsAsked = 0;
    let questionsExpired = 0;

    for (const user of users) {
      try {
        const stats = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            // First, expire old questions
            const expired = await expireOldQuestions();

            // Then, generate new question if appropriate
            const asked = await generateUserQuestion(user.username);

            return { expired, asked };
          }
        );

        if (stats.asked) questionsAsked++;
        questionsExpired += stats.expired;
      } catch (error) {
        console.error(`[curiosity-service] Failed to process user ${user.username}:`, (error as Error).message);
      }
    }

    console.log(`[curiosity-service] Cycle complete. Asked ${questionsAsked} questions, expired ${questionsExpired} old questions across ${users.length} users.`);

    audit({
      category: 'action',
      level: 'info',
      message: 'Curiosity service completed cycle',
      actor: 'curiosity-service',
      metadata: { questionsAsked, questionsExpired, userCount: users.length }
    });

  } finally {
    lock.release();
  }
}

run().catch(console.error);
