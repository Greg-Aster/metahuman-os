import { defineNode } from '../types.js';
import type {
  EnvironmentCapabilities,
  EnvironmentFeedback,
  EnvironmentObservation,
  EnvironmentTextEvent,
} from '../../environment-interface/index.js';
import { hasFreshCorrelatedVisual } from '../../environment-interface/index.js';
import { readRobotObserverCycle } from '../../robot-operator.js';

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
  allowContinuation: boolean,
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
  const command = terminal.data?.command;
  const mayContinue = (
    allowContinuation
    && terminal.type === 'completed'
    && command !== 'stop'
  );
  return {
    id: `environment-feedback-${terminal.id}`,
    source: 'system',
    text: mayContinue
      ? [
          `Robot action completed: ${terminal.message}.`,
          'Inspect the fresh correlated observation and report what happened.',
          'The completed action is satisfied; do not repeat it merely because it appears in the original user goal.',
          'Choose at most one next semantic action only when the original goal explicitly requires an unfinished step.',
        ].join(' ')
      : `Robot action ${terminal.type}: ${terminal.message}. Report this result once to the user and do not issue a new action.`,
    timestamp: terminal.timestamp,
    metadata: { actionId: terminal.actionId, feedbackId: terminal.id },
  };
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
    const observationText = filterTextEvents(rawObservation?.text ?? []);
    const currentTaskEvent = textEventFromMessage(contextMessage);
    const originatingInstruction = typeof rawObservation?.metadata?.originatingInstruction === 'string'
      ? rawObservation.metadata.originatingInstruction.trim()
      : '';
    const robotObserver = readRobotObserverCycle(rawObservation);
    const captureSatisfied = Boolean(
      !currentTaskEvent
      && robotObserver
      && hasFreshCorrelatedVisual(rawObservation, robotObserver.cycleId),
    );
    // A typed or coordinator-supplied current task is the only authoritative
    // instruction for this execution. Adapter text is used when no current task
    // exists, preventing an older transcript from replacing a UI command.
    const feedbackEvent = terminalFeedbackEvent(
      rawObservation?.feedback,
      Boolean(robotObserver),
    );
    const text = currentTaskEvent ? [currentTaskEvent] : feedbackEvent ? [feedbackEvent] : observationText;
    const satisfiedCaptureInstruction = captureSatisfied
      ? [
          'A fresh correlated robot image has returned, so the visual acquisition for this interaction is complete.',
          'Use the attached image to answer the original user goal now. Do not request another image in this continuation.',
          originatingInstruction ? `Original user goal: ${originatingInstruction}` : '',
        ].filter(Boolean).join('\n')
      : '';
    const feedbackInstruction = feedbackEvent
      ? [
          feedbackEvent.text,
          originatingInstruction
            ? `Original user goal (context only; not a new command): ${originatingInstruction}`
            : '',
        ].filter(Boolean).join('\n')
      : '';
    const instruction = currentTaskEvent?.text
      || satisfiedCaptureInstruction
      || feedbackInstruction
      || originatingInstruction
      || text.map(event => event.text).join('\n').trim();
    const sessionId = rawObservation?.sessionId ?? '';
    const timestamp = rawObservation?.timestamp || new Date().toISOString();
    const capabilities: EnvironmentCapabilities = {
      actions: captureSatisfied
        ? (rawObservation?.capabilities?.actions ?? []).filter(action => action !== 'captureImage')
        : rawObservation?.capabilities?.actions ?? [],
      robotCommands: rawObservation?.capabilities?.robotCommands,
      text: rawObservation?.capabilities?.text ?? true,
      movement: rawObservation?.capabilities?.movement ?? false,
      visual: rawObservation?.capabilities?.visual ?? false,
      map: rawObservation?.capabilities?.map ?? false,
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
