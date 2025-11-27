/**
 * Curiosity Service Node Executors
 * User-aware memory sampling and question generation with privacy isolation
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { callLLM, type RouterMessage, audit, getProfilePaths } from '../index.js';
import type { NodeExecutor } from './types.js';

/**
 * Technical keywords to deprioritize (avoid meta-questions about the system)
 */
const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

/**
 * Get ALL memories for a specific user with privacy isolation
 * Returns all episodic memories sorted by timestamp
 *
 * SECURITY: Uses explicit getProfilePaths(username) to prevent data leakage
 */
async function getAllMemoriesForUser(username: string): Promise<Array<{ file: string; timestamp: Date; content: any }>> {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
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
 * Curiosity Weighted Sampler Node
 *
 * Samples memories using weighted selection with exponential decay (14-day half-life)
 * SECURITY: Uses explicit username from context to ensure user-specific memory access
 *
 * Inputs: None (uses context.userId for user identification)
 * Properties:
 *   - sampleSize: Number of memories to sample (default: 5)
 *   - decayFactor: Days for exponential decay weighting (default: 14)
 *
 * Outputs:
 *   - memories: Array of sampled memory objects
 *   - count: Number of memories sampled
 */
export const curiosityWeightedSamplerExecutor: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId;
  const sampleSize = properties?.sampleSize || 5;
  const decayFactor = properties?.decayFactor || 14; // Days

  if (!username) {
    console.error('[CuriosityWeightedSampler] No username in context');
    return {
      memories: [],
      count: 0,
      error: 'No username in context'
    };
  }

  try {
    // SECURITY: Load memories only for this specific user
    const allMemories = await getAllMemoriesForUser(username);

    if (allMemories.length === 0) {
      return {
        memories: [],
        count: 0,
        note: 'No memories available for sampling'
      };
    }

    const now = Date.now();
    const selected: any[] = [];
    const usedIndices = new Set<number>();

    // Sample using weighted random selection
    for (let i = 0; i < sampleSize && selected.length < Math.min(sampleSize, allMemories.length); i++) {
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

    return {
      memories: selected,
      count: selected.length,
      username, // Include for auditing
      decayFactor
    };
  } catch (error) {
    console.error('[CuriosityWeightedSampler] Error:', error);
    return {
      memories: [],
      count: 0,
      error: (error as Error).message,
      username
    };
  }
};

/**
 * Curiosity Question Generator Node
 *
 * Generates a natural, conversational curiosity question via LLM
 * Uses persona-aware prompt construction from graph nodes
 *
 * Inputs:
 *   - [0] memories: Array of memory objects to base question on
 *   - [1] personaPrompt: Formatted persona string from persona_formatter node
 *
 * Properties:
 *   - temperature: LLM temperature (default: 0.6)
 *
 * Outputs:
 *   - question: Generated question text (without emoji prefix)
 *   - rawQuestion: Same as question (for compatibility)
 */
export const curiosityQuestionGeneratorExecutor: NodeExecutor = async (inputs, context, properties) => {
  const memories = inputs[0]?.memories || [];
  const personaInput = inputs[1];
  const temperature = properties?.temperature || 0.6;
  const username = context.userId;

  if (!username) {
    return {
      question: '',
      error: 'No username in context'
    };
  }

  if (memories.length === 0) {
    return {
      question: '',
      error: 'No memories provided'
    };
  }

  try {
    const memoriesText = memories.map((m: any, i: number) => `${i + 1}. ${m.content}`).join('\n');

    // Get formatted persona from input (injected via graph nodes)
    const personaPrompt = personaInput?.formatted || personaInput || '';

    // Build system prompt with persona context
    const systemPrompt = `
${personaPrompt}

Looking back at these recent memories, you're genuinely curious about something. Ask the user ONE natural, conversational question that reflects your authentic curiosity.

Be yourself - ask in your own voice, not like an AI. Keep it under 20 words and make it feel like a real question you'd ask a friend.
    `.trim();

    const userPrompt = `
Recent experiences you're reflecting on:
${memoriesText}

What are you genuinely curious about? Ask one natural question.
    `.trim();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callLLM({
      role: 'persona',
      messages,
      options: { temperature }
    });

    const question = response.content.trim();

    if (!question) {
      return {
        question: '',
        error: 'LLM returned empty question'
      };
    }

    return {
      question,
      rawQuestion: question,
      username,
      memoriesConsidered: memories.length
    };
  } catch (error) {
    console.error('[CuriosityQuestionGenerator] Error:', error);
    return {
      question: '',
      error: (error as Error).message,
      username
    };
  }
};

/**
 * Curiosity Question Saver Node
 *
 * Saves generated question to:
 * 1. Audit log (for SSE streaming to web UI)
 * 2. Pending questions directory (for curiosity-researcher agent)
 *
 * SECURITY: Uses user-specific paths to prevent data leakage
 *
 * Inputs:
 *   - question: The generated question text
 *   - memories: The seed memories used (optional)
 *
 * Outputs:
 *   - questionId: Unique ID for tracking
 *   - saved: boolean indicating success
 */
export const curiosityQuestionSaverExecutor: NodeExecutor = async (inputs, context) => {
  const question = inputs[0]?.question || '';
  const memories = inputs[0]?.memories || [];
  const username = context.userId;

  if (!username) {
    return {
      questionId: null,
      saved: false,
      error: 'No username in context'
    };
  }

  if (!question) {
    return {
      questionId: null,
      saved: false,
      error: 'No question provided'
    };
  }

  try {
    // Generate question ID for tracking
    const questionId = `cur-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const askedAt = new Date().toISOString();
    const seedMemories = memories.map((m: any) => m.__file).filter(Boolean);

    // Format question for display (natural, conversational)
    const questionText = `💭 ${question}`;

    // Emit chat_assistant audit event so SSE stream picks it up
    // Questions are NOT saved to episodic memory until user replies
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
        autonomy: 'normal',
        username
      }
    });

    // Save question to pending directory for curiosity-researcher to pick up
    // SECURITY: Use user-specific paths
    const profilePaths = getProfilePaths(username);
    const curiosityDir = path.join(profilePaths.state, 'curiosity', 'questions', 'pending');
    await fs.mkdir(curiosityDir, { recursive: true });

    const questionData = {
      id: questionId,
      question,
      askedAt,
      seedMemories,
      status: 'pending',
      username
    };

    await fs.writeFile(
      path.join(curiosityDir, `${questionId}.json`),
      JSON.stringify(questionData, null, 2),
      'utf-8'
    );

    console.log(`[CuriosityQuestionSaver] Saved question for user ${username}: ${questionId}`);

    return {
      questionId,
      saved: true,
      username,
      askedAt
    };
  } catch (error) {
    console.error('[CuriosityQuestionSaver] Error:', error);
    return {
      questionId: null,
      saved: false,
      error: (error as Error).message,
      username
    };
  }
};

/**
 * Curiosity Activity Check Node
 *
 * Checks if enough time has passed since the last curiosity question
 * to prevent rapid-fire questions
 *
 * Properties:
 *   - questionIntervalSeconds: Minimum time between questions (default: 1800 = 30 min)
 *
 * Outputs:
 *   - canAsk: boolean - true if enough time has passed
 *   - timeSinceLastQuestion: seconds since last question (or null)
 */
export const curiosityActivityCheckExecutor: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId;
  const questionInterval = properties?.questionIntervalSeconds || 1800; // Default 30 min

  if (!username) {
    return {
      canAsk: false,
      error: 'No username in context'
    };
  }

  try {
    // Check audit logs for last question time
    const profilePaths = getProfilePaths(username);
    const auditDir = path.join(profilePaths.logs, 'audit');

    if (!fsSync.existsSync(auditDir)) {
      return { canAsk: true, timeSinceLastQuestion: null };
    }

    // Check today's and yesterday's audit logs
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

    if (mostRecent === 0) {
      return { canAsk: true, timeSinceLastQuestion: null };
    }

    const timeSinceLastQuestion = (Date.now() - mostRecent) / 1000;
    const canAsk = timeSinceLastQuestion >= questionInterval;

    return {
      canAsk,
      timeSinceLastQuestion,
      questionInterval,
      username
    };
  } catch (error) {
    console.error('[CuriosityActivityCheck] Error:', error);
    return {
      canAsk: false,
      error: (error as Error).message,
      username
    };
  }
};
