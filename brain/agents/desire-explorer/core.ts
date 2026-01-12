/**
 * Desire Explorer Agent — Core Logic
 *
 * Explores desires before planning to gather context and generate smart questions.
 * Runs when a desire crosses the activation threshold (pending → exploring).
 *
 * Phases:
 * 1. Research - Search web/memory for information about the desire
 * 2. Feasibility - Determine if desire is achievable and what it takes
 * 3. Questions - Generate specific questions based on research
 * 4. Save - Store findings in desire scratchpad
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getTargetUser,
  withUserContext,
  captureEvent,
  callLLMText,
  callLLMPrompt,
  type Desire,
  type ClarifyingQuestion,
  listDesiresByStatus,
  moveDesire,
  saveDesireManifest,
  addScratchpadEntryToFolder,
  isAgencyEnabled,
  appendAgencyMessageToConversation,
  getProfilePaths,
} from '@metahuman/core';
import { randomUUID } from 'crypto';

const LOCK_NAME = 'desire-explorer';
const LOG_PREFIX = '[AGENCY:explorer]';

// ============================================================================
// Types
// ============================================================================

interface ExplorationResult {
  research: {
    summary: string;
    keyFindings: string[];
    feasibility: 'likely' | 'possible' | 'uncertain' | 'difficult';
    feasibilityReason: string;
    estimatedEffort: string;
    prerequisites: string[];
    potentialChallenges: string[];
  };
  questions: ClarifyingQuestion[];
}

interface ExplorerStats {
  explored: number;
  questionsSent: number;
  errors: number;
}

// ============================================================================
// Research Functions
// ============================================================================

/**
 * Research a desire using LLM reasoning and context.
 */
async function researchDesire(desire: Desire, username: string): Promise<ExplorationResult['research']> {
  const prompt = `You are researching a goal/desire to help create a well-informed plan.

## Goal Information
**Title:** ${desire.title}
**Description:** ${desire.description || 'Not provided'}
**Reason:** ${desire.reason || 'Not specified'}
**Source:** ${desire.source}

## Your Task
Analyze this goal and provide a research summary. Consider:
1. What does achieving this goal actually involve?
2. Is it feasible? What would it take?
3. What are potential challenges or blockers?
4. What prerequisites or resources might be needed?
5. What information would help create a good plan?

## Response Format
Return ONLY valid JSON matching this structure:
{
  "summary": "Brief overview of what this goal involves (2-3 sentences)",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "feasibility": "likely|possible|uncertain|difficult",
  "feasibilityReason": "Why this feasibility rating",
  "estimatedEffort": "low|medium|high|very_high",
  "prerequisites": ["prereq 1", "prereq 2"],
  "potentialChallenges": ["challenge 1", "challenge 2"]
}`;

  try {
    const response = await callLLMPrompt('orchestrator', prompt, {
      temperature: 0.4,
      maxTokens: 1000,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in research response');
    }

    const research = JSON.parse(jsonMatch[0]);

    // Validate required fields
    return {
      summary: research.summary || 'Research completed.',
      keyFindings: research.keyFindings || [],
      feasibility: research.feasibility || 'uncertain',
      feasibilityReason: research.feasibilityReason || 'Unable to determine',
      estimatedEffort: research.estimatedEffort || 'unknown',
      prerequisites: research.prerequisites || [],
      potentialChallenges: research.potentialChallenges || [],
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Research failed:`, error);
    return {
      summary: `Goal: ${desire.title}`,
      keyFindings: [],
      feasibility: 'uncertain',
      feasibilityReason: 'Research encountered an error',
      estimatedEffort: 'unknown',
      prerequisites: [],
      potentialChallenges: [],
    };
  }
}

/**
 * Generate smart clarifying questions based on research.
 */
async function generateSmartQuestions(
  desire: Desire,
  research: ExplorationResult['research']
): Promise<ClarifyingQuestion[]> {
  const prompt = `You are generating clarifying questions before creating a plan for a goal.

## Goal Information
**Title:** ${desire.title}
**Description:** ${desire.description || 'Not provided'}
**Reason:** ${desire.reason || 'Not specified'}

## Research Findings
**Summary:** ${research.summary}
**Feasibility:** ${research.feasibility} - ${research.feasibilityReason}
**Estimated Effort:** ${research.estimatedEffort}
**Key Findings:**
${research.keyFindings.map(f => `- ${f}`).join('\n')}
**Prerequisites:**
${research.prerequisites.map(p => `- ${p}`).join('\n') || '- None identified'}
**Potential Challenges:**
${research.potentialChallenges.map(c => `- ${c}`).join('\n') || '- None identified'}

## Task
Generate 2-4 SPECIFIC clarifying questions based on the research above.

Focus on questions that:
- Address gaps in understanding specific to THIS goal
- Clarify prerequisites the user may or may not have
- Understand timeline, budget, or resource constraints
- Identify user's experience level with relevant aspects
- Clarify success criteria

DO NOT ask generic questions like "Can you provide more details?"
Instead, ask specific questions informed by the research.

## Response Format
Return ONLY a JSON array:
[
  {"text": "Specific question based on research?", "type": "free_text", "required": true},
  {"text": "Another specific question?", "type": "yes_no", "required": false}
]

Types: "free_text", "yes_no", or "choice" (with "options" array)`;

  try {
    const response = await callLLMPrompt('curator', prompt, {
      temperature: 0.5,
      maxTokens: 600,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in questions response');
    }

    const rawQuestions = JSON.parse(jsonMatch[0]) as Array<{
      text: string;
      type?: string;
      required?: boolean;
      options?: string[];
    }>;

    // Convert to ClarifyingQuestion with IDs
    const questions: ClarifyingQuestion[] = rawQuestions.map((q) => ({
      id: `q-${randomUUID().slice(0, 8)}`,
      text: q.text,
      type: (q.type as ClarifyingQuestion['type']) || 'free_text',
      options: q.options,
      required: q.required ?? true,
    }));

    return questions.slice(0, 4); // Max 4 questions
  } catch (error) {
    console.error(`${LOG_PREFIX} Question generation failed:`, error);
    // Fallback to research-informed generic questions
    return [
      {
        id: `q-${randomUUID().slice(0, 8)}`,
        text: research.prerequisites.length > 0
          ? `Do you already have: ${research.prerequisites.slice(0, 2).join(', ')}?`
          : `What's your timeline for achieving "${desire.title}"?`,
        type: 'free_text',
        required: true,
      },
    ];
  }
}

// ============================================================================
// Main Exploration Function
// ============================================================================

/**
 * Explore a single desire: research → questions → save
 */
async function exploreDesire(desire: Desire, username: string): Promise<ExplorationResult> {
  console.log(`${LOG_PREFIX}   Researching: ${desire.title}`);

  // Phase 1: Research
  const research = await researchDesire(desire, username);
  console.log(`${LOG_PREFIX}     Feasibility: ${research.feasibility}`);
  console.log(`${LOG_PREFIX}     Findings: ${research.keyFindings.length}`);

  // Phase 2: Generate smart questions
  console.log(`${LOG_PREFIX}   Generating questions...`);
  const questions = await generateSmartQuestions(desire, research);
  console.log(`${LOG_PREFIX}     Generated ${questions.length} questions`);

  return { research, questions };
}

/**
 * Process desires for a single user.
 */
async function processUserDesires(username: string): Promise<ExplorerStats> {
  const stats: ExplorerStats = { explored: 0, questionsSent: 0, errors: 0 };

  // Find desires that need exploration:
  // 1. Pending desires above exploration threshold (0.5) that haven't been explored yet
  // 2. Evaluating desires that haven't been explored yet
  const pendingDesires = await listDesiresByStatus('pending', username);
  const evaluatingDesires = await listDesiresByStatus('evaluating', username);

  const EXPLORATION_THRESHOLD = 0.5; // Lower than activation (0.7) - explore early

  const desiresNeedingExploration = [
    ...pendingDesires.filter(d => (d.strength || 0) >= EXPLORATION_THRESHOLD),
    ...evaluatingDesires,
  ].filter(d => {
    // Skip if already explored (has research in metadata)
    if (d.metadata?.explorationResearch) {
      console.log(`${LOG_PREFIX}   Skipping ${d.id} - already explored`);
      return false;
    }
    // Skip if already has clarifying questions
    if (d.clarifyingQuestions?.questions?.length > 0) {
      console.log(`${LOG_PREFIX}   Skipping ${d.id} - already has questions`);
      return false;
    }
    return true;
  });

  if (desiresNeedingExploration.length === 0) {
    console.log(`${LOG_PREFIX}   No desires need exploration`);
    return stats;
  }

  console.log(`${LOG_PREFIX}   Found ${desiresNeedingExploration.length} desires to explore`);

  for (const desire of desiresNeedingExploration) {
    try {
      // Explore the desire
      const result = await exploreDesire(desire, username);
      stats.explored++;

      // Save research to scratchpad
      await addScratchpadEntryToFolder(desire.id, {
        type: 'exploration',
        timestamp: new Date().toISOString(),
        description: 'Exploration research completed',
        actor: 'system',
        data: {
          research: result.research,
        },
      }, username);

      // Update desire with questions and move to questioning status
      const now = new Date().toISOString();
      const updatedDesire: Desire = {
        ...desire,
        clarifyingQuestions: {
          phase: 'before_planning',
          questions: result.questions,
          answers: [],
          askedAt: now,
        },
        status: 'questioning',
        currentStage: 'questioning',
        updatedAt: now,
        // Store research summary for planning phase
        metadata: {
          ...desire.metadata,
          explorationResearch: result.research,
        },
      };

      await saveDesireManifest(updatedDesire, username);
      stats.questionsSent += result.questions.length;

      // Send first question to chat as a card
      if (result.questions.length > 0) {
        const questionsList = result.questions
          .map((q, i) => `${i + 1}. ${q.text}`)
          .join('\n');

        await appendAgencyMessageToConversation(
          username,
          `💭 Help me plan this better\n${questionsList}`,
          {
            type: 'clarifying_questions',
            desireId: desire.id,
            desireTitle: desire.title,
            questions: result.questions,
            feasibility: result.research.feasibility,
            researchSummary: result.research.summary,
          }
        );
      }

      // Audit
      audit({
        level: 'info',
        category: 'agent',
        event: 'desire_explored',
        actor: 'desire-explorer',
        details: {
          desireId: desire.id,
          desireTitle: desire.title,
          feasibility: result.research.feasibility,
          questionsGenerated: result.questions.length,
        },
      });

      console.log(`${LOG_PREFIX}   ✓ Explored: ${desire.title}`);
    } catch (error) {
      console.error(`${LOG_PREFIX}   ✗ Error exploring ${desire.id}:`, error);
      stats.errors++;
    }
  }

  return stats;
}

// ============================================================================
// Agent Entry Points
// ============================================================================

export async function runDesireExplorer(
  options: { singleUser?: boolean; username?: string } = {}
): Promise<{ success: boolean; stats: ExplorerStats; errors: string[] }> {
  initGlobalLogger();

  // Check for existing lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Already running, skipping`);
    return {
      success: true,
      stats: { explored: 0, questionsSent: 0, errors: 0 },
      errors: [],
    };
  }

  // Acquire lock
  let lock: { release: () => void } | null = null;
  try {
    lock = acquireLock(LOCK_NAME);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to acquire lock:`, error);
    return {
      success: false,
      stats: { explored: 0, questionsSent: 0, errors: 1 },
      errors: [(error as Error).message],
    };
  }

  try {
    const errors: string[] = [];
    const totalStats: ExplorerStats = { explored: 0, questionsSent: 0, errors: 0 };

    // Get target user
    const targetUser = getTargetUser(options);
    if (!targetUser) {
      console.log(`${LOG_PREFIX} No active user found`);
      return { success: true, stats: totalStats, errors };
    }

    const username = targetUser.username;
    console.log(`${LOG_PREFIX} Processing user: ${username}`);

    try {
      // Check if agency is enabled for this user
      const enabled = await isAgencyEnabled(username);
      if (!enabled) {
        console.log(`${LOG_PREFIX} Agency disabled for ${username}`);
        return { success: true, stats: totalStats, errors };
      }

      const userStats = await withUserContext(
        { id: username, username, role: targetUser.role || 'owner' },
        async () => processUserDesires(username)
      );

      totalStats.explored += userStats.explored;
      totalStats.questionsSent += userStats.questionsSent;
      totalStats.errors += userStats.errors;
    } catch (error) {
      const msg = `Error processing ${username}: ${(error as Error).message}`;
      console.error(`${LOG_PREFIX} ${msg}`);
      errors.push(msg);
    }

    console.log(`${LOG_PREFIX} Complete: ${totalStats.explored} explored, ${totalStats.questionsSent} questions sent`);

    return { success: true, stats: totalStats, errors };
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    return {
      success: false,
      stats: { explored: 0, questionsSent: 0, errors: 1 },
      errors: [(error as Error).message],
    };
  } finally {
    // Release lock
    if (lock) {
      lock.release();
    }
  }
}

// Agent runtime interface
export async function run(input: AgentInput, context: AgentContext): Promise<AgentResult> {
  const result = await runDesireExplorer({
    singleUser: input?.singleUser,
    username: input?.username,
  });

  return {
    success: result.success,
    output: result.stats,
    errors: result.errors,
  };
}

export default { run };
