import { createHash, randomUUID } from 'node:crypto';

import { getOperatorMode } from '../../active-operator/mode-controller.js';
import type { EnvironmentObservation } from '../../environment-interface/index.js';
import { submitCoordinatorWork, type AutonomyMode, type TaskInput } from '../../queue/index.js';
import { readRobotObserverCycle, type RobotObserverCycleMetadata } from '../../robot-operator.js';
import { defineNode } from '../types.js';
import {
  ENVIRONMENT_COMPLETION_BASES,
  type EnvironmentCompletionBasis,
  type EnvironmentContinuationPolicy,
} from './helpers.js';

export interface EnvironmentWorkflowCommand {
  kind: 'environment_workflow_command';
  objective: string;
  instruction: string;
  reason: string;
  source: RobotObserverCycleMetadata['triggerSource'];
  mode: AutonomyMode;
  graph: string;
  cycleId?: string;
  step: number;
  maxSteps: number;
  advanceCycle?: boolean;
  continuationPolicy: Extract<EnvironmentContinuationPolicy, 'bounded'>;
  requiredCompletionBasis: EnvironmentCompletionBasis;
  requireExternalCompletionEvidence?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function currentMode(context: Record<string, unknown>): AutonomyMode {
  const override = context.operatorMode;
  return override === 'reactive' || override === 'semi' || override === 'full'
    ? override
    : getOperatorMode();
}

function validGraph(value: unknown, fallback: string): string {
  const graph = cleanText(value, 80);
  return /^[a-zA-Z0-9_-]{1,80}$/.test(graph) ? graph : fallback;
}

function instructionEnvelope(command: EnvironmentWorkflowCommand): string {
  return [
    `Objective: ${cleanText(command.objective, 1_000)}`,
    `Next Environment instruction (step ${command.step + 1} of ${command.maxSteps}): ${cleanText(command.instruction, 500)}`,
  ].join('\n');
}

function cycleForCommand(
  command: EnvironmentWorkflowCommand,
  observation: EnvironmentObservation,
  graph: string,
): RobotObserverCycleMetadata {
  const existing = readRobotObserverCycle(observation);
  const nextStep = command.advanceCycle === false ? command.step : command.step + 1;
  if (existing) return { ...existing, step: nextStep };
  return {
    cycleId: cleanText(command.cycleId, 200) || `environment-validator-${randomUUID()}`,
    step: Math.max(1, Math.min(command.maxSteps, Math.floor(nextStep))),
    maxSteps: command.maxSteps,
    triggerSource: command.source,
    graph,
    requestedBy: 'environment-perception',
  };
}

function nowIso(context: Record<string, unknown>): string {
  const value = context.environmentWorkflowNow;
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

export const environmentWorkflowCommandNode = defineNode({
  id: 'environment_workflow_command',
  name: 'Environment Workflow Command',
  category: 'environment',
  inputs: [
    { name: 'command', type: 'object', optional: true, description: 'Validated command from Environment Task Validator' },
    { name: 'observation', type: 'object', optional: true, description: 'Current observation to carry into the next bounded workflow run' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether the next Environment workflow run was queued' },
    { name: 'taskId', type: 'string', description: 'Work Coordinator task ID' },
    { name: 'status', type: 'string', description: 'Queue admission status' },
    { name: 'instruction', type: 'string', description: 'Objective-preserving instruction admitted to the queue' },
    { name: 'result', type: 'object', description: 'Structured queue admission result' },
  ],
  properties: {
    graph: 'environment',
  },
  propertySchemas: {
    graph: {
      type: 'text',
      default: 'environment',
      label: 'Environment Graph',
      description: 'Environment Mode workflow queued for the validated next instruction.',
    },
  },
  description: 'Admits one validated, bounded instruction to the Work Coordinator as a separate Environment Mode run.',
  async execute(inputs, context, properties) {
    const command = isRecord(inputs.command)
      ? inputs.command as unknown as EnvironmentWorkflowCommand
      : null;
    const observation = isRecord(inputs.observation)
      ? inputs.observation as unknown as EnvironmentObservation
      : null;
    const reject = (status: string) => ({
      queued: false,
      taskId: '',
      status,
      instruction: '',
      result: { queued: false, status },
    });

    if (!command) return reject('no_command');
    if (command.kind !== 'environment_workflow_command') return reject('invalid_command');
    if (command.continuationPolicy !== 'bounded') return reject('continuation_not_authorized');
    if (
      command.requiredCompletionBasis === 'none'
      || !ENVIRONMENT_COMPLETION_BASES.includes(command.requiredCompletionBasis)
    ) return reject('invalid_completion_basis');
    if (!observation?.sessionId) return reject('missing_observation_session');
    if (command.source !== 'user' && command.source !== 'autonomy') return reject('invalid_source');
    if (!cleanText(command.objective, 1_000) || !cleanText(command.instruction, 500)) {
      return reject('invalid_instruction');
    }
    if (
      !Number.isInteger(command.step)
      || !Number.isInteger(command.maxSteps)
      || command.step < 1
      || command.maxSteps < 1
      || command.maxSteps > 10
      || command.step >= command.maxSteps
    ) return reject('step_limit');

    const mode = currentMode(context);
    const existingCycle = readRobotObserverCycle(observation);
    if (existingCycle && existingCycle.triggerSource !== command.source) return reject('source_mismatch');

    const username = cleanText(context.username, 100);
    if (!username || username === 'system') return reject('missing_user_owner');
    const graph = validGraph(command.graph, validGraph(properties?.graph, 'environment'));
    if (
      existingCycle
      && (
        existingCycle.step !== command.step
        || existingCycle.maxSteps !== command.maxSteps
        || existingCycle.graph !== graph
        || (command.cycleId && existingCycle.cycleId !== command.cycleId)
      )
    ) return reject('cycle_mismatch');
    const cycle = cycleForCommand(command, observation, graph);
    const instruction = instructionEnvelope(command);
    const timestamp = nowIso(context);
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
        taskValidatorCommand: {
          version: 3,
          objective: cleanText(command.objective, 1_000),
          instruction: cleanText(command.instruction, 500),
          reason: cleanText(command.reason, 500),
          source: command.source,
          step: cycle.step,
          maxSteps: command.maxSteps,
          continuationPolicy: command.continuationPolicy,
          requiredCompletionBasis: command.requiredCompletionBasis,
          requireExternalCompletionEvidence: command.requireExternalCompletionEvidence === true,
        },
      },
    };
    delete nextObservation.metadata?.actionId;
    delete nextObservation.metadata?.feedbackId;

    const hash = createHash('sha256').update(instruction).digest('hex').slice(0, 16);
    const taskInput: TaskInput = {
      type: 'environment_observation',
      handler: 'environment.observation',
      resource: 'local-llm',
      source: command.source,
      priority: 'high',
      input: { observation: nextObservation, graph },
      username,
      cognitiveMode: 'environment',
      correlationId: cycle.cycleId,
      idempotencyKey: `environment-validator:${cycle.cycleId}:${cycle.step}:${hash}`,
      maxAttempts: 1,
      metadata: {
        producer: 'environment-workflow-command-node',
        sessionId: observation.sessionId,
        objective: cleanText(command.objective, 1_000),
        validatorStep: cycle.step,
      },
    };
    const injectedEnqueue = context.enqueueEnvironmentWorkflow;
    const queuedTask = await (typeof injectedEnqueue === 'function'
      ? injectedEnqueue(taskInput)
      : submitCoordinatorWork(taskInput));
    const taskId = isRecord(queuedTask) && typeof queuedTask.id === 'string' ? queuedTask.id : '';
    if (!taskId) return reject('queue_rejected');

    return {
      queued: true,
      taskId,
      status: 'queued',
      instruction,
      result: {
        queued: true,
        taskId,
        mode,
        source: command.source,
        graph,
        cycleId: cycle.cycleId,
        step: cycle.step,
        maxSteps: command.maxSteps,
      },
    };
  },
});
