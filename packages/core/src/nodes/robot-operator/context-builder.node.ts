import { serializeContext } from '../../context-serialization.js';
import { projectDesireAwareness } from '../../agency/lifecycle-policy.js'
import { withVisualObservationSchema } from '../../visual-observation.js';
import { recognitionImageAssociation } from '../../environment-interface/perception.js';
import type {
  EnvironmentObservation,
  EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import { defineNode } from '../types.js';
import {
  parseRobotObserverCycle,
  type RobotObserverCycleMetadata,
} from '../../robot-operator.js';
import {
  projectRobotStatusContext,
  projectSelectorState,
} from '../environment/helpers.js';
import type { NodeSlot } from '../types.js';
import { ROBOT_OPERATOR_DECISION_JSON_SCHEMA } from './decision-parser.node.js';
import { buildRobotGoalReviewJsonSchema } from './goal-review-parser.node.js';
import { buildRobotAutonomyControllerJsonSchema } from './autonomy-controller-parser.node.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.trim()
    : '';
}

function correlationId(
  observation: EnvironmentObservation | null,
  robotObserver: RobotObserverCycleMetadata | null,
): string {
  return cleanText(robotObserver?.cycleId)
    || cleanText(observation?.metadata?.correlationId);
}

function frameSummary(frame: EnvironmentVisualFrame): Record<string, unknown> {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    mimeType: frame.mimeType,
    width: frame.width,
    height: frame.height,
    cameraFrame: frame.metadata ? {
      robotId: frame.metadata.robotId,
      gatewayInstance: frame.metadata.gatewayInstance,
      epoch: frame.metadata.epoch,
      counter: frame.metadata.counter,
    } : undefined,
    actionId: cleanText(frame.metadata?.actionId) || undefined,
    correlationId: cleanText(frame.metadata?.correlationId) || undefined,
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
    const sourceRole = cleanText(message.role).toLowerCase();
    const originalRole = cleanText(meta?.originalRole).toLowerCase();
    const isInnerDialogue = meta?.isInnerDialogue === true;
    const role = isInnerDialogue
      ? 'assistant'
      : sourceRole === 'system' || sourceRole === 'user' || sourceRole === 'assistant'
        ? sourceRole
        : '';
    const content = cleanText(message.content);
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
              dialogueSource: cleanText(meta.dialogueSource) || null,
              correlationId: cleanText(meta.correlationId) || null,
              executionId: cleanText(meta.executionId) || null,
              tags: normalizedTags(meta.tags),
              taskLifecycle: meta.taskLifecycle ?? null,
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
    const content = cleanText(message.content);
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
        originalRole: cleanText(message.role).toLowerCase() || 'reflection',
        dialogueSource: cleanText(meta.dialogueSource) || null,
        correlationId: cleanText(meta.correlationId) || null,
        tags: normalizedTags(meta.tags),
      },
    }];
  });
}

function selectedImageParts(
  images: unknown,
  frames: unknown,
): Array<{ image: Record<string, unknown>; frame: EnvironmentVisualFrame }> {
  if (!Array.isArray(images) || !Array.isArray(frames)) return [];
  return images.flatMap((image, index) => {
    const frame = frames[index];
    if (!isRecord(image) || image.type !== 'image_url') return [];
    if (!isRecord(frame) || !isRecord(image.image_url) || image.image_url.url !== frame.dataUrl) {
      throw new Error('Selected image bytes do not match their source frame');
    }
    return [{ image, frame: frame as unknown as EnvironmentVisualFrame }];
  });
}

function robotTrigger(
  observation: EnvironmentObservation | null,
  robotObserver: RobotObserverCycleMetadata | null,
): Record<string, unknown> {
  const metadata = isRecord(observation?.metadata) ? observation.metadata : null;
  const perceptionEvent = cleanText(metadata?.perceptionEvent);
  const triggerSource = cleanText(robotObserver?.triggerSource);
  const requestedBy = cleanText(robotObserver?.requestedBy);
  return {
    type: perceptionEvent || (robotObserver ? 'robot_observer' : 'environment_observation'),
    source: triggerSource || null,
    requestedBy: requestedBy || null,
    correlationId: correlationId(observation, robotObserver) || null,
    cycleId: cleanText(robotObserver?.cycleId) || null,
    step: typeof robotObserver?.step === 'number' ? robotObserver.step : null,
  };
}

function delegatedPlannerDecision(
  input: unknown,
): Record<string, unknown> | null {
  const value = isRecord(input) ? input : null;
  if (!value) return null;
  const observed = cleanText(value.observed);
  const instruction = cleanText(value.instruction);
  const reason = cleanText(value.reason);
  if (!observed || !instruction || !reason) return null;
  return {
    provenance: 'boredom_planner_decision',
    observed,
    instruction,
    reason,
    ...(cleanText(value.decidedAt) ? { decidedAt: cleanText(value.decidedAt) } : {}),
  };
}

function compactFeedback(observation: EnvironmentObservation): Array<Record<string, unknown>> {
  return (observation.feedback ?? []).slice(-8).map(feedback => ({
    id: feedback.id,
    timestamp: feedback.timestamp,
    type: feedback.type,
    message: cleanText(feedback.message),
    actionId: feedback.actionId ?? null,
    data: feedback.data ?? null,
  }));
}

function compactAction(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const type = cleanText(value.type);
  if (!type) return null;
  return {
    type,
    ...(cleanText(value.command) ? { command: cleanText(value.command) } : {}),
    ...(cleanText(value.direction) ? { direction: cleanText(value.direction) } : {}),
    ...(typeof value.units === 'number' ? { units: value.units } : {}),
    ...(cleanText(value.target) ? { target: cleanText(value.target) } : {}),
  };
}

function compactBridgeSummary(value: unknown, sessionId: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const sessions = Array.isArray(value.sessions) ? value.sessions.filter(isRecord) : [];
  const selected = sessions.find(session => cleanText(session.sessionId) === sessionId)
    ?? sessions.find(session => cleanText(session.status) === 'connected')
    ?? null;
  return {
    enabled: value.enabled === true,
    updatedAt: cleanText(value.updatedAt) || null,
    sessionCount: typeof value.sessionCount === 'number' ? value.sessionCount : sessions.length,
    pendingCommandCount: typeof selected?.pendingCommandCount === 'number' ? selected.pendingCommandCount : 0,
    selectedSession: selected
      ? {
          sessionId: cleanText(selected.sessionId) || null,
          environmentId: cleanText(selected.environmentId) || null,
          adapter: cleanText(selected.adapter) || null,
          status: cleanText(selected.status) || null,
          firstSeenAt: cleanText(selected.firstSeenAt) || null,
          lastSeenAt: cleanText(selected.lastSeenAt) || null,
        }
      : null,
  };
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
      const actionId = cleanText(record.actionId) || cleanText(action?.id);
      if (!actionId) continue;
      const prior = actions.get(actionId) ?? { actionId };
      actions.set(actionId, {
        ...prior,
        requested: compactAction(action) ?? prior.requested,
        status: cleanText(record.status) || 'reported',
        result: cleanText(record.message) || undefined,
        completedAt: timestamp,
        verified: true,
      });
      continue;
    }

    const commands = Array.isArray(record.commands) ? record.commands.filter(isRecord) : [];
    for (const command of commands) {
      const actionId = cleanText(command.id) || `outbound-${anonymousIndex++}`;
      actions.set(actionId, {
        actionId,
        requested: compactAction(command),
        status: cleanText(command.status) || cleanText(record.status) || 'queued',
        correlationId: cleanText(command.correlationId)
          || cleanText(record.correlationId)
          || undefined,
        requestedAt: timestamp,
        verified: false,
      });
    }
  }

  return [...actions.values()].filter(entry => entry.requested);
}

type RobotOperatorContextContract = 'delegation' | 'goal_review' | 'autonomy_controller';

const CONTEXT_OUTPUTS: NodeSlot[] = [
  { name: 'frames', type: 'array', description: 'Exact source frames attached to this model call' },
  { name: 'messages', type: 'array', description: 'Multimodal messages for this workflow LLM' },
  { name: 'jsonSchema', type: 'object', description: 'Structured output contract for this workflow LLM' },
  { name: 'context', type: 'object', description: 'Inspectable context summary' },
  { name: 'stimulusReady', type: 'boolean', description: 'Whether correlated image or action-result evidence is available' },
  { name: 'valid', type: 'boolean', description: 'Whether context construction succeeded' },
  { name: 'error', type: 'string', description: 'Visible input error' },
];

const COMMON_CONTEXT_INPUTS: Record<string, NodeSlot> = {
  observationHistory: { name: 'observationHistory', type: 'array', optional: true, description: 'Image-linked interpretations supplied by Observation History' },
  execution: { name: 'execution', type: 'object', optional: true, description: 'Checkpointed task and ordered events from Current Execution' },
  instruction: { name: 'instruction', type: 'string', description: 'Graph-owned instructions for this one LLM task' },
  observation: { name: 'observation', type: 'object', optional: true, description: 'Environment Bridge observation supplied to this workflow' },
  bridgeSummary: { name: 'bridgeSummary', type: 'object', optional: true, description: 'Current Environment Bridge connection and session summary' },
  images: { name: 'images', type: 'array', optional: true, description: 'Validated image content parts' },
  frames: { name: 'frames', type: 'array', optional: true, description: 'Validated visual frame metadata' },
  conversationHistory: { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation entries selected by the connected Buffer History node' },
  innerHistory: { name: 'innerHistory', type: 'array', optional: true, description: 'Private reflection entries selected by the connected Buffer History node' },
  actionHistory: { name: 'actionHistory', type: 'array', optional: true, description: 'Robot Buffer entries used as verified prior-action evidence' },
  personaText: { name: 'personaText', type: 'string', optional: true, description: 'Formatted active persona' },
  memoryContext: { name: 'memoryContext', type: 'array', optional: true, description: 'Historical memories supplied as inspiration, never current-world evidence' },
  robotStatus: { name: 'robotStatus', type: 'object', optional: true, description: 'Canonical Robot Status snapshot' },
  activeDesires: { name: 'activeDesires', type: 'array', optional: true, description: 'Active Agency Desire summaries selected by the connected node' },
  activationState: { name: 'activationState', type: 'object', optional: true },
  availableTasks: { name: 'availableTasks', type: 'array', optional: true, description: 'Catalog-backed operations available to Active Operator' },
  autonomyActivityHistory: { name: 'autonomyActivityHistory', type: 'array', optional: true, description: 'Terminal receipts selected by Recent Autonomy Activity' },
  robotObserver: { name: 'robotObserver', type: 'object', optional: true, description: 'Current Robot Operator cycle' },
  plannerDecision: { name: 'plannerDecision', type: 'object', optional: true, description: 'Planner-authored intention delegated to Robot Autonomy Executor' },
  delegatedMemories: { name: 'delegatedMemories', type: 'array', optional: true, description: 'Historical memories delegated with a planner intention' },
  actionContext: { name: 'actionContext', type: 'object', optional: true, description: 'Work Coordinator action record matched to the returned robot report' },
  sourceObservationAt: { name: 'sourceObservationAt', type: 'string', optional: true, description: 'Timestamp of the bridge observation that started this cycle' },
  currentVisualEvidence: { name: 'currentVisualEvidence', type: 'boolean', optional: true, description: 'Whether Environment Image Input verified the attached frame for this decision' },
};

function contextInputs(...names: string[]): NodeSlot[] {
  return ['execution', 'observationHistory', ...names].map(name => COMMON_CONTEXT_INPUTS[name]);
}

async function buildRobotOperatorContext(
  inputs: Record<string, any>,
  outputContract: RobotOperatorContextContract,
) {
    const suppliedObservation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction);
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
    const invalid = (error: string) => ({
      messages: [],
      jsonSchema: null,
      context: null,
      stimulusReady: false,
      valid: false,
      error,
    });
    if (!instruction) return invalid('Robot Operator context requires instructions from a connected text input node.');

    const observation = suppliedObservation;
    if (outputContract !== 'autonomy_controller' && !observation?.sessionId) {
      return invalid('Robot Operator context requires a robot observation with a session ID for the selected route.');
    }

    const innerContext = consolidatedInnerHistory(inputs.innerHistory);
    const availableConversation = consolidatedHistory(inputs.conversationHistory)
      .filter(entry => innerContext.length === 0 || !(
        isRecord(entry.context) && entry.context.isInnerDialogue === true
      ));
    const recentContext = [...availableConversation, ...innerContext];
    const allActionHistory = verifiedActionHistory(inputs.actionHistory);
    const innerContextCount = recentContext.filter(entry => (
      isRecord(entry.context) && entry.context.isInnerDialogue === true
    )).length;
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim()
      : '';
    const suppliedMemories = Array.isArray(inputs.memoryContext)
      ? inputs.memoryContext
      : [];
    const delegatedMemories = Array.isArray(inputs.delegatedMemories)
      ? inputs.delegatedMemories
      : [];
    const seenMemories = new Set<string>();
    const memoryContext = [...suppliedMemories, ...delegatedMemories].flatMap(memory => {
      const key = typeof memory === 'string'
        ? cleanText(memory)
        : isRecord(memory)
          ? cleanText(memory.content)
          : '';
      if (!key || seenMemories.has(key)) return [];
      seenMemories.add(key);
      return [memory];
    }).slice(0, 5);
    const selectedEvidence = inputs.currentVisualEvidence === true
      ? selectedImageParts(inputs.images, inputs.frames)
      : [];
    const images = selectedEvidence.map(item => item.image);
    const selectedFrames = selectedEvidence.map(item => item.frame);
    const frames = selectedFrames.map(frameSummary);
    const trigger = robotTrigger(observation, robotObserver);
    const plannerDecision = delegatedPlannerDecision(inputs.plannerDecision);
    const cycleId = cleanText(trigger.cycleId);
    const latestActionContext = isRecord(inputs.actionContext)
      ? inputs.actionContext
      : null;
    const reportedActionId = cleanText(observation?.metadata?.actionId);
    const currentActionContext = latestActionContext
      && reportedActionId
      && cleanText(latestActionContext.actionId) === reportedActionId
      ? latestActionContext
      : null;
    const currentActionId = cleanText(currentActionContext?.actionId);
    const actionHistory = currentActionId
      ? allActionHistory.filter(entry => cleanText(entry.actionId) !== currentActionId)
      : allActionHistory;
    const latestActionAlreadyInHistory = latestActionContext
      ? allActionHistory.some(entry => (
          cleanText(entry.actionId) === cleanText(latestActionContext.actionId)
        ))
      : false;
    const historicalLatestAction = latestActionContext
      && !currentActionContext
      && !latestActionAlreadyInHistory
      ? latestActionContext
      : null;
    const projectedRobotStatus = isRecord(inputs.robotStatus)
      ? projectRobotStatusContext(inputs.robotStatus)
      : null;
    if (isRecord(projectedRobotStatus) && isRecord(projectedRobotStatus.live)
      && isRecord(projectedRobotStatus.live.recognition)) {
      const recognition = projectedRobotStatus.live.recognition;
      projectedRobotStatus.live = {
        ...projectedRobotStatus.live,
        recognition: {
          ...recognition,
          ...recognitionImageAssociation(
            isRecord(recognition.sourceFrame) ? recognition.sourceFrame : null,
            selectedFrames,
          ),
        },
      };
    }
    const robotStatus = projectedRobotStatus
      && (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      ? Object.fromEntries(Object.entries(projectedRobotStatus).filter(([key]) => key !== 'agency'))
      : projectedRobotStatus;
    const bridgeSummary = outputContract === 'autonomy_controller'
      ? compactBridgeSummary(inputs.bridgeSummary, cleanText(observation?.sessionId))
      : null;
    const activeDesires = (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      && Array.isArray(inputs.activeDesires)
      ? projectDesireAwareness(inputs.activeDesires)
      : [];
    const availableTasks = outputContract === 'autonomy_controller' && Array.isArray(inputs.availableTasks)
      ? inputs.availableTasks.filter(isRecord).map(({ id, name, description, kind }) => ({ id, name, description, kind }))
      : [];
    const autonomyActivityHistory = (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      && Array.isArray(inputs.autonomyActivityHistory)
      ? inputs.autonomyActivityHistory.filter(isRecord)
      : [];
    // Several finite activities can share one durable execution. Send its
    // outcome once rather than copying the same task and receipt into each row.
    const activityExecutions: Record<string, unknown> = {};
    const compactActivityHistory = autonomyActivityHistory.map(activity => {
      if (!isRecord(activity.result) || !Array.isArray(activity.result.executions)) return activity;
      const { executions, ...result } = activity.result;
      const executionIds = executions.filter(isRecord).map(execution => {
        const id = String(execution.executionId);
        activityExecutions[id] = execution;
        return id;
      });
      return { ...activity, result: { ...result, executionIds } };
    });
    const executionId = cleanText(inputs.execution?.executionId);
    const taskNarrative = recentContext.filter(entry => (
      isRecord(entry.context) && (
        Boolean(cycleId) && cleanText(entry.context.correlationId) === cycleId
        || Boolean(executionId) && cleanText(entry.context.executionId) === executionId
      )
    ));
    const backgroundNarrative = recentContext.filter(entry => !taskNarrative.includes(entry));
    const reflectionTrigger = trigger.requestedBy === 'boredom-reflection';
    const feedback = currentActionId && observation
      ? compactFeedback(observation).filter(item => item.actionId === currentActionId)
      : [];
    const visualEvidenceVerified = images.length > 0 && inputs.currentVisualEvidence === true;
    const stimulusReady = visualEvidenceVerified || feedback.length > 0;
    const baseCapabilities = observation?.capabilities ?? null;
    const stimulus = {
      trigger,
      ...(observation
        ? {
            observedAt: observation.timestamp,
            stateObservedAt: cleanText(inputs.sourceObservationAt) || observation.timestamp,
            state: projectSelectorState(observation.state) ?? null,
            location: observation.location ?? null,
            map: observation.map ?? null,
            capabilities: { ...baseCapabilities },
            text: (observation.text ?? []).slice(-8).map(event => ({
              source: event.source,
              sender: event.senderName ?? event.senderId ?? null,
              text: cleanText(event.text),
              timestamp: event.timestamp,
            })),
          }
        : {}),
      feedback,
      verifiedCurrentAction: currentActionContext,
      visualEvidence: {
        attached: images.length > 0,
        verifiedForDecision: visualEvidenceVerified,
        frames,
      },
    };
    const supportingMemoryContext = reflectionTrigger ? [] : memoryContext;
    const contextEnvelope = {
      ...(inputs.activationState ? { activeOperator: { mode: inputs.activationState.mode, assessedAt: inputs.activationState.assessedAt, localTime: inputs.activationState.localTime, timeZone: inputs.activationState.timeZone, operations: inputs.activationState.operations } } : {}),
      ...(outputContract === 'goal_review' ? {
        originatingInstruction: {
          content: inputs.execution?.task?.instruction ?? null,
          source: inputs.execution?.task?.source ?? null,
        },
      } : {}),
      execution: inputs.execution ?? null,
      ...(Array.isArray(inputs.observationHistory) && inputs.observationHistory.length
        ? { observationHistory: inputs.observationHistory } : {}),
      ...(availableTasks.length && !inputs.activationState ? { availableTasks } : {}),
      robotOperatorContext: {
        activePersona: personaText || null,
        ...(robotStatus
          ? {
              robotStatus: {
                provenance: 'profile_robot_status_snapshot',
                state: robotStatus,
              },
            }
          : {}),
        ...(bridgeSummary
          ? {
              environmentBridge: {
                provenance: 'environment_bridge_state',
                state: bridgeSummary,
              },
            }
          : {}),
        ...(autonomyActivityHistory.length > 0
          ? {
              recentAutonomyActivity: {
                provenance: 'work_coordinator_terminal_history',
                entries: compactActivityHistory,
                executions: activityExecutions,
              },
            }
          : {}),
        ...(recentContext.length > 0
          ? {
              correlatedTaskNarrative: taskNarrative,
              recentNarrativeContext: {
                provenance: 'canonical_conversation_history',
                evidenceStatus: 'narrative_only',
                includesUnifiedInnerContext: innerContextCount > 0,
                entries: backgroundNarrative,
              },
            }
          : {}),
        verifiedActionHistory: {
          provenance: 'canonical_robot_buffer',
          entries: actionHistory,
        },
        ...(activeDesires.length > 0
          ? {
              activeDesires: {
                provenance: 'canonical_agency_storage',
                purpose: 'Awareness only. Select Desire Agent to progress eligible work; owner_input items await the user. Do not turn these summaries into robot instructions.',
                entries: activeDesires,
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
      },
      robotStimulus: stimulus,
      ...(plannerDecision ? { plannerDecision } : {}),
      ...(reflectionTrigger
        ? {
            reflectionMaterial: {
              provenance: 'historical_memory_inspiration',
              currentEvidence: false,
              entries: memoryContext,
            },
          }
        : {}),
    };
    const envelopeText = serializeContext(contextEnvelope);
    const userContent = images.length > 0
      ? [{ type: 'text', text: `Attached robot-camera evidence is described by robotStimulus.visualEvidence.\n${envelopeText}` }, ...images]
      : envelopeText;

    return {
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: userContent },
      ],
      frames: selectedFrames,
      jsonSchema: outputContract === 'autonomy_controller'
        ? buildRobotAutonomyControllerJsonSchema(inputs.availableTasks ?? [])
        : withVisualObservationSchema(outputContract === 'delegation'
          ? ROBOT_OPERATOR_DECISION_JSON_SCHEMA : buildRobotGoalReviewJsonSchema(), selectedFrames),
      context: {
        instruction,
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
        bridgeSummaryIncluded: Boolean(bridgeSummary),
        activeDesireCount: activeDesires.length,
        availableTaskCount: availableTasks.length,
        autonomyActivityCount: autonomyActivityHistory.length,
        plannerDecisionIncluded: Boolean(plannerDecision),
        reflectionMaterialIncluded: reflectionTrigger && memoryContext.length > 0,
        imageCount: images.length,
        environmentIncluded: Boolean(observation),
        selectorInvoked: true,
      },
      stimulusReady,
      valid: true,
      error: '',
    };
}

function fixedContextNode(
  id: string,
  name: string,
  description: string,
  inputs: NodeSlot[],
  outputContract: RobotOperatorContextContract,
) {
  return defineNode({
    id,
    name,
    category: 'operator',
    inputs,
    outputs: CONTEXT_OUTPUTS,
    properties: {},
    propertySchemas: {},
    description,
    async execute(nodeInputs) {
      return buildRobotOperatorContext(nodeInputs, outputContract);
    },
  });
}

export const robotAutonomyPlannerContextNode = fixedContextNode(
  'robot_autonomy_planner_context',
  'Robot Autonomy Planner Context',
  'Builds correlated perception and narrative context for one planner that may delegate a high-level intention.',
  contextInputs(
    'instruction', 'observation', 'images', 'frames', 'conversationHistory', 'innerHistory',
    'actionHistory', 'personaText', 'memoryContext', 'robotStatus', 'robotObserver',
    'plannerDecision', 'delegatedMemories', 'actionContext', 'sourceObservationAt',
    'currentVisualEvidence',
  ),
  'delegation',
);

export const robotGoalReviewContextNode = fixedContextNode(
  'robot_goal_review_context',
  'Robot Goal Review Context',
  'Builds current objective, outcome, narrative, persona, desire, and evidence context for one goal review.',
  contextInputs(
    'instruction', 'observation', 'images', 'frames', 'conversationHistory', 'innerHistory',
    'actionHistory', 'personaText', 'robotStatus', 'activeDesires', 'robotObserver',
    'sourceObservationAt', 'currentVisualEvidence', 'availableTasks', 'autonomyActivityHistory',
  ),
  'goal_review',
);

export const robotAutonomyControllerContextNode = fixedContextNode(
  'robot_autonomy_controller_context',
  'Robot Autonomy Controller Context',
  'Builds one activation assessment package from current status, bridge facts, selected histories, persona, desires, task meanings, and prior task receipts.',
  contextInputs(
    'instruction', 'observation', 'bridgeSummary', 'images', 'frames', 'conversationHistory',
    'innerHistory', 'actionHistory', 'personaText', 'robotStatus', 'activeDesires',
    'availableTasks', 'activationState', 'autonomyActivityHistory', 'robotObserver', 'sourceObservationAt',
    'currentVisualEvidence',
  ),
  'autonomy_controller',
);
