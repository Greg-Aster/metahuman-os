import { randomUUID } from 'node:crypto';

import { getOperatorMode } from '../../active-operator/mode-controller.js';
import {
  sanitizeEnvironmentBridgeObservation,
  type EnvironmentObservation,
    type EnvironmentVisualFrame,
} from '../../environment-interface/index.js';
import type { AutonomyMode } from '../../queue/types.js';
import {
  parseRobotObserverCycle,
  type RobotObserverCycleMetadata,
  type RobotObserverTriggerSource,
} from '../../robot-operator.js';
import { defineNode } from '../types.js';
import {
  type RobotOperatorDecision,
} from './decision-parser.node.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function validGraph(value: unknown, fallback: string): string {
  const graph = cleanText(value, 80);
  return /^[a-zA-Z0-9_-]{1,80}$/.test(graph) ? graph : fallback;
}

function sampledMemoryContent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(memory => (
    typeof memory === 'string'
      ? cleanText(memory, 800)
      : isRecord(memory)
        ? cleanText(memory.content, 800)
        : ''
  )).filter(Boolean))].slice(0, 3);
}

function currentMode(context: Record<string, unknown>): AutonomyMode {
  const override = context.operatorMode;
  return override === 'reactive' || override === 'semi' || override === 'full'
    ? override
    : getOperatorMode();
}

function triggerSource(robotObserver: RobotObserverCycleMetadata | null): RobotObserverTriggerSource {
  return robotObserver?.triggerSource ?? 'autonomy';
}

function delegatedCycle(
  observation: EnvironmentObservation,
  robotObserver: RobotObserverCycleMetadata | null,
  source: RobotObserverTriggerSource,
  graph: string,
): RobotObserverCycleMetadata {
  if (robotObserver) {
    return {
      ...robotObserver,
      graph,
    };
  }
  return {
    cycleId: cleanText(observation.metadata?.correlationId, 200)
      || `robot-operator-${randomUUID()}`,
    step: 1,
    triggerSource: source,
    graph,
    requestedBy: 'environment-perception',
  };
}

export const robotOperatorEnvironmentDispatchNode = defineNode({
  id: 'robot_operator_environment_dispatch',
  name: 'Robot Operator Environment Dispatch',
  category: 'operator',
  inputs: [
    { name: 'decision', type: 'object', description: 'Validated boredom-planner decision' },
    { name: 'memories', type: 'array', optional: true, description: 'Sampled historical inspiration delegated once to Environment Mode' },
    { name: 'observation', type: 'object', description: 'Original correlated robot observation' },
    { name: 'observationCurrent', type: 'boolean', optional: true, description: 'Current-run attribution from the observation input' },
    { name: 'frames', type: 'array', optional: true, description: 'Exact camera frames supplied to the planner' },
    { name: 'currentVisualEvidence', type: 'boolean', optional: true, description: 'Camera evidence attribution from the image selector' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Robot Operator cycle supplied by Robot Operator Input' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether one Environment Mode execution was admitted' },
    { name: 'taskId', type: 'string', description: 'Work Coordinator task ID' },
    { name: 'status', type: 'string', description: 'Dispatch result' },
    { name: 'instruction', type: 'string', description: 'Delegated high-level intention' },
    { name: 'result', type: 'object', description: 'Inspectable dispatch metadata' },
    { name: 'invocation', type: 'object', description: 'Selected child workflow and its unchanged intention/evidence inputs' },
    { name: 'innerEntry', type: 'message', description: 'Planner intention and stated reason with autonomy provenance for Inner Dialogue output' },
  ],
  properties: {
    graph: 'environment',
  },
  propertySchemas: {
    graph: {
      type: 'text',
      default: 'environment',
      label: 'Autonomy Execution Graph',
      description: 'Graph that decides how to execute the delegated high-level intention.',
    },
  },
  description: 'Prepares the planner-authored intention and evidence for Run Child Workflow. It does not enqueue a separate execution.',
  async execute(inputs, context, properties) {
    const decision = isRecord(inputs.decision)
      ? inputs.decision as unknown as RobotOperatorDecision
      : null;
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver);
    const reject = (status: string, instruction = '') => ({
      queued: false,
      taskId: '',
      status,
      instruction,
      result: { queued: false, status },
      invocation: null,
      innerEntry: null,
    });
    if (!decision) return reject('no_decision');
    const observed = cleanText(decision.observed, 500);
    const instruction = cleanText(decision.instruction, 1_000);
    const reason = cleanText(decision.reason, 500);
    if (!observed || !instruction || !reason) {
      return reject('invalid_decision');
    }
    if (!observation?.sessionId) return reject('missing_observation_session', instruction);

    const source = triggerSource(robotObserver);
    const mode = currentMode(context);
    const username = cleanText(context.username, 100);
    if (!username || username === 'system') return reject('missing_user_owner', instruction);
    const graph = validGraph(
      context.robotOperatorEnvironmentGraph,
      validGraph(properties?.graph, 'environment'),
    );
    const cycle = delegatedCycle(observation, robotObserver, source, graph);
    const timestamp = new Date().toISOString();
    const delegatedMemories = sampledMemoryContent(inputs.memories);
    const frames = inputs.frames as EnvironmentVisualFrame[] | undefined;
    const nextObservation: EnvironmentObservation = sanitizeEnvironmentBridgeObservation({
      ...observation,
      ...(frames ? { visual: frames.at(-1), visuals: frames } : {}),
      feedback: observation.feedback ?? [],
      metadata: { ...(observation.metadata ?? {}), correlationId: cycle.cycleId },
    });
    const invocation = {
      graph,
      context: {
        environmentObservation: nextObservation,
        environmentObservationCurrent: inputs.observationCurrent === true,
        userMessage: '',
        userMessageEntry: undefined,
        bodyEventDecision: undefined,
        robotOperatorContext: {
          robotObserver: cycle,
          sourceObservationAt: observation.timestamp,
          currentVisualEvidence: inputs.currentVisualEvidence === true,
          sessionId: observation.sessionId,
          plannerDecision: {
            observed,
            instruction,
            reason,
            decidedAt: timestamp,
          },
          ...(delegatedMemories.length > 0 ? { memories: delegatedMemories } : {}),
        },
      },
    };

    return {
      queued: false,
      taskId: '',
      status: 'prepared',
      instruction,
      invocation,
      innerEntry: {
        role: 'reflection',
        content: `Intention: ${instruction}\n\nReason: ${reason}\n\nObservation: ${observed}`,
        timestamp: timestamp,
        meta: {
          source: 'autonomy',
          dialogueSource: cycle.requestedBy,
          tags: ['autonomy', 'autonomy-intention', 'inner', cycle.requestedBy],
          agentId: cycle.requestedBy,
          triggerSource: source,
          cognitiveMode: context.cognitiveMode ?? 'environment',
          sessionId: observation.sessionId,
          executionId: context.graphExecution?.executionId,
          correlationId: cycle.cycleId,
          cycleId: cycle.cycleId,
          step: cycle.step,
          targetGraph: graph,
          sourceObservationAt: observation.timestamp,
          plannerDecision: invocation.context.robotOperatorContext.plannerDecision,
        },
      },
      result: {
        prepared: true,
        graph,
        source,
        mode,
        observed,
        cycleId: cycle.cycleId,
        step: cycle.step,
      },
    };
  },
});
