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
  buildEnvironmentSelectorJsonSchema,
  projectRobotStatusContext,
  projectRobotCommandDescriptions,
} from '../environment/helpers.js';
import type { NodeSlot } from '../types.js';
import { ROBOT_OPERATOR_DECISION_JSON_SCHEMA } from './decision-parser.node.js';
import { buildRobotActionResultJsonSchema } from './action-result-parser.node.js';
import { buildRobotGoalReviewJsonSchema } from './goal-review-parser.node.js';
import { buildRobotAutonomyControllerJsonSchema } from './autonomy-controller-parser.node.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function correlationId(
  observation: EnvironmentObservation | null,
  robotObserver: RobotObserverCycleMetadata | null,
): string {
  return cleanText(robotObserver?.cycleId, 200)
    || cleanText(observation?.metadata?.correlationId, 200);
}

function frameSummary(frame: EnvironmentVisualFrame): Record<string, unknown> {
  return {
    id: frame.id,
    timestamp: frame.timestamp,
    mimeType: frame.mimeType,
    width: frame.width,
    height: frame.height,
    actionId: cleanText(frame.metadata?.actionId, 200) || undefined,
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

function selectedImageParts(
  images: unknown,
  frames: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(images) || !Array.isArray(frames)) return [];
  return images.slice(0, frames.length).filter((image): image is Record<string, unknown> => (
    isRecord(image) && image.type === 'image_url'
  ));
}

function robotTrigger(
  observation: EnvironmentObservation | null,
  robotObserver: RobotObserverCycleMetadata | null,
): Record<string, unknown> {
  const metadata = isRecord(observation?.metadata) ? observation.metadata : null;
  const perceptionEvent = cleanText(metadata?.perceptionEvent, 100);
  const triggerSource = cleanText(robotObserver?.triggerSource, 40);
  const requestedBy = cleanText(robotObserver?.requestedBy, 100);
  return {
    type: perceptionEvent || (robotObserver ? 'robot_observer' : 'environment_observation'),
    source: triggerSource || null,
    requestedBy: requestedBy || null,
    correlationId: correlationId(observation, robotObserver) || null,
    cycleId: cleanText(robotObserver?.cycleId, 200) || null,
    step: typeof robotObserver?.step === 'number' ? robotObserver.step : null,
  };
}

function delegatedPlannerDecision(
  input: unknown,
): Record<string, unknown> | null {
  const value = isRecord(input) ? input : null;
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
    data: feedback.data ?? null,
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

function compactBridgeSummary(value: unknown, sessionId: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const sessions = Array.isArray(value.sessions) ? value.sessions.filter(isRecord) : [];
  const selected = sessions.find(session => cleanText(session.sessionId, 200) === sessionId)
    ?? sessions.find(session => cleanText(session.status, 40) === 'connected')
    ?? null;
  return {
    enabled: value.enabled === true,
    updatedAt: cleanText(value.updatedAt, 100) || null,
    sessionCount: typeof value.sessionCount === 'number' ? value.sessionCount : sessions.length,
    pendingCommandCount: typeof value.pendingCommandCount === 'number' ? value.pendingCommandCount : 0,
    selectedSession: selected
      ? {
          sessionId: cleanText(selected.sessionId, 200) || null,
          environmentId: cleanText(selected.environmentId, 160) || null,
          adapter: cleanText(selected.adapter, 160) || null,
          status: cleanText(selected.status, 40) || null,
          firstSeenAt: cleanText(selected.firstSeenAt, 100) || null,
          lastSeenAt: cleanText(selected.lastSeenAt, 100) || null,
        }
      : null,
  };
}

function autonomySelectorSchema(
  observation: EnvironmentObservation | null,
  robotObserver: RobotObserverCycleMetadata | null,
  routingAnalysis: Record<string, boolean>,
  currentVisionAvailable: boolean,
): Record<string, unknown> {
  return buildEnvironmentSelectorJsonSchema({
    actions: observation?.capabilities.actions ?? [],
    robotCommands: observation?.capabilities.robotCommands ?? [],
    actionRouteSelected: routingAnalysis.needsAction === true
      || (routingAnalysis.needsVision === true && !currentVisionAvailable),
    taskLifecycleSelected: routingAnalysis.needsTaskLifecycle === true,
    requireAction: routingAnalysis.needsAction === true
      || robotObserver?.requestedBy === 'boredom-movement',
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

  return [...actions.values()].filter(entry => entry.requested);
}

type RobotOperatorContextContract = 'environment' | 'delegation' | 'action_result' | 'goal_review' | 'autonomy_controller';

const CONTEXT_OUTPUTS: NodeSlot[] = [
  { name: 'messages', type: 'array', description: 'Multimodal messages for this workflow LLM' },
  { name: 'jsonSchema', type: 'object', description: 'Structured output contract for this workflow LLM' },
  { name: 'context', type: 'object', description: 'Inspectable context summary' },
  { name: 'stimulusReady', type: 'boolean', description: 'Whether correlated image or action-result evidence is available' },
  { name: 'valid', type: 'boolean', description: 'Whether context construction succeeded' },
  { name: 'error', type: 'string', description: 'Visible input error' },
];

const COMMON_CONTEXT_INPUTS: Record<string, NodeSlot> = {
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
  availableTasks: { name: 'availableTasks', type: 'array', optional: true, description: 'Catalog-backed finite tasks available to the Full-mode controller' },
  autonomyActivityHistory: { name: 'autonomyActivityHistory', type: 'array', optional: true, description: 'Terminal receipts selected by Recent Autonomy Activity' },
  robotObserver: { name: 'robotObserver', type: 'object', optional: true, description: 'Current Robot Operator cycle' },
  plannerDecision: { name: 'plannerDecision', type: 'object', optional: true, description: 'Planner-authored intention delegated to Robot Autonomy Executor' },
  delegatedMemories: { name: 'delegatedMemories', type: 'array', optional: true, description: 'Historical memories delegated with a planner intention' },
  actionContext: { name: 'actionContext', type: 'object', optional: true, description: 'Work Coordinator action record matched to the returned robot report' },
  sourceObservationAt: { name: 'sourceObservationAt', type: 'string', optional: true, description: 'Timestamp of the bridge observation that started this cycle' },
  currentVisualEvidence: { name: 'currentVisualEvidence', type: 'boolean', optional: true, description: 'Whether Environment Image Input verified the attached frame for this decision' },
  stimulusInstruction: { name: 'stimulusInstruction', type: 'string', optional: true, description: 'High-level intention delegated to Robot Autonomy Executor' },
  routingAnalysis: { name: 'routingAnalysis', type: 'object', description: 'Intent Orchestrator route switches for the delegated intention' },
};

function contextInputs(...names: string[]): NodeSlot[] {
  return ['execution', ...names].map(name => COMMON_CONTEXT_INPUTS[name]);
}

async function buildRobotOperatorContext(
  inputs: Record<string, any>,
  outputContract: RobotOperatorContextContract,
) {
    const suppliedObservation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const instruction = cleanText(inputs.instruction, 8_000);
    const stimulusInstruction = cleanText(inputs.stimulusInstruction, 4_000);
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

    const routingAnalysis = isRecord(inputs.routingAnalysis)
      ? Object.fromEntries(Object.entries(inputs.routingAnalysis).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>
      : null;
    if (outputContract === 'environment' && !routingAnalysis) {
      return invalid('Robot Autonomy context requires Intent Orchestrator route switches.');
    }
    const environmentSelected = outputContract !== 'environment'
      || routingAnalysis?.needsEnvironment === true
      || routingAnalysis?.needsVision === true
      || routingAnalysis?.needsAction === true;
    const observation = environmentSelected ? suppliedObservation : null;
    if (environmentSelected && outputContract !== 'autonomy_controller' && !observation?.sessionId) {
      return invalid('Robot Operator context requires a robot observation with a session ID for the selected route.');
    }

    const conversationSelected = outputContract !== 'environment'
      || routingAnalysis?.needsConversationHistory === true;
    const memorySelected = outputContract !== 'environment'
      || routingAnalysis?.needsMemory === true;
    const robotStatusSelected = outputContract !== 'environment'
      || routingAnalysis?.needsRobotStatus === true;
    const actionHistorySelected = outputContract !== 'environment'
      || routingAnalysis?.needsAction === true;
    const visionSelected = outputContract !== 'environment'
      || routingAnalysis?.needsVision === true;

    const innerContext = conversationSelected
      ? consolidatedInnerHistory(inputs.innerHistory)
      : [];
    const availableConversation = (conversationSelected
      ? consolidatedHistory(inputs.conversationHistory)
      : [])
      .filter(entry => innerContext.length === 0 || !(
        isRecord(entry.context) && entry.context.isInnerDialogue === true
      ));
    const recentContext = [...availableConversation, ...innerContext];
    const allActionHistory = actionHistorySelected ? verifiedActionHistory(inputs.actionHistory) : [];
    const innerContextCount = recentContext.filter(entry => (
      isRecord(entry.context) && entry.context.isInnerDialogue === true
    )).length;
    const personaText = typeof inputs.personaText === 'string'
      ? inputs.personaText.trim().slice(0, 12_000)
      : '';
    const suppliedMemories = memorySelected && Array.isArray(inputs.memoryContext)
      ? inputs.memoryContext
      : [];
    const delegatedMemories = Array.isArray(inputs.delegatedMemories)
      ? inputs.delegatedMemories
      : [];
    const seenMemories = new Set<string>();
    const memoryContext = [...suppliedMemories, ...delegatedMemories].flatMap(memory => {
      const key = typeof memory === 'string'
        ? cleanText(memory, 4_000)
        : isRecord(memory)
          ? cleanText(memory.content, 4_000)
          : '';
      if (!key || seenMemories.has(key)) return [];
      seenMemories.add(key);
      return [memory];
    }).slice(0, 5);
    const images = visionSelected && inputs.currentVisualEvidence === true
      ? selectedImageParts(inputs.images, inputs.frames)
      : [];
    const frames = (visionSelected && Array.isArray(inputs.frames) ? inputs.frames : [])
      .filter((frame): frame is EnvironmentVisualFrame => isRecord(frame))
      .map(frameSummary);
    const trigger = robotTrigger(observation, robotObserver);
    const plannerDecision = delegatedPlannerDecision(inputs.plannerDecision);
    const cycleId = cleanText(trigger.cycleId, 200);
    const latestActionContext = isRecord(inputs.actionContext)
      ? inputs.actionContext
      : null;
    const reportedActionId = cleanText(observation?.metadata?.actionId, 200);
    const currentActionContext = latestActionContext
      && reportedActionId
      && cleanText(latestActionContext.actionId, 200) === reportedActionId
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
      ? latestActionContext
      : null;
    const projectedRobotStatus = robotStatusSelected && isRecord(inputs.robotStatus)
      ? projectRobotStatusContext(inputs.robotStatus)
      : null;
    const robotStatus = projectedRobotStatus
      && (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      ? Object.fromEntries(Object.entries(projectedRobotStatus).filter(([key]) => key !== 'agency'))
      : projectedRobotStatus;
    const bridgeSummary = outputContract === 'autonomy_controller'
      ? compactBridgeSummary(inputs.bridgeSummary, cleanText(observation?.sessionId, 200))
      : null;
    const activeDesires = (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      && Array.isArray(inputs.activeDesires)
      ? inputs.activeDesires
      : [];
    const availableTasks = (outputContract === 'autonomy_controller' || outputContract === 'goal_review') && Array.isArray(inputs.availableTasks)
      ? inputs.availableTasks.filter(isRecord).map(({ id, name, description, kind }) => ({ id, name, description, kind }))
      : [];
    const autonomyActivityHistory = (outputContract === 'autonomy_controller' || outputContract === 'goal_review')
      && Array.isArray(inputs.autonomyActivityHistory)
      ? inputs.autonomyActivityHistory.filter(isRecord)
      : [];
    const taskNarrative = recentContext.filter(entry => (
      isRecord(entry.context) && cleanText(entry.context.correlationId, 200) === cycleId
    ));
    const backgroundNarrative = recentContext.filter(entry => !taskNarrative.includes(entry));
    const reflectionTrigger = trigger.requestedBy === 'boredom-reflection';
    const feedback = currentActionId && observation
      ? compactFeedback(observation).filter(item => item.actionId === currentActionId)
      : [];
    const visualEvidenceVerified = images.length > 0 && inputs.currentVisualEvidence === true;
    const stimulusReady = visualEvidenceVerified || feedback.length > 0;
    const robotCommandDescriptions = outputContract === 'environment' && observation
      ? projectRobotCommandDescriptions(observation.capabilities)
      : {};
    const baseCapabilities = observation
      ? Object.fromEntries(Object.entries(observation.capabilities).filter(([key]) => key !== 'robotCommandDescriptions'))
      : null;
    const stimulus = {
      trigger,
      ...(observation
        ? {
            observedAt: observation.timestamp,
            stateObservedAt: cleanText(inputs.sourceObservationAt, 100) || observation.timestamp,
            state: observation.state ?? null,
            location: observation.location ?? null,
            map: observation.map ?? null,
            capabilities: {
              ...baseCapabilities,
              ...(Object.keys(robotCommandDescriptions).length > 0
                ? { robotCommandDescriptions }
                : {}),
            },
            text: (observation.text ?? []).slice(-8).map(event => ({
              source: event.source,
              sender: event.senderName ?? event.senderId ?? null,
              text: cleanText(event.text, 2_000),
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
      execution: inputs.execution ?? null,
      ...(availableTasks.length ? { availableTasks } : {}),
      robotOperatorContext: {
        activePersona: personaText || null,
        ...(routingAnalysis ? { selectedRoutes: routingAnalysis } : {}),
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
                entries: autonomyActivityHistory,
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
        ...(actionHistorySelected
          ? {
              verifiedActionHistory: {
                provenance: 'canonical_robot_buffer',
                entries: actionHistory,
              },
            }
          : {}),
        ...(activeDesires.length > 0
          ? {
              activeDesires: {
                provenance: 'canonical_agency_storage',
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
    };
    const envelopeText = JSON.stringify(contextEnvelope);
    const userContent = images.length > 0
      ? [{ type: 'text', text: `Attached robot-camera evidence is described by robotStimulus.visualEvidence.\n${envelopeText}` }, ...images]
      : envelopeText;

    return {
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: userContent },
      ],
      jsonSchema: outputContract === 'delegation'
        ? ROBOT_OPERATOR_DECISION_JSON_SCHEMA
        : outputContract === 'action_result'
          ? buildRobotActionResultJsonSchema(inputs.execution)
          : outputContract === 'goal_review'
            ? buildRobotGoalReviewJsonSchema(inputs.availableTasks)
            : outputContract === 'autonomy_controller'
              ? buildRobotAutonomyControllerJsonSchema(inputs.availableTasks)
            : autonomySelectorSchema(
                observation,
                robotObserver,
                routingAnalysis ?? {},
                visualEvidenceVerified,
              ),
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
        bridgeSummaryIncluded: Boolean(bridgeSummary),
        activeDesireCount: activeDesires.length,
        availableTaskCount: availableTasks.length,
        autonomyActivityCount: autonomyActivityHistory.length,
        plannerDecisionIncluded: Boolean(plannerDecision),
        reflectionMaterialIncluded: reflectionTrigger && memoryContext.length > 0,
        imageCount: images.length,
        routingAnalysis,
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

export const robotAutonomyExecutorContextNode = fixedContextNode(
  'robot_autonomy_executor_context',
  'Robot Autonomy Executor Context',
  'Builds the routed context and capability-bounded action contract for one delegated physical or sensing intention.',
  contextInputs(
    'instruction', 'stimulusInstruction', 'routingAnalysis', 'observation', 'images', 'frames',
    'conversationHistory', 'innerHistory', 'actionHistory', 'personaText', 'memoryContext',
    'robotStatus', 'robotObserver', 'plannerDecision', 'delegatedMemories', 'actionContext',
    'sourceObservationAt', 'currentVisualEvidence',
  ),
  'environment',
);

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

export const robotActionResultContextNode = fixedContextNode(
  'robot_action_result_context',
  'Robot Action Result Context',
  'Builds the evidence package for interpreting one correlated terminal robot action report.',
  contextInputs(
    'instruction', 'observation', 'images', 'frames', 'robotStatus', 'robotObserver',
    'actionContext', 'sourceObservationAt', 'currentVisualEvidence',
  ),
  'action_result',
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
  'Builds one Full-mode decision package from current status, bridge facts, selected histories, persona, desires, task meanings, and prior task receipts.',
  contextInputs(
    'instruction', 'observation', 'bridgeSummary', 'images', 'frames', 'conversationHistory',
    'innerHistory', 'actionHistory', 'personaText', 'robotStatus', 'activeDesires',
    'availableTasks', 'autonomyActivityHistory', 'robotObserver', 'sourceObservationAt',
    'currentVisualEvidence',
  ),
  'autonomy_controller',
);
