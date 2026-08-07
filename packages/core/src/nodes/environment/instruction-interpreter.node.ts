import { defineNode } from '../types.js';
import type {
  EnvironmentCapabilities,
  EnvironmentFeedback,
  EnvironmentObservation,
  EnvironmentTextEvent,
} from '../../environment-interface/index.js';
import { hasFreshCorrelatedVisual } from '../../environment-interface/index.js';
import { readRobotObserverCycle } from '../../robot-operator.js';
import { environmentTaskContractFromObservation } from './helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textStartsWithYou(text: string): boolean {
  return /^\s*you\b[\s:,-]*/i.test(text);
}

function filterTextEvents(events: EnvironmentTextEvent[]): EnvironmentTextEvent[] {
  return events
    .filter(event => event.senderName?.toLowerCase() !== 'you')
    .filter(event => !textStartsWithYou(event.text))
    .map(event => ({
      ...event,
      text: event.text.replace(/^\s*(?!you\b)([^\s:]{1,80})\s*:\s*/i, '').trim(),
    }))
    .filter(event => event.text.length > 0);
}

function textEventFromMessage(message: string): EnvironmentTextEvent | null {
  const text = message.trim();
  if (!text) {
    return null;
  }

  return {
    id: `environment-chat-${Date.now()}`,
    source: 'player',
    text,
    timestamp: new Date().toISOString(),
    senderName: 'user',
  };
}

function terminalFeedbackEvent(
  feedback: EnvironmentFeedback[] | undefined,
): EnvironmentTextEvent | null {
  let terminal: EnvironmentFeedback | undefined;
  for (let index = (feedback?.length ?? 0) - 1; index >= 0; index -= 1) {
    const candidate = feedback?.[index];
    if (
      candidate
      && (
        candidate.type === 'completed'
        || candidate.type === 'rejected'
        || candidate.type === 'cancelled'
        || candidate.type === 'expired'
        || candidate.type === 'failed'
      )
    ) {
      terminal = candidate;
      break;
    }
  }
  if (!terminal) return null;
  return {
    id: `environment-feedback-${terminal.id}`,
    source: 'system',
    text: `Robot action ${terminal.type}: ${terminal.message}. This exact terminal result is evidence for the original objective.`,
    timestamp: terminal.timestamp,
    metadata: { actionId: terminal.actionId, feedbackId: terminal.id },
  };
}

function completedCaptureFeedback(feedback: EnvironmentFeedback[] | undefined): boolean {
  for (let index = (feedback?.length ?? 0) - 1; index >= 0; index -= 1) {
    const candidate = feedback?.[index];
    if (!candidate) continue;
    if (candidate.type === 'accepted' || candidate.type === 'status') continue;
    return candidate.type === 'completed' && candidate.data?.command === 'captureImage';
  }
  return false;
}

export const environmentInstructionInterpreterNode = defineNode({
  id: 'environment_instruction_interpreter',
  name: 'Environment Instruction Interpreter',
  category: 'environment',
  inputs: [
    { name: 'observation', type: 'object', optional: true, description: 'Raw environment observation, when an adapter is connected' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Environment observation for Environment Mode' },
    { name: 'instruction', type: 'string', description: 'Current environment instruction text' },
    { name: 'text', type: 'array', description: 'Environment text events used as instruction input' },
    { name: 'state', type: 'object', description: 'Environment state payload' },
    { name: 'location', type: 'object', description: 'Environment location payload' },
    { name: 'sessionId', type: 'string', description: 'Target environment bridge session' },
    { name: 'valid', type: 'boolean', description: 'Whether usable environment input exists' },
  ],
  description: 'Normalizes adapter observations and typed environment chat into one instruction surface.',
  async execute(inputs, context) {
    const rawObservation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const contextMessage = typeof context.userMessage === 'string' ? context.userMessage : '';
    const validatorCommand = isRecord(rawObservation?.metadata?.taskValidatorCommand)
      ? rawObservation.metadata.taskValidatorCommand
      : null;
    const queuedObjective = typeof validatorCommand?.objective === 'string'
      ? validatorCommand.objective.trim()
      : '';
    const queuedInstruction = typeof validatorCommand?.instruction === 'string'
      ? validatorCommand.instruction.trim()
      : '';
    const observationText = filterTextEvents(rawObservation?.text ?? []);
    const currentTaskEvent = textEventFromMessage(contextMessage || queuedInstruction || queuedObjective);
    const originatingInstruction = typeof rawObservation?.metadata?.originatingInstruction === 'string'
      ? rawObservation.metadata.originatingInstruction.trim()
      : '';
    const taskContract = environmentTaskContractFromObservation(rawObservation);
    const originalObjective = taskContract?.objective || originatingInstruction;
    const taskContractInstruction = taskContract
      ? [
          `Task continuation policy: ${taskContract.continuationPolicy}.`,
          `Required whole-objective completion basis: ${taskContract.requiredCompletionBasis}.`,
          `Do not claim the objective complete from any other evidence basis.`,
        ].join(' ')
      : '';
    const robotObserver = readRobotObserverCycle(rawObservation);
    const captureSatisfied = Boolean(
      !currentTaskEvent
      && robotObserver
      && completedCaptureFeedback(rawObservation?.feedback)
      && hasFreshCorrelatedVisual(rawObservation, robotObserver.cycleId),
    );
    // A typed or coordinator-supplied current task is the only authoritative
    // instruction for this execution. Adapter text is used when no current task
    // exists, preventing an older transcript from replacing a UI command.
    const feedbackEvent = terminalFeedbackEvent(
      rawObservation?.feedback,
    );
    const text = currentTaskEvent ? [currentTaskEvent] : feedbackEvent ? [feedbackEvent] : observationText;
    const satisfiedCaptureInstruction = captureSatisfied
      ? [
          'A fresh correlated robot image has returned, so the visual acquisition for this interaction is complete.',
          'Use the attached image to answer the original user goal now. Do not request another image in this continuation.',
          originalObjective ? `Original user goal: ${originalObjective}` : '',
          taskContractInstruction,
        ].filter(Boolean).join('\n')
      : '';
    const feedbackInstruction = feedbackEvent
      ? [
          feedbackEvent.text,
          originalObjective
            ? `Original user objective (still authoritative): ${originalObjective}`
            : '',
          taskContractInstruction,
        ].filter(Boolean).join('\n')
      : '';
    const instruction = currentTaskEvent?.text
      || satisfiedCaptureInstruction
      || feedbackInstruction
      || originalObjective
      || text.map(event => event.text).join('\n').trim();
    const sessionId = rawObservation?.sessionId ?? '';
    const timestamp = rawObservation?.timestamp || new Date().toISOString();
    const capabilities: EnvironmentCapabilities = {
      actions: captureSatisfied
        ? (rawObservation?.capabilities?.actions ?? []).filter(action => action !== 'captureImage')
        : rawObservation?.capabilities?.actions ?? [],
      robotCommands: rawObservation?.capabilities?.robotCommands,
      motionClasses: rawObservation?.capabilities?.motionClasses,
      text: rawObservation?.capabilities?.text ?? true,
      movement: rawObservation?.capabilities?.movement ?? false,
      visual: rawObservation?.capabilities?.visual ?? false,
      map: rawObservation?.capabilities?.map ?? false,
      navigation: rawObservation?.capabilities?.navigation ?? false,
      visualApproach: rawObservation?.capabilities?.visualApproach,
    };
    const observation: EnvironmentObservation = {
      environmentId: rawObservation?.environmentId ?? 'unavailable',
      adapter: rawObservation?.adapter ?? 'none',
      sessionId,
      timestamp,
      capabilities,
      text,
      state: rawObservation?.state ?? {},
      location: rawObservation?.location,
      map: rawObservation?.map,
      visual: rawObservation?.visual,
      visuals: rawObservation?.visuals,
      feedback: rawObservation?.feedback,
      metadata: rawObservation?.metadata,
    };
    return {
      observation,
      instruction,
      text,
      state: observation.state ?? {},
      location: observation.location ?? null,
      sessionId,
      valid: instruction.length > 0 || Boolean(rawObservation),
    };
  },
});
