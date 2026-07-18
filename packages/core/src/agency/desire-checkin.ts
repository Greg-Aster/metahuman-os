import { audit } from '../audit.js';
import {
  appendAgencyMessageToConversation,
  appendReflectionToBuffer,
} from '../conversation-buffer.js';
import { searchMemory } from '../memory.js';
import { callLLMText } from '../model-router.js';
import {
  advanceDesireMilestone,
  listDesiresFromFolders,
  listLongRunningDesiresNeedingCheckin,
  loadDesire,
  recordDesireCheckin,
} from './storage.js';
import type { Desire } from './types.js';

export interface DesireCheckinInput {
  desireId?: string;
  checkProgress?: boolean;
  force?: boolean;
}

export interface DesireCheckinEvaluation {
  statusAssessment: string;
  questionsForUser: string[];
  currentMilestoneComplete: boolean;
  suggestedNextActions: string[];
  recommendation: 'continue' | 'advance_milestone' | 'adjust_plan' | 'escalate';
  recommendationReason?: string;
}

export interface DesireCheckinResult {
  processed: number;
  questionsGenerated: number;
  milestonesAdvanced: number;
  errors: string[];
}

const RECOMMENDATIONS = new Set<DesireCheckinEvaluation['recommendation']>([
  'continue',
  'advance_milestone',
  'adjust_plan',
  'escalate',
]);

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function parseDesireCheckinEvaluation(text: string): DesireCheckinEvaluation {
  const fallback: DesireCheckinEvaluation = {
    statusAssessment: text.trim().slice(0, 2_000) || 'The check-in returned no assessment.',
    questionsForUser: [],
    currentMilestoneComplete: false,
    suggestedNextActions: [],
    recommendation: 'continue',
  };
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return fallback;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const recommendation = typeof parsed.recommendation === 'string'
      && RECOMMENDATIONS.has(parsed.recommendation as DesireCheckinEvaluation['recommendation'])
      ? parsed.recommendation as DesireCheckinEvaluation['recommendation']
      : 'continue';
    return {
      statusAssessment: typeof parsed.statusAssessment === 'string' && parsed.statusAssessment.trim()
        ? parsed.statusAssessment.trim().slice(0, 2_000)
        : fallback.statusAssessment,
      questionsForUser: stringList(parsed.questionsForUser, 5),
      currentMilestoneComplete: parsed.currentMilestoneComplete === true,
      suggestedNextActions: stringList(parsed.suggestedNextActions, 5),
      recommendation,
      recommendationReason: typeof parsed.recommendationReason === 'string'
        ? parsed.recommendationReason.trim().slice(0, 1_000)
        : undefined,
    };
  } catch {
    return fallback;
  }
}

async function selectDesires(input: DesireCheckinInput, username: string): Promise<Desire[]> {
  if (input.desireId) {
    const desire = await loadDesire(input.desireId, username);
    if (!desire) throw new Error(`Desire not found: ${input.desireId}`);
    if (desire.goalType !== 'long_running') {
      throw new Error(`Desire is not a long-running goal: ${input.desireId}`);
    }
    return [desire];
  }

  const due = await listLongRunningDesiresNeedingCheckin(username, 24);
  if (due.length > 0 || !input.force) return due;
  const all = await listDesiresFromFolders(username);
  return all.filter(desire =>
    desire.goalType === 'long_running'
    && (desire.status === 'executing' || desire.status === 'approved'));
}

async function evaluateDesire(
  desire: Desire,
  username: string,
  cognitiveMode?: string,
): Promise<DesireCheckinEvaluation> {
  const currentMilestoneIndex = desire.goalProgress?.currentMilestone || 0;
  const currentMilestone = desire.milestones?.[currentMilestoneIndex];
  const memoryReferences = searchMemory(desire.title).slice(0, 10);
  const response = await callLLMText({
    role: 'orchestrator',
    userId: username,
    cognitiveMode,
    messages: [
      {
        role: 'system',
        content: `Evaluate progress on one long-running user goal. Return exactly one JSON object with this shape:
{"statusAssessment":"brief assessment","questionsForUser":["optional question"],"currentMilestoneComplete":false,"suggestedNextActions":["optional action"],"recommendation":"continue|advance_milestone|adjust_plan|escalate","recommendationReason":"brief reason"}
Use only the supplied goal state and memory references. Do not claim work was completed without evidence. Ask concise questions when evidence is missing.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          goal: {
            id: desire.id,
            title: desire.title,
            description: desire.description,
            reason: desire.reason,
            status: desire.status,
          },
          progress: desire.goalProgress || null,
          currentMilestone: currentMilestone || null,
          milestones: desire.milestones || [],
          memoryReferences,
        }),
      },
    ],
    options: { temperature: 0.3, maxTokens: 800 },
  });
  return parseDesireCheckinEvaluation(response);
}

export async function runDesireCheckin(
  input: DesireCheckinInput,
  options: { username: string; cognitiveMode?: string; signal?: AbortSignal },
): Promise<DesireCheckinResult> {
  const desires = (await selectDesires(input, options.username)).slice(0, 2);
  const result: DesireCheckinResult = {
    processed: 0,
    questionsGenerated: 0,
    milestonesAdvanced: 0,
    errors: [],
  };
  if (desires.length === 0) return result;

  await appendReflectionToBuffer(
    options.username,
    `Checking in on ${desires.length} long-running goal${desires.length === 1 ? '' : 's'}.`,
    { dialogueSource: 'agency-system', displayColor: '#8b5cf6', type: 'desire_checkin_start' },
  );

  for (const desire of desires) {
    if (options.signal?.aborted) throw new DOMException('Desire check-in cancelled', 'AbortError');
    try {
      const evaluation = await evaluateDesire(desire, options.username, options.cognitiveMode);
      const recorded = await recordDesireCheckin(desire.id, options.username, evaluation.statusAssessment);
      if (!recorded) throw new Error('Desire disappeared before the check-in could be recorded');

      if (evaluation.questionsForUser.length > 0) {
        result.questionsGenerated += evaluation.questionsForUser.length;
        const questions = evaluation.questionsForUser.map((question, index) => `${index + 1}. ${question}`).join('\n');
        await appendAgencyMessageToConversation(
          options.username,
          `**Check-in on "${desire.title}"**\n\n${evaluation.statusAssessment}\n\n**Questions**\n${questions}`,
          {
            dialogueSource: 'agency-system',
            displayColor: '#8b5cf6',
            type: 'desire_checkin_questions',
            desireId: desire.id,
            desireTitle: desire.title,
          },
        );
      }

      if (
        input.checkProgress !== false
        && evaluation.currentMilestoneComplete
        && evaluation.recommendation === 'advance_milestone'
      ) {
        const advanced = await advanceDesireMilestone(desire.id, options.username);
        if (advanced) {
          result.milestonesAdvanced += 1;
          await appendAgencyMessageToConversation(
            options.username,
            `**Milestone complete: "${desire.title}"**\n\nCompleted: ${advanced.completedMilestone.title}${advanced.nextMilestone ? `\nNext: ${advanced.nextMilestone.title}` : ''}`,
            {
              dialogueSource: 'agency-system',
              displayColor: '#22c55e',
              type: 'milestone_advanced',
              desireId: desire.id,
              desireTitle: desire.title,
            },
          );
        }
      } else if (evaluation.recommendation === 'escalate') {
        await appendAgencyMessageToConversation(
          options.username,
          `**Attention needed: "${desire.title}"**\n\n${evaluation.statusAssessment}${evaluation.recommendationReason ? `\n\nReason: ${evaluation.recommendationReason}` : ''}`,
          {
            dialogueSource: 'agency-system',
            displayColor: '#ef4444',
            type: 'desire_checkin_escalate',
            desireId: desire.id,
            desireTitle: desire.title,
          },
        );
      } else if (evaluation.questionsForUser.length === 0) {
        await appendReflectionToBuffer(
          options.username,
          `**Check-in: "${desire.title}"**\n\n${evaluation.statusAssessment}\nProgress: ${desire.goalProgress?.progressPercent || 0}%\nRecommendation: ${evaluation.recommendation}`,
          { dialogueSource: 'agency-system', displayColor: '#6b7280', type: 'desire_checkin_status' },
        );
      }
      result.processed += 1;
    } catch (error) {
      result.errors.push(`${desire.id}: ${(error as Error).message}`);
    }
  }

  if (result.processed === 0 && result.errors.length > 0) {
    throw new Error(`Desire check-in failed: ${result.errors.join('; ')}`);
  }

  await appendReflectionToBuffer(
    options.username,
    `Check-in complete: ${result.processed} evaluated, ${result.questionsGenerated} questions, ${result.milestonesAdvanced} milestones advanced.`,
    { dialogueSource: 'agency-system', displayColor: '#22c55e', type: 'desire_checkin_complete' },
  );
  audit({
    category: 'agent',
    level: result.errors.length > 0 ? 'warn' : 'info',
    event: 'desire_checkin_completed',
    actor: 'agency.desire-checkin',
    details: { username: options.username, ...result },
  });
  return result;
}
