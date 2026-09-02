import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import {
  buildEnvironmentSelectorJsonSchema,
  projectRobotCommandDescriptions,
  robotOperatorActionRequirement,
} from '../environment/helpers.js';
import { ROBOT_OPERATOR_DECISION_JSON_SCHEMA } from './decision-parser.node.js';

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

function delegatedPlannerDecision(
  observation: EnvironmentObservation,
): Record<string, unknown> | null {
  const value = isRecord(observation.metadata?.robotOperatorDecision)
    ? observation.metadata.robotOperatorDecision
    : null;
  if (!value) return null;
  const observed = cleanText(value.observed, 500);
  const instruction = cleanText(value.instruction, 1_000);
  const reason = cleanText(value.reason, 500);
  if (!observed || !instruction || !reason) return null;
  return {
    provenance: 'boredom_planner_decision',
    observed,
    instruction,
    reason,
    ...(cleanText(value.decidedAt, 100) ? { decidedAt: cleanText(value.decidedAt, 100) } : {}),
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
  taskState: unknown,
): Record<string, unknown> {
  const step = isRecord(taskState) && typeof taskState.step === 'number'
    ? taskState.step
    : 0;
  return buildEnvironmentSelectorJsonSchema({
    actions: observation.capabilities.actions,
    robotCommands: observation.capabilities.robotCommands,
    requireAction: step === 0 && robotOperatorActionRequirement(observation) === true,
    requireObjective: true,
    requireProgress: true,
    requireAutonomousConsequence: true,
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
    { name: 'preparedMovementRequest', type: 'object', optional: true, description: 'Already-authorized off-script request ready for Movement Generator' },
    { name: 'robotStatus', type: 'object', optional: true, description: 'Reusable Robot Status supporting context' },
  ],
  outputs: [
    { name: 'messages', type: 'array', description: 'Multimodal messages for the configured Robot Operator LLM' },
    { name: 'jsonSchema', type: 'object', description: 'Capability-bounded Environment action output schema' },
    { name: 'context', type: 'object', description: 'Structured high-level deliberation context' },
    { name: 'stimulusReady', type: 'boolean', description: 'Whether a correlated image or action result is available for an evidence-first planner' },
    { name: 'valid', type: 'boolean', description: 'Whether the configured context is ready for deliberation' },
    { name: 'error', type: 'string', description: 'Visible configuration or input error' },
  ],
  properties: { outputContract: 'environment' },
  propertySchemas: {
    outputContract: {
      type: 'select',
      default: 'environment',
      label: 'Output Contract',
      options: ['environment', 'delegation'],
      description: 'Choose an executable Environment decision or a high-level planner instruction.',
    },
  },
  description: 'Consolidates separately supplied instructions, conversation, inner context, persona, trigger metadata, and current robot perception for the Robot Operator LLM.',
  async execute(inputs, _context, properties) {
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction, 8_000);
    const stimulusInstruction = cleanText(inputs.stimulusInstruction, 4_000);
    const invalid = (error: string) => ({
      messages: [],
      jsonSchema: null,
      context: null,
      stimulusReady: false,
      valid: false,
      error,
    });
    if (!observation?.sessionId) return invalid('Robot Operator context requires a robot observation with a session ID.');
    if (!instruction) return invalid('Robot Operator context requires instructions from a connected text input node.');

    const innerContext = consolidatedInnerHistory(inputs.innerHistory).slice(-2);
    const conversationContext = consolidatedHistory(inputs.conversationHistory)
      .filter(entry => innerContext.length === 0 || !(
        isRecord(entry.context) && entry.context.isInnerDialogue === true
      ))
      .slice(-4);
    const recentContext = [...conversationContext, ...innerContext];
    const allActionHistory = verifiedActionHistory(inputs.actionHistory);
    const innerContextCount = recentContext.filter(entry => (
      isRecord(entry.context) && entry.context.isInnerDialogue === true
    )).length;
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
    const plannerDecision = delegatedPlannerDecision(observation);
    const cycleId = cleanText(trigger.cycleId, 200);
    const latestActionContext = isRecord(observation.metadata?.actionContext)
      ? observation.metadata.actionContext
      : null;
    const latestActionCorrelationId = cleanText(latestActionContext?.correlationId, 200);
    const currentActionContext = latestActionContext
      && cycleId
      && latestActionCorrelationId === cycleId
      ? latestActionContext
      : null;
    const currentActionId = cleanText(currentActionContext?.actionId, 200);
    const actionHistory = currentActionId
      ? allActionHistory.filter(entry => cleanText(entry.actionId, 200) !== currentActionId)
      : allActionHistory;
    const latestActionAlreadyInHistory = latestActionContext
      ? allActionHistory.some(entry => (
          cleanText(entry.actionId, 200) === cleanText(latestActionContext.actionId, 200)
        ))
      : false;
    const historicalLatestAction = latestActionContext
      && !currentActionContext
      && !latestActionAlreadyInHistory
      ? boundedObject(latestActionContext, 2_000)
      : null;
    const taskState = isRecord(inputs.taskState)
      ? boundedObject(inputs.taskState, 4_000)
      : null;
    const resumePreparedMovement = isRecord(inputs.preparedMovementRequest);
    const robotStatus = isRecord(inputs.robotStatus)
      ? boundedObject(inputs.robotStatus, 6_000)
      : null;
    const taskNarrative = recentContext.filter(entry => (
      isRecord(entry.context) && cleanText(entry.context.correlationId, 200) === cycleId
    ));
    const backgroundNarrative = recentContext.filter(entry => !taskNarrative.includes(entry));
    const reflectionTrigger = trigger.requestedBy === 'boredom-reflection'
      || cleanText(observation.metadata?.autonomousStimulus, 100) === 'boredom-reflection';
    const feedback = compactFeedback(observation);
    const stimulusReady = images.length > 0 || feedback.length > 0;
    const robotCommandDescriptions = properties?.outputContract === 'delegation'
      ? {}
      : projectRobotCommandDescriptions(observation.capabilities);
    const {
      robotCommandDescriptions: _unboundedRobotCommandDescriptions,
      ...baseCapabilities
    } = observation.capabilities;
    const stimulus = {
      observedAt: observation.timestamp,
      stateObservedAt: cleanText(observation.metadata?.sourceObservationAt, 100)
        || observation.timestamp,
      trigger,
      state: boundedObject(observation.state, 8_000),
      location: boundedObject(observation.location, 4_000),
      map: boundedObject(observation.map, 4_000),
      capabilities: boundedObject({
        ...baseCapabilities,
        ...(Object.keys(robotCommandDescriptions).length > 0
          ? { robotCommandDescriptions }
          : {}),
      }, 8_000),
      feedback,
      verifiedCurrentAction: boundedObject(currentActionContext, 2_000),
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
      ...(plannerDecision
        ? { plannerDecision }
        : stimulusInstruction
          ? { autonomyTriggerInstruction: stimulusInstruction }
          : {}),
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
      ? [{ type: 'text', text: `The attached image is what you currently see.\n${stimulusText}` }, ...images]
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
          ...(robotStatus
            ? {
                robotStatus: {
                  provenance: 'profile_robot_status_snapshot',
                  currentEvidence: false,
                  state: robotStatus,
                },
              }
            : {}),
          ...(historicalLatestAction
            ? {
                recentActionContext: {
                  provenance: 'latest_environment_action_context',
                  currentEvidence: false,
                  entry: historicalLatestAction,
                },
              }
            : {}),
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
      messages: resumePreparedMovement
        ? []
        : [
            { role: 'system', content: instruction },
            supportingContext,
            { role: 'user', content: userContent },
          ],
      jsonSchema: resumePreparedMovement
        ? null
        : properties?.outputContract === 'delegation'
          ? ROBOT_OPERATOR_DECISION_JSON_SCHEMA
          : autonomySelectorSchema(observation, inputs.taskState),
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
        historicalLatestActionIncluded: Boolean(historicalLatestAction),
        memoryContextCount: memoryContext.length,
        robotStatusIncluded: Boolean(robotStatus),
        plannerDecisionIncluded: Boolean(plannerDecision),
        reflectionMaterialIncluded: reflectionTrigger && memoryContext.length > 0,
        imageCount: images.length,
        selectorInvoked: !resumePreparedMovement,
      },
      stimulusReady,
      valid: true,
      error: '',
    };
  },
});
