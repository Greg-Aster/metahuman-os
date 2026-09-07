import { getAgentCatalogSnapshot } from '../../agent-catalog.js'
import { agentTaskType } from '../../queue/agent-work-catalog.js'
import { getTriggerConfigService } from '../../queue/trigger-config-service.js'
import type { TaskInput } from '../../queue/types.js'
import { loadRobotOperatorConfig, parseRobotObserverCycle, robotOperatorChildGraph, type RobotOperatorStimulusAgent } from '../../robot-operator.js'
import { defineNode } from '../types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

export const robotAutonomyTaskDispatchNode = defineNode({
  id: 'robot_autonomy_task_dispatch',
  name: 'Start Selected Autonomy Task',
  category: 'operator',
  inputs: [
    { name: 'decision', type: 'object', description: 'Validated Agent Catalog task selected by the controller' },
    { name: 'robotObserver', type: 'object', description: 'Robot Operator cycle that owns this Full-mode decision' },
    { name: 'sessionId', type: 'string', optional: true, description: 'Current Environment Bridge session, when available' },
    { name: 'observation', type: 'object', optional: true, description: 'Bridge evidence already loaded by this workflow' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether the selected task was admitted' },
    { name: 'taskId', type: 'string', description: 'Work Coordinator task ID' },
    { name: 'selectedTaskId', type: 'string', description: 'Selected Agent Catalog task ID' },
    { name: 'status', type: 'string', description: 'Dispatch result' },
    { name: 'invocation', type: 'object', description: 'Selected editable Robot Operator child workflow' },
    { name: 'work', type: 'object', description: 'Checkpointed finite-agent dispatch to await' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Submits the one catalog-backed finite task selected by the LLM through the existing Work Coordinator handler. It does not choose a task or run an agent directly.',
  async execute(inputs, context) {
    const decision = isRecord(inputs.decision) ? inputs.decision : null
    const selected = isRecord(decision?.task) ? decision.task : null
    const selectedTaskId = cleanText(selected?.id, 100)
    const reason = cleanText(decision?.reason, 500)
    const observationSummary = cleanText(decision?.observationSummary, 500)
    const instruction = cleanText(decision?.instruction, 1_000)
    const reject = (status: string) => ({ queued: false, taskId: '', selectedTaskId, status, invocation: null, work: null })
    if (!selectedTaskId) return reject('no_decision')
    if (!reason || !observationSummary || selected?.kind !== 'agent') return reject('invalid_decision')

    const currentAgent = getAgentCatalogSnapshot().agents.find(agent => agent.id === selectedTaskId)
    if (!currentAgent || currentAgent.lifecycle === 'service' || !currentAgent.canRun) {
      return reject('task_unavailable')
    }
    if (cleanText(selected.handler, 160) !== currentAgent.handler) {
      return reject('catalog_changed')
    }

    const username = cleanText(context.username, 100)
    if (!username || username === 'system') return reject('missing_user_owner')
    const robotObserver = parseRobotObserverCycle(inputs.robotObserver)
    if (!robotObserver || robotObserver.requestedBy !== 'robot-autonomy-controller') {
      return reject('missing_controller_cycle')
    }

    const triggerConfig = getTriggerConfigService().load(false).config.agents[selectedTaskId]
    const taskType = agentTaskType(selectedTaskId)
    const cycleId = robotObserver.cycleId
    const sessionId = cleanText(inputs.sessionId, 200)
    if (currentAgent.owner === 'robot-operator') {
      const graph = robotOperatorChildGraph(loadRobotOperatorConfig(), selectedTaskId as RobotOperatorStimulusAgent)
      return {
        queued: false, taskId: '', selectedTaskId, status: 'prepared', work: null,
        invocation: { graph, context: {
          userMessage: '', environmentObservation: inputs.observation,
          robotOperatorContext: {
            ...context.robotOperatorContext, robotObserver: { ...robotObserver, graph, requestedBy: selectedTaskId },
            stimulusAgent: selectedTaskId, sessionId,
            controllerDecision: { instruction, reason, observationSummary },
          },
        } },
      }
    }
    const taskInput: TaskInput = {
      type: taskType,
      handler: currentAgent.handler,
      resource: triggerConfig?.resource,
      source: 'autonomy',
      priority: currentAgent.priority,
      username,
      input: {
        agentId: selectedTaskId,
        args: [],
        triggeredBy: 'robot-autonomy-controller',
        usesLLM: currentAgent.usesLLM,
        cycleId,
        ...(sessionId ? { sessionId } : {}),
        robotOperatorContext: {
          robotObserver,
          controllerDecision: {
            ...(instruction ? { instruction } : {}),
            reason,
            observationSummary,
          },
        },
      },
      correlationId: cycleId,
      idempotencyKey: `robot-autonomy-controller:${cycleId}:${selectedTaskId}`,
      maxAttempts: Math.max(1, (triggerConfig?.maxRetries ?? 0) + 1),
      metadata: {
        producer: 'robot-autonomy-controller',
        selectedAgent: selectedTaskId,
        ...(instruction ? { decisionInstruction: instruction } : {}),
        decisionReason: reason,
        observationSummary,
      },
    }
    if (!context.graphExecution) throw new Error('Autonomy dispatch requires durable execution')
    const work = context.graphExecution.dispatch({ kind: 'coordinator_work', payload: taskInput })
    return { queued: false, taskId: '', selectedTaskId, status: 'staged', work, invocation: null }
  },
})
