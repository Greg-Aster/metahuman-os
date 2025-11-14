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
  getLoggedInUsers,
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
 * Count recent curiosity questions (last 24 hours)
 * No longer uses pending directory - questions only in episodic memory
 */
async function countPendingQuestions(): Promise<number> {
  // Since we're not tracking pending questions anymore,
  // this is primarily for frequency control, not answer tracking
  // Return 0 to allow questions (no artificial limit)
  return 0;
}

/**
 * Get timestamp of most recent question asked
 * Scans audit logs for chat_assistant events with curiosityQuestionId
 */
async function getLastQuestionTime(): Promise<number | null> {
  const auditDir = path.join(paths.logs, 'audit');

  if (!fsSync.existsSync(auditDir)) {
    return null;
  }

  try {
    // Check today's and yesterday's audit logs (questions should be recent)
    const dates = [
      new Date().toISOString().split('T')[0],
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    ];

    let mostRecent = 0;

    for (const date of dates) {
      const auditFile = path.join(auditDir, `${date}.ndjson`);
      if (!fsSync.existsSync(auditFile)) continue;

      const content = await fs.readFile(auditFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Scan audit entries for curiosity questions (reverse order for efficiency)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);

          // Check if this is a curiosity question audit event
          if (entry.event === 'chat_assistant' &&
              entry.details?.curiosityQuestionId &&
              entry.timestamp) {
            const timestamp = new Date(entry.timestamp).getTime();
            if (timestamp > mostRecent) {
              mostRecent = timestamp;
            }
          }
        } catch {}
      }
    }

    return mostRecent || null;
  } catch {
    return null;
  }
}

/**
 * Expire old questions (no-op now that questions are only in episodic memory)
 * Questions naturally age out with episodic memory, no manual expiration needed
 */
async function expireOldQuestions(): Promise<number> {
  // No longer needed - questions only exist in episodic memory
  // They age out naturally with the rest of conversation history
  return 0;
}

/**
 * Get ALL memories with weighted selection (same algorithm as reflector)
 * This ensures curiosity questions are based on meaningful, diverse memories
 * rather than just the most recent ones
 */
async function getAllMemories(): Promise<Array<{ file: string; timestamp: Date; content: any }>> {
  const episodicDir = paths.episodic;
  const allMemories: Array<{ file: string; timestamp: Date; content: any }> = [];

  async function walk(dir: string, acc: Array<{ file: string; timestamp: Date; content: any }>) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        await walk(fullPath, acc);
      } else if (stats.isFile() && entry.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));

          // Skip self-referential types (avoid asking questions about questions)
          if (content.type === 'curiosity_question' ||
              content.type === 'reflection' ||
              content.type === 'inner_dialogue' ||
              content.type === 'dream' ||
              content.metadata?.type === 'curiosity_question' ||
              content.metadata?.type === 'reflection' ||
              content.metadata?.type === 'inner_dialogue') {
            continue;
          }

          acc.push({
            file: fullPath,
            timestamp: new Date(content.timestamp),
            content
          });
        } catch {
          // Skip malformed files
        }
      }
    }
  }

  await walk(episodicDir, allMemories);

  // Sort by timestamp (newest first)
  allMemories.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allMemories;
}

/**
 * Sample memories using weighted selection (favors recent but includes older meaningful memories)
 * Uses exponential decay with 14-day half-life, same as reflector
 */
async function sampleRecentMemories(count: number): Promise<any[]> {
  const allMemories = await getAllMemories();
  if (allMemories.length === 0) return [];

  const now = Date.now();
  const decayFactor = 14; // Days - same as reflector
  const selected: any[] = [];
  const usedIndices = new Set<number>();

  // Technical keywords to deprioritize (avoid meta-questions about the system)
  const technicalKeywords = [
    'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
    'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
    'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
  ];

  for (let i = 0; i < count && selected.length < Math.min(count, allMemories.length); i++) {
    // Calculate weights for all unused memories
    const weights = allMemories.map((mem, idx) => {
      if (usedIndices.has(idx)) return 0;

      const ageInDays = (now - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      let weight = Math.exp(-ageInDays / decayFactor);

      // Reduce weight for technical development memories
      const contentLower = mem.content.content?.toLowerCase() || '';
      const isTechnical = technicalKeywords.some(kw => contentLower.includes(kw));
      if (isTechnical) {
        weight *= 0.3;
      }

      return weight;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) break;

    // Weighted random selection
    let rand = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (let idx = 0; idx < allMemories.length; idx++) {
      cumulativeWeight += weights[idx];
      if (rand <= cumulativeWeight) {
        selected.push(allMemories[idx].content);
        usedIndices.add(idx);
        break;
      }
    }
  }

  return selected;
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
  const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
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

  // Check if enough time has passed since last question (frequency control)
  const questionInterval = config.questionIntervalSeconds || 1800; // Default 30 min
  const lastQuestionTime = await getLastQuestionTime();
  if (lastQuestionTime) {
    const timeSinceLastQuestion = (Date.now() - lastQuestionTime) / 1000;
    if (timeSinceLastQuestion < questionInterval) {
      console.log(`[curiosity-service] Only ${Math.round(timeSinceLastQuestion/60)}min since last question, need ${Math.round(questionInterval/60)}min`);
      return false;
    }
  }

  // Enforce user-defined limit on outstanding questions
  const pendingCount = await countPendingQuestions();
  if (pendingCount >= config.maxOpenQuestions) {
    console.log(`[curiosity-service] Already have ${pendingCount} pending questions (max ${config.maxOpenQuestions}), skipping`);
    return false;
  }

  // Sample memories using weighted selection (diverse, meaningful memories)
  const recentMemories = await sampleRecentMemories(5);
  if (recentMemories.length === 0) {
    console.log(`[curiosity-service] No memories to base questions on yet`);
    return false;
  }

  console.log(`[curiosity-service] Selected ${recentMemories.length} weighted memories for question generation`);

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

    // Generate question ID for tracking
    const questionId = `cur-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const askedAt = new Date().toISOString();
    const seedMemories = recentMemories.map(m => m.__file).filter(Boolean);

    // Format question for display
    const questionText = `💭 I'm curious: ${question}`;

    // Emit chat_assistant audit event so SSE stream picks it up
    // Questions are NOT saved to episodic memory until user replies
    // This keeps training data clean by only including actual conversations
    audit({
      category: 'action',
      level: 'info',
      event: 'chat_assistant',
      details: {
        mode: 'conversation',
        content: questionText,
        cognitiveMode: 'dual',
        usedOperator: false,
        curiosityQuestionId: questionId,
        // Store full question data for retrieval when user replies
        curiosityData: {
          questionId,
          questionText,
          rawQuestion: question,
          topic: 'general',
          seedMemories,
          askedAt,
          isCuriosityQuestion: true
        }
      },
      actor: 'curiosity-service',
      metadata: {
        questionId,
        question: question.substring(0, 100),
        trust,
        autonomy: 'normal',
        username
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
 * Main entry point - processes all logged-in users
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

  console.log('[curiosity-service] Starting curiosity cycle (logged-in users only)...');

  audit({
    category: 'action',
    level: 'info',
    event: 'curiosity_service_start',
    details: { phase: 'cycle_start' },
    actor: 'curiosity-service'
  });

  try {
    // Get all logged-in users (active sessions only)
    const loggedInUsers = getLoggedInUsers();

    if (loggedInUsers.length === 0) {
      console.log('[curiosity-service] No logged-in users found, exiting.');
      return;
    }

    console.log(`[curiosity-service] Processing ${loggedInUsers.length} logged-in user(s)...`);

    let totalQuestionsAsked = 0;
    let totalQuestionsExpired = 0;

    // Process each logged-in user sequentially with isolated context
    for (const user of loggedInUsers) {
      console.log(`[curiosity-service] Processing user: ${user.username}`);

      try {
        const stats = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => {
            // First, expire old questions
            const expired = await expireOldQuestions();

            // Then, generate new question if appropriate
            const asked = await generateUserQuestion(user.username);

            return { expired, asked };
          }
        );

        if (stats.asked) totalQuestionsAsked++;
        totalQuestionsExpired += stats.expired;
      } catch (error) {
        console.error(`[curiosity-service] Failed to process user ${user.username}:`, (error as Error).message);
        audit({
          category: 'system',
          level: 'error',
          event: 'curiosity_service_user_error',
          details: {
            error: (error as Error).message,
            username: user.username
          },
          actor: 'curiosity-service'
        });
      }
    }

    console.log(`[curiosity-service] Cycle complete. Asked ${totalQuestionsAsked} questions, expired ${totalQuestionsExpired} old questions across ${loggedInUsers.length} user(s).`);

    audit({
      category: 'action',
      level: 'info',
      event: 'curiosity_service_complete',
      details: {
        questionsAsked: totalQuestionsAsked,
        questionsExpired: totalQuestionsExpired,
        usersProcessed: loggedInUsers.length
      },
      actor: 'curiosity-service'
    });

  } finally {
    lock.release();
  }
}

run().catch(console.error);
