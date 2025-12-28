/**
 * Inner Curiosity Agent — Core Logic
 *
 * Generates self-directed questions and attempts to answer them using local memory.
 * This simulates the AI's internal curiosity - asking and answering its own questions
 * as inner dialogue, never appearing in the main chat.
 *
 * Flow:
 * 1. Sample weighted memories
 * 2. Generate an interesting question about patterns/connections
 * 3. Search local memory for relevant information
 * 4. If innerQuestionMode='web' and answer insufficient, search web (TODO)
 * 5. Synthesize answer from findings
 * 6. Save as inner_dialogue event
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  callLLM,
  captureEvent,
  searchMemory,
  storageClient,
  audit,
  getTargetUser,
  withUserContext,
  loadCuriosityConfig,
  loadPersonaCore,
  appendReflectionToBuffer,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface InnerCuriosityOptions {
  singleUser?: boolean;
}

export interface InnerCuriosityResult {
  success: boolean;
  questionsGenerated: number;
  userCount: number;
  errors: string[];
}

// ============================================================================
// Memory Functions
// ============================================================================

/**
 * Get ALL memories with weighted selection
 */
export async function getAllMemories(): Promise<Array<{ file: string; timestamp: Date; content: any }>> {
  const result = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  if (!result.success || !result.path) {
    console.error('[inner-curiosity] Cannot resolve episodic path');
    return [];
  }
  const episodicDir = result.path;
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

          // Skip self-referential types
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
  allMemories.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allMemories;
}

/**
 * Sample memories using weighted selection
 */
export async function sampleWeightedMemories(count: number): Promise<any[]> {
  const allMemories = await getAllMemories();
  if (allMemories.length === 0) return [];

  const now = Date.now();
  const decayFactor = 14; // Days
  const selected: any[] = [];
  const usedIndices = new Set<number>();

  const technicalKeywords = [
    'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
    'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
    'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
  ];

  for (let i = 0; i < count && selected.length < Math.min(count, allMemories.length); i++) {
    const weights = allMemories.map((mem, idx) => {
      if (usedIndices.has(idx)) return 0;

      const ageInDays = (now - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      let weight = Math.exp(-ageInDays / decayFactor);

      const contentLower = mem.content.content?.toLowerCase() || '';
      const isTechnical = technicalKeywords.some(kw => contentLower.includes(kw));
      if (isTechnical) {
        weight *= 0.3;
      }

      return weight;
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) break;

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

// ============================================================================
// Question Generation
// ============================================================================

/**
 * Generate and answer an inner question for a single user
 */
export async function generateInnerQuestion(username: string): Promise<boolean> {
  console.log(`[inner-curiosity] Processing user: ${username}`);

  const config = loadCuriosityConfig(username);
  const persona = loadPersonaCore();

  // Check if inner questions are enabled
  if (!config.innerQuestionMode || config.innerQuestionMode === 'off') {
    console.log(`[inner-curiosity] Inner questions disabled`);
    return false;
  }

  // Sample weighted memories
  const memories = await sampleWeightedMemories(5);
  if (memories.length === 0) {
    console.log(`[inner-curiosity] No memories to base question on yet`);
    return false;
  }

  console.log(`[inner-curiosity] Selected ${memories.length} weighted memories`);

  // Step 1: Generate a self-directed question
  const memoriesText = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');

  const questionSystemPrompt = `
You are ${persona.identity.name}'s internal curiosity. Generate ONE self-directed question that explores deeper patterns, connections, or meanings in recent experiences.

This is an inner question - you're asking yourself, not the user. Focus on:
- Deeper "why" questions about your own patterns
- Connections between seemingly unrelated experiences
- Implications of recent observations
- Meta-questions about your own thinking

Keep under 100 words. Be genuinely curious and thoughtful.
  `.trim();

  const questionPrompt = `
Based on these recent experiences:
${memoriesText}

What question should I ask myself to deepen my understanding?
  `.trim();

  let question: string;
  try {
    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: questionSystemPrompt },
        { role: 'user', content: questionPrompt }
      ],
      options: { temperature: 0.8 }
    });

    question = response.content.trim();
    if (!question) {
      console.log(`[inner-curiosity] Generated empty question`);
      return false;
    }

    console.log(`[inner-curiosity] Generated question: "${question.substring(0, 80)}..."`);
  } catch (error) {
    console.error(`[inner-curiosity] Error generating question:`, error);
    return false;
  }

  // Step 2: Search memory for relevant context
  let searchResults: any[] = [];
  try {
    // Extract key terms from question for search
    const keyTerms = question
      .toLowerCase()
      .replace(/[?.,!]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 4)
      .slice(0, 3);

    for (const term of keyTerms) {
      try {
        const results = await searchMemory(term, { limit: 3 });
        searchResults.push(...results);
      } catch {}
    }

    // Remove duplicates
    searchResults = [...new Map(searchResults.map(r => [r.id || r.timestamp, r])).values()];
    console.log(`[inner-curiosity] Found ${searchResults.length} relevant memories`);
  } catch (error) {
    console.warn(`[inner-curiosity] Memory search failed:`, error);
  }

  // Step 3: Synthesize answer from local findings
  const answerSystemPrompt = `
You are ${persona.identity.name} contemplating a self-directed question.

Based on your memories and experiences, provide a thoughtful answer. This is internal reflection - be authentic, exploratory, and open to uncertainty.

If the available information is insufficient, acknowledge that and explain what you'd need to explore further.
  `.trim();

  const searchContext = searchResults.length > 0
    ? `\n\nRelevant memories:\n${searchResults.map((r, i) => `${i + 1}. ${r.content?.substring(0, 200) || ''}`).join('\n')}`
    : '';

  const answerPrompt = `
Question I'm pondering: ${question}

My recent experiences:
${memoriesText}
${searchContext}

What insights can I draw from this? What patterns emerge?
  `.trim();

  let answer: string;
  try {
    const response = await callLLM({
      role: 'persona',
      messages: [
        { role: 'system', content: answerSystemPrompt },
        { role: 'user', content: answerPrompt }
      ],
      options: { temperature: 0.7 }
    });

    answer = response.content.trim();
    console.log(`[inner-curiosity] Generated answer (${answer.split(/\s+/).length} words)`);
  } catch (error) {
    console.error(`[inner-curiosity] Error generating answer:`, error);
    return false;
  }

  // Step 4: Save as inner dialogue
  const innerDialogue = `🤔 ${question}\n\n💭 ${answer}`;

  try {
    // Save to episodic memory
    captureEvent(innerDialogue, {
      type: 'inner_dialogue',
      tags: ['inner-curiosity', 'self-directed-question', 'inner'],
      metadata: {
        innerCuriosity: {
          question,
          answer,
          mode: config.innerQuestionMode,
          memoriesConsidered: memories.length,
          searchResults: searchResults.length
        }
      }
    });

    // Also append to conversation buffer so it appears in Inner Dialogue tab
    appendReflectionToBuffer(username, innerDialogue, {
      dialogueSource: 'inner-curiosity',
      displayColor: '#8b5cf6', // Purple for inner curiosity
      type: 'inner_question',
    });

    audit({
      category: 'action',
      level: 'info',
      event: 'inner_question_generated',
      actor: 'inner-curiosity',
      details: {
        questionPreview: question.substring(0, 100),
        answerLength: answer.length,
        memoriesConsidered: memories.length,
        username
      }
    });

    console.log(`[inner-curiosity] Saved inner Q&A to inner dialogue and buffer`);
    return true;

  } catch (error) {
    console.error(`[inner-curiosity] Error saving inner dialogue:`, error);
    return false;
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full inner-curiosity cycle (multi-user)
 */
export async function runCycle(options: InnerCuriosityOptions = {}): Promise<InnerCuriosityResult> {
  console.log('[inner-curiosity] Starting cycle...');

  const result: InnerCuriosityResult = {
    success: false,
    questionsGenerated: 0,
    userCount: 0,
    errors: [],
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    const activeUser = getTargetUser();

    if (!activeUser) {
      console.log('[inner-curiosity] No active users found, exiting.');
      result.success = true;
      return result;
    }

    console.log(`[inner-curiosity] Processing user: ${activeUser.username}`);
    result.userCount = 1;

    try {
      const success = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => generateInnerQuestion(activeUser.username)
      );

      if (success) result.questionsGenerated++;
    } catch (error) {
      const errorMsg = `User ${activeUser.username}: ${(error as Error).message}`;
      console.error(`[inner-curiosity] Failed: ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    console.log(`[inner-curiosity] Cycle complete. Generated ${result.questionsGenerated} inner questions for user ${activeUser.username}.`);

    audit({
      category: 'action',
      level: 'info',
      event: 'inner_curiosity_cycle_complete',
      actor: 'inner-curiosity',
      details: {
        questionsGenerated: result.questionsGenerated,
        username: activeUser.username
      }
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[inner-curiosity] Error during cycle:', errorMsg);
    result.errors.push(errorMsg);
    return result;
  }
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: InnerCuriosityOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const success = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => generateInnerQuestion(ctx.username)
      );

      return {
        success: true,
        data: { questionsGenerated: success ? 1 : 0, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: success ? 1 : 0,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.questionsGenerated,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
