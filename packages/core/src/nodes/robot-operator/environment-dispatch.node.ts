import { createHash, randomUUID } from 'node:crypto';

import { getOperatorMode } from '../../active-operator/mode-controller.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { submitCoordinatorWork, type AutonomyMode, type TaskInput } from '../../queue/index.js';
import {
  readBoredomMovementCycle,
  readRobotObserverCycle,
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

function currentMode(context: Record<string, unknown>): AutonomyMode {
  const override = context.operatorMode;
  return override === 'reactive' || override === 'semi' || override === 'full'
    ? override
    : getOperatorMode();
}

function triggerSource(observation: EnvironmentObservation): RobotObserverTriggerSource {
  const cycle = readRobotObserverCycle(observation);
  if (cycle) return cycle.triggerSource;
  return readBoredomMovementCycle(observation)?.triggerSource ?? 'autonomy';
}

function delegatedCycle(
  observation: EnvironmentObservation,
  source: RobotObserverTriggerSource,
  graph: string,
  maxSteps: number,
): RobotObserverCycleMetadata {
  const existing = readRobotObserverCycle(observation);
  if (existing) {
    return {
      ...existing,
      graph,
      requestedBy: 'environment-perception',
    };
  }
  const boredomMovement = readBoredomMovementCycle(observation);
  return {
    cycleId: boredomMovement?.cycleId
      || cleanText(observation.metadata?.correlationId, 200)
      || `robot-operator-${randomUUID()}`,
    step: 1,
    maxSteps: boredomMovement?.maxSteps ?? maxSteps,
    triggerSource: source,
    graph: boredomMovement?.graph ?? graph,
    requestedBy: 'environment-perception',
    ...(boredomMovement ? { observationTiming: boredomMovement.observationTiming } : {}),
  };
}

export const robotOperatorEnvironmentDispatchNode = defineNode({
  id: 'robot_operator_environment_dispatch',
  name: 'Robot Operator Environment Dispatch',
  category: 'operator',
  inputs: [
    { name: 'decision', type: 'object', optional: true, description: 'Validated Robot Operator decision' },
    { name: 'observation', type: 'object', optional: true, description: 'Original correlated robot observation' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether one Environment Mode execution was admitted' },
    { name: 'taskId', type: 'string', description: 'Work Coordinator task ID' },
    { name: 'status', type: 'string', description: 'Dispatch result' },
    { name: 'instruction', type: 'string', description: 'Delegated high-level intention' },
    { name: 'result', type: 'object', description: 'Inspectable dispatch metadata' },
  ],
  properties: {
    graph: 'environment',
    maxSteps: 8,
  },
  propertySchemas: {
    graph: {
      type: 'text',
      default: 'environment',
      label: 'Environment Execution Graph',
      description: 'Graph that decides how to execute the delegated high-level intention.',
    },
    maxSteps: {
      type: 'slider',
      default: 8,
      label: 'Maximum Environment Steps',
      min: 1,
      max: 10,
      step: 1,
    },
  },
  description: 'Admits every valid Robot Operator observation decision to one Environment Mode execution with the original correlated observation.',
  async execute(inputs, context, properties) {
    const decision = isRecord(inputs.decision)
      ? inputs.decision as unknown as RobotOperatorDecision
      : null;
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const reject = (status: string, instruction = '') => ({
      queued: false,
      taskId: '',
      status,
      instruction,
      result: { queued: false, status },
    });
    if (!decision) return reject('no_decision');
    const observed = cleanText(decision.observed, 500);
    const instruction = cleanText(decision.instruction, 1_000);
    const requiresAction = decision.requiresAction;
    const reason = cleanText(decision.reason, 500);
    if (!observed || !instruction || typeof requiresAction !== 'boolean' || !reason) {
      return reject('invalid_decision');
    }
    if (!observation?.sessionId) return reject('missing_observation_session', instruction);

    const source = triggerSource(observation);
    const mode = currentMode(context);
    const username = cleanText(context.username, 100);
    if (!username || username === 'system') return reject('missing_user_owner', instruction);
    const graph = validGraph(
      context.robotOperatorEnvironmentGraph,
      validGraph(properties?.graph, 'environment'),
    );
    if (graph === 'robot-operator') return reject('recursive_graph', instruction);
    const maxSteps = Number.isInteger(properties?.maxSteps)
      ? Math.max(1, Math.min(10, Number(properties?.maxSteps)))
      : 8;
    const cycle = delegatedCycle(observation, source, graph, maxSteps);
    const timestamp = new Date().toISOString();
    const nextObservation: EnvironmentObservation = {
      ...observation,
      timestamp,
      text: [],
      feedback: [],
      metadata: {
        ...(observation.metadata ?? {}),
        originatingInstruction: instruction,
        correlationId: cycle.cycleId,
        robotObserver: cycle,
        robotOperatorDecision: {
          observed,
          instruction,
          requiresAction,
          reason,
          decidedAt: timestamp,
        },
      },
    };
    delete nextObservation.metadata?.actionId;
    delete nextObservation.metadata?.feedbackId;
    delete nextObservation.metadata?.taskValidatorCommand;

    const hash = createHash('sha256').update(instruction).digest('hex').slice(0, 16);
    const taskInput: TaskInput = {
      type: 'environment_observation',
      handler: 'environment.observation',
      resource: 'local-llm',
      source,
      priority: source === 'user' ? 'high' : 'background',
      input: { observation: nextObservation, graph },
      username,
      cognitiveMode: 'environment',
      correlationId: cycle.cycleId,
      idempotencyKey: `robot-operator:${cycle.cycleId}:${cycle.step}:${hash}`,
      maxAttempts: 1,
      metadata: {
        producer: 'robot-operator-mode',
        sessionId: observation.sessionId,
        observed,
        decisionReason: reason,
        observationTiming: readBoredomMovementCycle(observation)?.observationTiming ?? 'before_intention',
      },
    };
    const injectedEnqueue = context.enqueueRobotOperatorEnvironment;
    const queuedTask = await (typeof injectedEnqueue === 'function'
      ? injectedEnqueue(taskInput)
      : submitCoordinatorWork(taskInput));
    const taskId = isRecord(queuedTask) && typeof queuedTask.id === 'string'
      ? queuedTask.id
      : '';
    if (!taskId) return reject('queue_rejected', instruction);

    return {
      queued: true,
      taskId,
      status: 'queued',
      instruction,
      result: {
        queued: true,
        taskId,
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
