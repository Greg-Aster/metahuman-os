import { defineNode } from '../types.js'
import { selectActivatedOperations, type ActivationAssessment } from '../../active-operator/activation.js'
import type { RobotAutonomyTaskDescriptor } from './autonomy-task-options.js'
import type { TaskInput } from '../../queue/types.js'
import { getTriggerConfigService } from '../../queue/trigger-config-service.js'
import { getOperatorMode } from '../../active-operator/mode-controller.js'
import { robotOperatorEnvironmentDispatchNode } from './environment-dispatch.node.js'

export const activeOperatorDispatchNode = defineNode({
  id: 'active_operator_dispatch', name: 'Request Activated Operations', category: 'operator',
  inputs: [
    { name: 'assessment', type: 'object' }, { name: 'availableTasks', type: 'array' },
    { name: 'observation', type: 'object', optional: true },
    { name: 'robotObserver', type: 'object', optional: true },
    { name: 'frames', type: 'array', optional: true },
    { name: 'currentVisualEvidence', type: 'boolean', optional: true },
    { name: 'observationCurrent', type: 'boolean', optional: true },
  ],
  outputs: [{ name: 'requests', type: 'array' }, { name: 'innerEntries', type: 'array' }],
  properties: {}, propertySchemas: {},
  description: 'Stages selected operations through the existing Work Coordinator. Their results remain independent of the next activation assessment.',
  async execute(inputs, context) {
    const assessment = inputs.assessment as ActivationAssessment
    const tasks = inputs.availableTasks as RobotAutonomyTaskDescriptor[]
    const requests: TaskInput[] = []
    const innerEntries: any[] = []
    // Mode transitions remain owned by Mode Controller, including Reactive admission.
    const selected = selectActivatedOperations(assessment.updates, getOperatorMode())
    for (const [index, update] of selected.entries()) {
      const task = tasks.find(candidate => candidate.id === update.operationId)!
      const config = getTriggerConfigService().load(false).config.agents[task.id]
      const cycleId = `${assessment.executionId}:${index}`
      const observationSummary = JSON.stringify({ sessionId: inputs.observation?.sessionId ?? null,
        sourceObservationAt: inputs.observation?.timestamp ?? null })
      const plannerDecision = { instruction: update.instruction, reason: update.reason,
        observed: observationSummary, decidedAt: assessment.assessedAt }
      let input: TaskInput['input'] = {
        agentId: task.id, args: [], triggeredBy: 'robot-autonomy-controller', usesLLM: true, cycleId,
        sessionId: inputs.observation?.sessionId,
        plannerDecision,
        graphContext: { taskBrief: JSON.stringify(plannerDecision) },
      }
      let innerEntry: any
      if (task.kind === 'environment-executor') {
        const prepared = await robotOperatorEnvironmentDispatchNode.execute({ ...inputs,
          decision: plannerDecision,
          robotObserver: { ...inputs.robotObserver, cycleId },
        }, context, { graph: 'environment' })
        if (!prepared.invocation) throw new Error(`Active Operator intention could not be prepared: ${prepared.status}`)
        const delegated = prepared.invocation.context
        // Preserve the complete approved model output through the existing handoff.
        delegated.robotOperatorContext.plannerDecision = plannerDecision
        input = { ...input, graph: prepared.invocation.graph, observation: delegated.environmentObservation,
          observationCurrent: delegated.environmentObservationCurrent,
          robotOperatorContext: delegated.robotOperatorContext }
        innerEntry = prepared.innerEntry
        innerEntry.content = `Intention: ${update.instruction}\n\nReason: ${update.reason}`
        innerEntry.meta.plannerDecision = plannerDecision
      } else {
        innerEntry = { role: 'reflection', timestamp: assessment.assessedAt,
          content: `Operation: ${task.name}\n\nIntention: ${update.instruction}\n\nReason: ${update.reason}`,
          meta: { source: 'autonomy', dialogueSource: 'robot-autonomy-controller', agentId: 'robot-autonomy-controller',
            executionId: assessment.executionId, cycleId, operationId: task.id, activation: update.activation,
            tags: ['autonomy', 'autonomy-intention', 'inner'], plannerDecision } }
      }
      requests.push({ type: task.taskType as TaskInput['type'], handler: task.handler,
        executionScope: 'independent', source: 'autonomy', priority: task.priority, username: context.username!, cognitiveMode: 'environment',
        resource: config?.resource, input, correlationId: cycleId,
        idempotencyKey: `active-operator:${cycleId}`, maxAttempts: Math.max(1, (config?.maxRetries ?? 0) + 1),
        metadata: { producer: 'robot-autonomy-controller', selectedAgent: task.id,
          decisionInstruction: update.instruction, decisionReason: update.reason, activation: update.activation } })
      innerEntries.push(innerEntry)
    }
    for (const request of requests) context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: request })
    return { requests, innerEntries }
  },
})
