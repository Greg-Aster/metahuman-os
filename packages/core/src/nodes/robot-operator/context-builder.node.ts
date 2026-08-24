import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import {
  buildEnvironmentSelectorJsonSchema,
  robotOperatorActionRequirement,
} from '../environment/helpers.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function correlationId(observation: EnvironmentObservation): string {
  const direct = cleanText(observation.metadata?.correlationId, 200);
  if (direct) return direct;
  const cycle = isRecord(observation.metadata?.robotObserver)
    ? observation.metadata.robotObserver
    : null;
  return cleanText(cycle?.cycleId, 200);
}

function frameSummary(frame: EnvironmentVisualFrame): Record<string, unknown> {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    mimeType: frame.mimeType,
    width: frame.width,
    height: frame.height,
    correlationId: cleanText(frame.metadata?.correlationId, 200) || undefined,
  };
}

function normalizedTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        .map(tag => tag.trim().toLowerCase())
    : [];
}

function consolidatedHistory(value: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  const history: Array<Record<string, unknown>> = [];
  for (const message of messages.filter(isRecord)) {
    const meta = isRecord(message.meta) ? message.meta : null;
    const sourceRole = cleanText(message.role, 40).toLowerCase();
    const originalRole = cleanText(meta?.originalRole, 40).toLowerCase();
    const isInnerDialogue = meta?.isInnerDialogue === true;
    const role = isInnerDialogue
      ? 'assistant'
      : sourceRole === 'system' || sourceRole === 'user' || sourceRole === 'assistant'
        ? sourceRole
        : '';
    const content = cleanText(message.content, 4_000);
    if (!role || !content) continue;
    history.push({
      role,
      content,
      ...(typeof message.timestamp === 'number' || typeof message.timestamp === 'string'
        ? { timestamp: message.timestamp }
        : {}),
      ...(meta
        ? {
            context: {
              isInnerDialogue,
              originalRole: originalRole || null,
              dialogueSource: cleanText(meta.dialogueSource, 100) || null,
              correlationId: cleanText(meta.correlationId, 200) || null,
              tags: normalizedTags(meta.tags),
              taskLifecycle: boundedObject(meta.taskLifecycle, 2_000),
            },
          }
        : {}),
    });
  }
  return history;
}

function consolidatedInnerHistory(value: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  return messages.filter(isRecord).flatMap(message => {
    const content = cleanText(message.content, 2_000);
    if (!content) return [];
    const meta = isRecord(message.meta) ? message.meta : {};
    return [{
      role: 'assistant',
      content,
      ...(typeof message.timestamp === 'number' || typeof message.timestamp === 'string'
        ? { timestamp: message.timestamp }
        : {}),
      context: {
        isInnerDialogue: true,
        originalRole: cleanText(message.role, 40).toLowerCase() || 'reflection',
        dialogueSource: cleanText(meta.dialogueSource, 100) || null,
        correlationId: cleanText(meta.correlationId, 200) || null,
        tags: normalizedTags(meta.tags),
      },
    }];
  });
}

function boundedObject(value: unknown, maxLength = 8_000): unknown {
  if (!isRecord(value) && !Array.isArray(value)) return value ?? null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length <= maxLength) return value;
    return { truncatedJson: encoded.slice(0, maxLength) };
  } catch {
    return null;
  }
}

function selectedImageParts(
  observation: EnvironmentObservation,
  images: unknown,
  frames: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(images) || !Array.isArray(frames)) return [];
  const expectedCorrelationId = correlationId(observation);
  if (!expectedCorrelationId) return [];
  const frameList = frames.filter(isRecord) as unknown as EnvironmentVisualFrame[];
  const index = frameList.findIndex(frame => (
    cleanText(frame.metadata?.correlationId, 200) === expectedCorrelationId
  ));
  if (index < 0 || !isRecord(images[index]) || images[index].type !== 'image_url') return [];
  return [images[index]];
}

function robotTrigger(observation: EnvironmentObservation): Record<string, unknown> {
  const metadata = isRecord(observation.metadata) ? observation.metadata : null;
  const observer = isRecord(metadata?.robotObserver) ? metadata.robotObserver : null;
  const perceptionEvent = cleanText(metadata?.perceptionEvent, 100);
  const triggerSource = cleanText(observer?.triggerSource, 40);
  const requestedBy = cleanText(observer?.requestedBy, 100);
  return {
    type: perceptionEvent || (observer ? 'robot_observer' : 'environment_observation'),
    source: triggerSource || null,
    requestedBy: requestedBy || null,
    correlationId: correlationId(observation) || null,
    cycleId: cleanText(observer?.cycleId, 200) || null,
    step: typeof observer?.step === 'number' ? observer.step : null,
  };
}

function compactFeedback(observation: EnvironmentObservation): Array<Record<string, unknown>> {
  return (observation.feedback ?? []).slice(-8).map(feedback => ({
    id: feedback.id,
    timestamp: feedback.timestamp,
    type: feedback.type,
    message: cleanText(feedback.message, 1_000),
    actionId: feedback.actionId ?? null,
    data: boundedObject(feedback.data, 2_000),
  }));
}

function compactAction(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const type = cleanText(value.type, 60);
  if (!type) return null;
  return {
    type,
    ...(cleanText(value.command, 120) ? { command: cleanText(value.command, 120) } : {}),
    ...(cleanText(value.direction, 60) ? { direction: cleanText(value.direction, 60) } : {}),
    ...(typeof value.units === 'number' ? { units: value.units } : {}),
    ...(cleanText(value.target, 160) ? { target: cleanText(value.target, 160) } : {}),
  };
}

function autonomySelectorSchema(
  observation: EnvironmentObservation,
): Record<string, unknown> {
  return buildEnvironmentSelectorJsonSchema({
    actions: observation.capabilities.actions,
    robotCommands: observation.capabilities.robotCommands,
    requireAction: robotOperatorActionRequirement(observation) === true,
    requireMotionClass: false,
    requireObjective: true,
  });
}

/**
 * Turn canonical Robot Buffer records into a small, correlated action ledger.
 * This is action evidence; conversation and memories are intentionally absent.
 */
function verifiedActionHistory(value: unknown): Array<Record<string, unknown>> {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.messages)
      ? value.messages
      : [];
  const actions = new Map<string, Record<string, unknown>>();
  let anonymousIndex = 0;

  for (const message of messages.filter(isRecord)) {
    const meta = isRecord(message.meta) ? message.meta : null;
    const record = isRecord(meta?.bridgeRecord) ? meta.bridgeRecord : null;
    if (!record) continue;
    const timestamp = typeof message.timestamp === 'number' || typeof message.timestamp === 'string'
      ? message.timestamp
      : undefined;

    if (record.direction === 'inbound') {
      const action = isRecord(record.action) ? record.action : null;
      const actionId = cleanText(record.actionId, 200) || cleanText(action?.id, 200);
      if (!actionId) continue;
      const prior = actions.get(actionId) ?? { actionId };
      actions.set(actionId, {
        ...prior,
        requested: compactAction(action) ?? prior.requested,
        status: cleanText(record.status, 60) || 'reported',
        result: cleanText(record.message, 500) || undefined,
        completedAt: timestamp,
        verified: true,
      });
      continue;
    }

    const commands = Array.isArray(record.commands) ? record.commands.filter(isRecord) : [];
    for (const command of commands) {
      const actionId = cleanText(command.id, 200) || `outbound-${anonymousIndex++}`;
      actions.set(actionId, {
        actionId,
        requested: compactAction(command),
        status: cleanText(command.status, 60) || cleanText(record.status, 60) || 'queued',
        correlationId: cleanText(command.correlationId, 200)
          || cleanText(record.correlationId, 200)
          || undefined,
        requestedAt: timestamp,
        verified: false,
      });
    }
  }

  return [...actions.values()].filter(entry => entry.requested).slice(-8);
}

export const robotOperatorContextBuilderNode = defineNode({
  id: 'robot_operator_context_builder',
  name: 'Robot Operator Context',
  category: 'operator',
  inputs: [
    { name: 'instruction', type: 'string', description: 'Graph-owned Robot Operator instructions' },
    { name: 'stimulusInstruction', type: 'string', optional: true, description: 'Specialized trigger instruction for this autonomous cycle' },
    { name: 'observation', type: 'object', description: 'Current correlated robot observation or agent-produced stimulus' },
    { name: 'images', type: 'array', optional: true, description: 'Validated image content parts' },
    { name: 'frames', type: 'array', optional: true, description: 'Validated visual frame metadata' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Canonical recent conversation with unified inner context when enabled' },
    { name: 'innerHistory', type: 'array', optional: true, description: 'Canonical recent private reflection entries supplied separately' },
    { name: 'actionHistory', type: 'array', optional: true, description: 'Canonical Robot Buffer entries used as verified prior-action evidence' },
    { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona' },
    { name: 'memoryContext', type: 'array', optional: true, description: 'Historical memories supplied as inspiration, never current-world evidence' },
    { name: 'taskState', type: 'object', optional: true, description: 'Canonical Environment Task State for the current autonomy objective' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Multimodal messages for the configured Robot Operator LLM' },
    { name: 'jsonSchema', type: 'object', description: 'Capability-bounded Environment action output schema' },
    { name: 'context', type: 'object', description: 'Structured high-level deliberation context' },
    { name: 'valid', type: 'boolean', description: 'Whether the configured context is ready for deliberation' },
    { name: 'error', type: 'string', description: 'Visible configuration or input error' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Consolidates separately supplied instructions, conversation, inner context, persona, trigger metadata, and current robot perception for the Robot Operator LLM.',
  async execute(inputs) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction, 8_000);
    const stimulusInstruction = cleanText(inputs.stimulusInstruction, 4_000);
    const invalid = (error: string) => ({
      messages: [],
      jsonSchema: null,
      context: null,
      valid: false,
      error,
    });
    if (!observation?.sessionId) return invalid('Robot Operator context requires a robot observation with a session ID.');
    if (!instruction) return invalid('Robot Operator context requires instructions from a connected text input node.');

    const conversationContext = consolidatedHistory(inputs.conversationHistory).slice(-4);
    const innerContext = consolidatedInnerHistory(inputs.innerHistory).slice(-2);
    const recentContext = [...conversationContext, ...innerContext];
    const actionHistory = verifiedActionHistory(inputs.actionHistory);
    const innerContextCount = recentContext.filter(entry => (
      isRecord(entry.context) && entry.context.isInnerDialogue === true
    )).length;
    console.log(
      `[RobotOperatorContext] Consolidated context entries: ${recentContext.length}; inner entries: ${innerContextCount}`,
    );
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 12_000)
      : '';
    const suppliedMemories = Array.isArray(inputs.memoryContext) ? inputs.memoryContext : [];
    const delegatedMemories = Array.isArray(observation.metadata?.robotOperatorMemories)
      ? observation.metadata.robotOperatorMemories
      : [];
    const seenMemories = new Set<string>();
    const memoryContext = [...suppliedMemories, ...delegatedMemories].flatMap(memory => {
      const bounded = boundedObject(memory, 4_000);
      const key = typeof memory === 'string'
        ? cleanText(memory, 4_000)
        : isRecord(memory)
          ? cleanText(memory.content, 4_000)
          : '';
      if (!key || seenMemories.has(key)) return [];
      seenMemories.add(key);
      return [bounded];
    }).slice(0, 5);
    const images = selectedImageParts(observation, inputs.images, inputs.frames);
    const frames = [observation.visual, ...(observation.visuals ?? [])]
      .filter((frame): frame is EnvironmentVisualFrame => Boolean(frame))
      .map(frameSummary);
    const trigger = robotTrigger(observation);
    const cycleId = cleanText(trigger.cycleId, 200);
    const taskState = isRecord(inputs.taskState)
      ? boundedObject(inputs.taskState, 4_000)
      : null;
    const taskNarrative = recentContext.filter(entry => (
      isRecord(entry.context) && cleanText(entry.context.correlationId, 200) === cycleId
    ));
    const backgroundNarrative = recentContext.filter(entry => !taskNarrative.includes(entry));
    const reflectionTrigger = trigger.requestedBy === 'boredom-reflection'
      || cleanText(observation.metadata?.autonomousStimulus, 100) === 'boredom-reflection';
    const stimulus = {
      observedAt: observation.timestamp,
      stateObservedAt: cleanText(observation.metadata?.sourceObservationAt, 100)
        || observation.timestamp,
      trigger,
      state: boundedObject(observation.state, 8_000),
      location: boundedObject(observation.location, 4_000),
      map: boundedObject(observation.map, 4_000),
      capabilities: boundedObject(observation.capabilities, 4_000),
      feedback: compactFeedback(observation),
      verifiedCurrentAction: boundedObject(observation.metadata?.actionContext, 2_000),
      text: (observation.text ?? []).slice(-8).map(event => ({
        source: event.source,
        sender: event.senderName ?? event.senderId ?? null,
        text: cleanText(event.text, 2_000),
        timestamp: event.timestamp,
      })),
      visualFrames: frames,
      currentVisualEvidence: observation.metadata?.currentVisualEvidence === true,
    };
    const stimulusText = JSON.stringify({
      robotStimulus: stimulus,
      ...(stimulusInstruction ? { autonomyTriggerInstruction: stimulusInstruction } : {}),
      ...(reflectionTrigger
        ? {
            reflectionMaterial: {
              provenance: 'historical_memory_inspiration',
              currentEvidence: false,
              entries: memoryContext,
            },
          }
        : {}),
    });
    const userContent = images.length > 0
      ? [{ type: 'text', text: stimulusText }, ...images]
      : stimulusText;
    const supportingMemoryContext = reflectionTrigger ? [] : memoryContext;
    const supportingContext = {
      role: 'assistant',
      content: JSON.stringify({
        robotOperatorContext: {
          activePersona: personaText || null,
          environmentTaskState: {
            provenance: 'canonical_environment_task_state',
            state: taskState,
            correlatedNarrative: taskNarrative,
          },
          recentContext: {
            provenance: 'canonical_conversation_history',
            evidenceStatus: 'narrative_only',
            includesUnifiedInnerContext: innerContextCount > 0,
            entries: backgroundNarrative,
          },
          verifiedActionHistory: {
            provenance: 'canonical_robot_buffer',
            entries: actionHistory,
          },
          ...(supportingMemoryContext.length > 0
            ? {
                sampledMemories: {
                  provenance: 'historical_memory_inspiration',
                  currentEvidence: false,
                  entries: supportingMemoryContext,
                },
              }
            : {}),
          currentEvidence: false,
        },
      }),
    };

    return {
      messages: [
        { role: 'system', content: instruction },
        supportingContext,
        { role: 'user', content: userContent },
      ],
      jsonSchema: autonomySelectorSchema(observation),
      context: {
        instruction,
        stimulusInstruction,
        stimulus,
        recentContext,
        taskNarrativeCount: taskNarrative.length,
        personaIncluded: Boolean(personaText),
        recentContextCount: recentContext.length,
        innerContextCount,
        actionHistoryCount: actionHistory.length,
        memoryContextCount: memoryContext.length,
        reflectionMaterialIncluded: reflectionTrigger && memoryContext.length > 0,
        imageCount: images.length,
      },
      valid: true,
      error: '',
    };
  },
});
