import { audit } from '../audit.js';
import {
  submitInnerReflection,
  submitSystemEvent,
} from '../buffer-admission.js';
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
} from '../graph-runtime.js';
import {
  validateDesireCheckinEvaluation,
  type DesireCheckinEvaluation,
} from '../nodes/agency/desire-checkin-evaluator.node.js';
import { getUserContext } from '../context.js';
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

export {
  parseDesireCheckinEvaluation,
  type DesireCheckinEvaluation,
} from '../nodes/agency/desire-checkin-evaluator.node.js';

export interface DesireCheckinResult {
  processed: number;
  questionsGenerated: number;
  milestonesAdvanced: number;
  errors: string[];
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

async function evaluateDesireViaGraph(
  desire: Desire,
  username: string,
  graph: NonNullable<Awaited<ReturnType<typeof loadGraphFile>>>['graph'],
  cognitiveMode?: string,
  signal?: AbortSignal,
): Promise<DesireCheckinEvaluation> {
  const activeUser = getUserContext();
  if (!activeUser || (activeUser.username !== username && activeUser.activeProfile !== username)) {
    throw new Error(`Desire check-in requires an authenticated context for ${username}`);
  }
  const state = await runGraph({
    graph,
    signal,
    context: {
      userId: activeUser.userId,
      username,
      desire,
      desireId: desire.id,
      allowMemoryWrites: false,
      recordPersonaMemory: false,
      abortSignal: signal,
      cognitiveMode,
    },
  });
  if (state.status !== 'completed') {
    throw new Error(`Desire check-in graph ended with status ${state.status}`);
  }
  return validateDesireCheckinEvaluation(
    requireGraphNodeOutput(state, 'desire_checkin_evaluator').evaluation,
  );
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
  const loaded = await loadGraphFile(cognitiveGraphPath('desire-checkin.json'), {
    cacheKey: 'agency:desire-checkin',
    logPrefix: '[AGENCY:checkin]',
  });
  if (!loaded) throw new Error('Desire check-in graph is unavailable');

  await submitInnerReflection(
    options.username,
    `Checking in on ${desires.length} long-running goal${desires.length === 1 ? '' : 's'}.`,
    { dialogueSource: 'agency-system', displayColor: '#8b5cf6', type: 'desire_checkin_start' },
  );

  for (const desire of desires) {
    if (options.signal?.aborted) throw new DOMException('Desire check-in cancelled', 'AbortError');
    try {
      const evaluation = await evaluateDesireViaGraph(
        desire,
        options.username,
        loaded.graph,
        options.cognitiveMode,
        options.signal,
      );
      const recorded = await recordDesireCheckin(desire.id, options.username, evaluation.statusAssessment);
      if (!recorded) throw new Error('Desire disappeared before the check-in could be recorded');

      if (evaluation.questionsForUser.length > 0) {
        result.questionsGenerated += evaluation.questionsForUser.length;
        const questions = evaluation.questionsForUser.map((question, index) => `${index + 1}. ${question}`).join('\n');
        await submitSystemEvent(
          options.username,
          `**Check-in on "${desire.title}"**\n\n${evaluation.statusAssessment}\n\n**Questions**\n${questions}`,
          {
            dialogueSource: 'agency-system',
            source: 'agency',
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
          await submitSystemEvent(
            options.username,
            `**Milestone complete: "${desire.title}"**\n\nCompleted: ${advanced.completedMilestone.title}${advanced.nextMilestone ? `\nNext: ${advanced.nextMilestone.title}` : ''}`,
            {
              dialogueSource: 'agency-system',
              source: 'agency',
              displayColor: '#22c55e',
              type: 'milestone_advanced',
              desireId: desire.id,
              desireTitle: desire.title,
            },
          );
        }
      } else if (evaluation.recommendation === 'escalate') {
        await submitSystemEvent(
          options.username,
          `**Attention needed: "${desire.title}"**\n\n${evaluation.statusAssessment}${evaluation.recommendationReason ? `\n\nReason: ${evaluation.recommendationReason}` : ''}`,
          {
            dialogueSource: 'agency-system',
            source: 'agency',
            displayColor: '#ef4444',
            type: 'desire_checkin_escalate',
            desireId: desire.id,
            desireTitle: desire.title,
          },
        );
      } else if (evaluation.questionsForUser.length === 0) {
        await submitInnerReflection(
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

  await submitInnerReflection(
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
