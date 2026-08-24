import { createHash, randomUUID } from 'node:crypto';

import { getOperatorMode } from '../../active-operator/mode-controller.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { submitCoordinatorWork, type AutonomyMode, type TaskInput } from '../../queue/index.js';
import {
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

function lifecycleContract(
  instruction: string,
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const continuationPolicy = properties?.continuationPolicy;
  const requiredCompletionBasis = properties?.requiredCompletionBasis;
  if (
    (continuationPolicy !== 'none' && continuationPolicy !== 'bounded')
    || !['response', 'action_result', 'visual_observation', 'environment_state', 'user_input']
      .includes(String(requiredCompletionBasis))
  ) return null;
  const visualEvidenceMode = properties?.visualEvidenceMode;
  return {
    objective: instruction,
    continuationPolicy,
    requiredCompletionBasis,
    ...(requiredCompletionBasis === 'visual_observation'
      && (visualEvidenceMode === 'single' || visualEvidenceMode === 'comparison')
      ? { visualEvidenceMode }
      : {}),
  };
}

function currentMode(context: Record<string, unknown>): AutonomyMode {
  const override = context.operatorMode;
  return override === 'reactive' || override === 'semi' || override === 'full'
    ? override
    : getOperatorMode();
}

function triggerSource(observation: EnvironmentObservation): RobotObserverTriggerSource {
  return readRobotObserverCycle(observation)?.triggerSource ?? 'autonomy';
}

function delegatedCycle(
  observation: EnvironmentObservation,
  source: RobotObserverTriggerSource,
  graph: string,
): RobotObserverCycleMetadata {
  const existing = readRobotObserverCycle(observation);
  if (existing) {
    return {
      ...existing,
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
    { name: 'decision', type: 'object', optional: true, description: 'Validated Robot Operator decision' },
    { name: 'instruction', type: 'string', optional: true, description: 'Graph-authored autonomy instruction that needs no preliminary LLM decision' },
    { name: 'memories', type: 'array', optional: true, description: 'Sampled historical inspiration delegated once to Environment Mode' },
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
    requireAction: false,
    continuationPolicy: 'selector',
    requiredCompletionBasis: 'selector',
    visualEvidenceMode: 'single',
  },
  propertySchemas: {
    graph: {
      type: 'text',
      default: 'environment',
      label: 'Environment Execution Graph',
      description: 'Graph that decides how to execute the delegated high-level intention.',
    },
    requireAction: {
      type: 'toggle',
      default: false,
      label: 'Require Environment Action',
      description: 'Treat a direct graph instruction as an action-required autonomy trigger.',
    },
    continuationPolicy: {
      type: 'select',
      default: 'selector',
      label: 'Continuation Contract',
      options: ['selector', 'none', 'bounded'],
      description: 'Optionally fixes the lifecycle policy supplied to Environment Task State.',
    },
    requiredCompletionBasis: {
      type: 'select',
      default: 'selector',
      label: 'Completion Evidence',
      options: ['selector', 'response', 'action_result', 'visual_observation', 'environment_state', 'user_input'],
      description: 'Optionally fixes the whole-objective evidence required by Environment Task State.',
    },
    visualEvidenceMode: {
      type: 'select',
      default: 'single',
      label: 'Visual Evidence Mode',
      options: ['single', 'comparison'],
      description: 'Whether a visual contract needs one fresh view or a before-and-after comparison.',
    },
  },
  description: 'Delegates one autonomy instruction and optional historical inspiration to the configured execution graph; the trigger may require a physical action.',
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
    const directInstruction = cleanText(inputs.instruction, 1_000);
    const directTrigger = !decision && Boolean(directInstruction);
    if (!decision && !directTrigger) return reject('no_decision');
    const observed = decision
      ? cleanText(decision.observed, 500)
      : 'A bounded autonomous opportunity is available.';
    const instruction = decision
      ? cleanText(decision.instruction, 1_000)
      : directInstruction;
    const requiresAction = decision ? decision.requiresAction : properties?.requireAction === true;
    const reason = decision
      ? cleanText(decision.reason, 500)
      : 'The trigger delegates one outcome choice to Environment Mode.';
    if (!observed || !instruction || typeof requiresAction !== 'boolean' || !reason) {
      return reject('invalid_decision');
    }
    if (decision && !requiresAction) return reject('observation_only', instruction);
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
    const cycle = delegatedCycle(observation, source, graph);
    const timestamp = new Date().toISOString();
    const delegatedLifecycle = lifecycleContract(instruction, properties);
    const delegatedMemories = sampledMemoryContent(inputs.memories);
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
          ...(delegatedLifecycle ? { lifecycleContract: delegatedLifecycle } : {}),
        },
        ...(delegatedMemories.length > 0
          ? { robotOperatorMemories: delegatedMemories }
          : {}),
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
