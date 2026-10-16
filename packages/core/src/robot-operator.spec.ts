import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from './agent-catalog-definitions.js'
import { ROOT } from './path-builder.js'
import {
  beginEnvironmentPerceptionCycle,
  isRobotStatusEnabled,
  isBoredomObserverEnabled,
  isBoredomReflectionEnabled,
  isBoredomMovementEnabled,
  nextRobotObserverCycle,
  isRobotAutonomyWorkItem,
  readRobotObserverCycle,
  robotObserverSourceAllowed,
  robotOperatorChildGraph,
  loadRobotOperatorConfig,
} from './robot-operator.js'
import { summarizeRobotAutonomyActivity } from './nodes/robot-operator/autonomy-activity-history.node.js'
import { environmentSendActionNode } from './nodes/environment/send-action.node.js'
import { environmentActionParserNode } from './nodes/environment/action-parser.node.js'
import { robotOperatorInputNode } from './nodes/robot-operator/input.node.js'
import { sanitizeEnvironmentBridgeObservation } from './environment-interface/index.js'
import { buildAgentDescriptor } from './agent-monitor-descriptors.js'
import { getAgentCatalogSnapshot } from './agent-catalog.js'
import { buildRobotOperatorManualTaskInput } from './queue/queue-system.js'
import { summarizeEnvironmentGraphEffect } from './queue/execution-engine.js'

test('manual observer cycles remain available while autonomous cycles require semi or full', () => {
  assert.equal(robotObserverSourceAllowed('reactive', 'user'), true)
  assert.equal(robotObserverSourceAllowed('reactive', 'autonomy'), false)
  assert.equal(robotObserverSourceAllowed('semi', 'autonomy'), true)
  assert.equal(robotObserverSourceAllowed('full', 'autonomy'), true)
})

test('full autonomy admits the controller instead of rotating child workflows', () => {
  const serviceSource = fs.readFileSync(path.join(ROOT, 'brain/agents/active-operator/index.ts'), 'utf8')
  assert.match(serviceSource, /CONTROLLER[^\n]+robot-autonomy-controller/)
  assert.match(serviceSource, /activeRobotExecutions/)
  assert.doesNotMatch(serviceSource, /armSemiChild|randomizedChildIdleMs|RETRY_DELAY_MS/)
  assert.doesNotMatch(serviceSource, /nextRobotOperatorFullChild|fullCursor|FULL_CYCLE_POLL_MS|nextFullRobotOperatorChild|loadRobotStatus/)
})

test('robot autonomy activity follows the canonical correlated work chain', () => {
  const child = {
    id: 'child-1',
    handler: 'workflow.boredom-observer',
    state: 'queued',
    input: {},
  } as any
  const controller = {
    id: 'controller-1',
    handler: 'workflow.robot-autonomy-controller',
    state: 'leased',
    correlationId: 'cycle-2',
    input: {},
  } as any
  const selectedAgent = {
    id: 'reflection-1',
    handler: 'agent.reflector',
    state: 'queued',
    correlationId: 'cycle-2',
    input: { robotOperatorContext: { robotObserver: { cycleId: 'cycle-2' } } },
  } as any
  const observation = {
    id: 'observation-1',
    handler: 'environment.observation',
    state: 'leased',
    input: { observation: { metadata: { robotObserver: { cycleId: 'cycle-1' } } } },
  } as any
  const command = {
    id: 'command-1',
    handler: 'environment.command',
    state: 'waiting',
    input: { metadata: { robotObserver: { cycleId: 'cycle-1' } } },
  } as any
  const returnedResult = {
    id: 'result-1',
    handler: 'environment.observation',
    state: 'queued',
    input: { actionContext: { robotObserver: { cycleId: 'cycle-1' } } },
  } as any
  const unrelated = {
    id: 'chat-1',
    handler: 'chat.persona',
    state: 'queued',
    input: {},
  } as any
  assert.equal(isRobotAutonomyWorkItem(child), true)
  assert.equal(isRobotAutonomyWorkItem(controller), true)
  assert.equal(isRobotAutonomyWorkItem(selectedAgent), true)
  assert.equal(isRobotAutonomyWorkItem(observation), true)
  assert.equal(isRobotAutonomyWorkItem(command), true)
  assert.equal(isRobotAutonomyWorkItem(returnedResult), true)
  assert.equal(isRobotAutonomyWorkItem(unrelated), false)

})

test('Environment graph receipts distinguish queued work from physical completion', () => {
  const graphState = {
    status: 'completed',
    startTime: 0,
    nodes: new Map([
      ['bridge-out', {
        nodeId: 'bridge-out',
        status: 'completed',
        definition: { type: 'environment_send_action' },
        outputs: {
          status: 'coordinated_for_adapter',
          reason: '',
          count: 1,
          rejectedCount: 0,
          commands: [{
            id: 'command-1',
            type: 'robotCommand',
            command: 'turn-right',
            status: 'pending',
          }],
        },
      }],
      ['status-out', {
        nodeId: 'status-out',
        status: 'completed',
        definition: { type: 'robot_status_out' },
        outputs: { persisted: true },
      }],
    ]),
  } as any

  const effect = summarizeEnvironmentGraphEffect(graphState)
  assert.deepEqual((effect.actionQueue as any).commands, [{
    id: 'command-1',
    type: 'robotCommand',
    command: 'turn-right',
    status: 'pending',
  }])
  assert.equal((effect.actionQueue as any).queuedCount, 1)
  assert.equal(effect.robotStatusPersisted, true)
  assert.equal('physicalActionCompleted' in effect, false)
})

test('active task summaries report successful and failed objectives from the execution owner', () => {
  for (const completed of [true, false]) {
    const taskDecision = { objective: 'Execute the requested program.', objectiveComplete: completed,
      outcome: completed ? 'complete' : 'failed', reason: completed ? 'All phases completed.' : 'The body reported failure.' }
    const graphState = { nodes: new Map([['active', { status: 'completed',
      definition: { type: 'environment_active_task' }, outputs: { finished: true, completed, taskDecision } }]]) } as any
    assert.deepEqual(summarizeEnvironmentGraphEffect(graphState).objectiveEvaluation, taskDecision)
  }
})

test('Autonomy activity retains a controller no-task decision without inventing downstream work', () => {
  const receipts = summarizeRobotAutonomyActivity([{
    id: 'controller-none',
    handler: 'workflow.robot-autonomy-controller',
    state: 'completed',
    source: 'autonomy',
    username: 'owner',
    createdAt: '2026-09-05T00:02:00.000Z',
    completedAt: '2026-09-05T00:02:01.000Z',
    correlationId: 'cycle-none',
    input: { agentId: 'robot-autonomy-controller' },
    result: {
      decision: {
        taskId: 'none',
        reason: 'No available task is useful in the current context.',
        observationSummary: 'No objective or new stimulus is present.',
        responseAuthored: false,
      },
      dispatch: { queued: false, taskId: '', status: 'none_selected' },
    },
  }] as any, 'owner')

  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].capabilityId, 'none')
  assert.equal((receipts[0].result?.dispatch as any)?.queued, false)
  assert.equal((receipts[0].result?.decision as any)?.responseAuthored, false)
})

test('Robot Operator context is kept separate from the bridge observation', () => {
  const observation = sanitizeEnvironmentBridgeObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-23T12:00:00.000Z',
    capabilities: {
      actions: ['robotCommand', 'robotMotionPlan', 'captureImage'],
      robotCommands: ['gesture_alpha', 'gesture_beta'],
      movement: true,
      visual: true,
    },
    state: { stale: true },
    visual: { id: 'old-frame', timestamp: '2026-08-23T12:00:00.000Z' },
    visuals: [{ id: 'old-frame-2', timestamp: '2026-08-23T12:00:00.000Z' }],
    feedback: [{
      id: 'old-feedback',
      timestamp: '2026-08-23T12:00:00.000Z',
      type: 'completed',
      message: 'old action completed',
    }],
    metadata: {
      sensorReading: 'bridge-owned',
      actionContext: { actionId: 'old-action', correlationId: 'old-cycle' },
      robotObserver: { cycleId: 'movement-1' },
      robotOperatorDecision: { instruction: 'move' },
      robotOperatorMemories: ['old memory'],
    },
  })
  assert.equal(observation.visual?.id, 'old-frame')
  assert.equal(observation.visuals?.[0]?.id, 'old-frame-2')
  assert.deepEqual(observation.state, { stale: true })
  assert.deepEqual(observation.capabilities.actions, [
    'robotCommand',
    'robotMotionPlan',
    'captureImage',
  ])
  assert.deepEqual(observation.capabilities.robotCommands, ['gesture_alpha', 'gesture_beta'])
  assert.equal(observation.metadata?.sensorReading, 'bridge-owned')
  assert.equal(observation.metadata?.actionContext, undefined)
  assert.equal(observation.metadata?.robotObserver, undefined)
  assert.equal(observation.metadata?.robotOperatorDecision, undefined)
  assert.equal(observation.metadata?.robotOperatorMemories, undefined)
})

test('robot observer correlation advances without owning Robot Status task continuity', () => {
  const cycle = readRobotObserverCycle({
    metadata: {
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'boredom-observer',
        requestedBy: 'boredom-observer',
      },
    },
  })
  assert.ok(cycle)
  assert.equal(nextRobotObserverCycle(cycle)?.step, 2)
  assert.equal(nextRobotObserverCycle({ ...cycle, step: 3 }).step, 4)
  assert.equal(readRobotObserverCycle({
    metadata: { robotObserver: { ...cycle, step: 4 } },
  })?.step, 4)
})

test('robot audio perception starts correlated Environment feedback on the same lifecycle path', () => {
  const cycle = beginEnvironmentPerceptionCycle(
    'utterance-1',
    'environment',
  )
  assert.deepEqual(cycle, {
    cycleId: 'utterance-1',
    step: 1,
    triggerSource: 'user',
    graph: 'environment',
    requestedBy: 'environment-perception',
  })
  assert.equal(nextRobotObserverCycle(cycle!)?.step, 2)
})

test('each boredom child keeps its specialized policy in the editable workflow', () => {
  const graph = (id: string) => JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs', `${id}-mode.json`),
    'utf8',
  ))
  const message = (id: string, nodeId: string) => graph(id).nodes.find(
    (node: any) => node.id === nodeId,
  )?.data?.properties?.message ?? ''

  const movement = message('boredom-movement', 'planner-policy')
  assert.match(movement, /decide one contextually meaningful embodied intention/i)
  assert.match(movement, /begins with a physical change now/i)
  assert.match(movement, /waiting.*not a movement intention/i)
  assert.match(movement, /advertised capabilities/i)
  assert.match(movement, /only to break a genuine tie/i)
  assert.match(movement, /never choose novelty or difference for its own sake/i)
  assert.match(movement, /do not select a technical command/i)
  assert.doesNotMatch(movement, /exactly one safe robotCommand/i)

  const shared = graph('environment')
  const taskContext = shared.nodes.find((node: any) => node.id === '3')
  assert.match(taskContext.data.properties.autonomySystemPrompt, /internally authored planner intention/)
  assert.ok(shared.nodes.some((node: any) => node.data.nodeType === 'robot_operator_input'))
  assert.ok(shared.nodes.some((node: any) => node.data.nodeType === 'user_input'))
  assert.equal(fs.existsSync(new URL('../../../etc/cognitive-graphs/boredom-autonomy-mode.json', import.meta.url)), false)

  const observer = message('boredom-observer', 'planner-policy')
  assert.match(observer, /fresh correlated camera image as current evidence/i)
  assert.match(observer, /form one high-level interest, question, or concern/i)
  assert.match(observer, /rather than merely captioning/i)

  const reflection = message('boredom-reflection', 'planner-policy')
  assert.match(reflection, /sampled memory interact with the active persona/i)
  assert.match(reflection, /form one new high-level intention/i)
  assert.match(reflection, /concrete connection to the memory/i)
  assert.match(reflection, /without .* treating it as present-world evidence/i)
})

test('Robot Operator owns scheduling while Robot Status and boredom children own finite graph work', () => {
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-autonomy-controller'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-autonomy-controller'].handler, 'workflow.robot-autonomy-controller')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-status'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-status'].handler, 'workflow.robot-status')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-goal-review'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-goal-review'].handler, 'workflow.robot-goal-review')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-observer'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-observer'].handler, 'workflow.boredom-observer')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].handler, 'workflow.boredom-movement')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-reflection'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-reflection'].handler, 'workflow.boredom-reflection')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].lifecycle, 'service')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].servicePath, 'agents/active-operator/index.ts')

  const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'agents.json'), 'utf8'))
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'services.json'), 'utf8'))
  assert.equal(agents.agents['robot-status'].enabled, true)
  assert.equal(isRobotStatusEnabled(), true)
  assert.equal(agents.agents['robot-goal-review'].enabled, true)
  assert.equal(agents.agents['boredom-observer'].enabled, true)
  assert.equal(isBoredomObserverEnabled(), true)
  assert.equal(agents.agents['boredom-movement'].enabled, true)
  assert.equal(isBoredomMovementEnabled(), true)
  assert.equal(agents.agents['boredom-reflection'].enabled, true)
  assert.equal(isBoredomReflectionEnabled(), true)
  assert.equal(services.services['robot-operator'].startOnSystemBoot, true)
  const catalog = getAgentCatalogSnapshot()
  for (const child of ['robot-autonomy-controller', 'robot-status', 'robot-goal-review', 'boredom-observer', 'boredom-movement', 'boredom-reflection']) {
    const catalogItem = catalog.agents.find(agent => agent.id === child)
    assert.equal(catalogItem?.owner, 'robot-operator')
    assert.equal(catalogItem?.triggerRegistered, false)
    assert.equal(catalogItem?.canRun, true)

    const task = buildRobotOperatorManualTaskInput(
      child,
      agents.agents[child],
      'owner',
      ['--manual-check'],
    )
    assert.equal(task.handler, `workflow.${child}`)
    assert.equal(task.resource, 'local-llm')
    assert.equal(task.source, 'user')
    assert.equal(task.username, 'owner')
    assert.equal(task.cognitiveMode, 'environment')
    assert.equal(task.input.agentId, child)
    assert.equal(task.input.triggeredBy, 'manual')
    assert.equal(typeof task.input.cycleId, 'string')
    assert.equal(task.correlationId, task.input.cycleId)
    assert.deepEqual(task.input.args, ['--manual-check'])
    assert.equal(task.metadata?.producer, 'robot-operator')
    assert.equal(task.metadata?.childAgent, child)

    const childVariables = buildAgentDescriptor(child, agents.agents[child], catalogItem).variables
    assert.equal(childVariables.find(variable => variable.key === 'runtimeOwner')?.value, 'Active Operator')
    assert.equal(childVariables.find(variable => variable.key === 'workflowHandler')?.value, `workflow.${child}`)
  }
  assert.throws(
    () => buildRobotOperatorManualTaskInput('organizer', agents.agents.organizer, 'owner'),
    /not owned by Robot Operator/,
  )
  const variables = buildAgentDescriptor(
    'robot-operator',
    services.services['robot-operator'],
  ).variables
  assert.equal(variables.some(variable => variable.key === 'maxCycleSteps'), false)
  assert.equal(variables.some(variable => variable.key === 'graph'), false)
  assert.equal(variables.find(variable => variable.key === 'robotStatusGraph')?.value, 'robot-status')
  assert.equal(variables.find(variable => variable.key === 'robotAutonomyControllerGraph')?.value, 'robot-autonomy-controller')
  assert.equal(variables.find(variable => variable.key === 'robotGoalReviewGraph')?.value, 'robot-goal-review')
  assert.equal(variables.find(variable => variable.key === 'boredomObserverGraph')?.value, 'boredom-observer')
  assert.equal(variables.find(variable => variable.key === 'boredomMovementGraph')?.value, 'boredom-movement')
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionGraph')?.value, 'boredom-reflection')
  assert.equal(variables.some(variable => variable.key === 'autonomyGraph'), false)
  assert.equal(variables.find(variable => variable.key === 'environmentGraph')?.value, 'environment')
  const config = loadRobotOperatorConfig()
  assert.equal('maxCycleSteps' in config, false)
  assert.equal(config.robotStatusGraph, 'robot-status')
  assert.equal(config.robotAutonomyControllerGraph, 'robot-autonomy-controller')
  assert.equal(config.robotGoalReviewGraph, 'robot-goal-review')
  assert.equal(config.boredomObserverGraph, 'boredom-observer')
  assert.equal(config.boredomMovementGraph, 'boredom-movement')
  assert.equal(config.boredomReflectionGraph, 'boredom-reflection')
  assert.equal(Object.hasOwn(config, 'autonomyGraph'), false)
  assert.equal(config.environmentGraph, 'environment')
  assert.equal(robotOperatorChildGraph(config, 'robot-status'), 'robot-status')
  assert.equal(robotOperatorChildGraph(config, 'robot-autonomy-controller'), 'robot-autonomy-controller')
  assert.equal(robotOperatorChildGraph(config, 'robot-goal-review'), 'robot-goal-review')
  assert.equal(robotOperatorChildGraph(config, 'boredom-observer'), 'boredom-observer')

  const engine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8')
  const observerHandler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(ROOT, 'brain/agents/active-operator/index.ts'), 'utf8')
  assert.equal(fs.existsSync(path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts')), false)
  assert.match(engine, /workflow\.robot-status/)
  assert.match(engine, /workflow\.robot-goal-review/)
  assert.match(engine, /workflow\.boredom-observer/)
  assert.match(engine, /workflow\.boredom-movement/)
  assert.match(engine, /workflow\.boredom-reflection/)
  assert.doesNotMatch(observerHandler, /hasActiveRobotAutonomyCycle/)
  assert.match(observerHandler, /const observation = session\.latestObservation/)
  assert.match(observerHandler, /actions\.includes\('robotMotionPlan'\)/)
  assert.doesNotMatch(observerHandler, /actions\.filter\(/)
  assert.match(observerHandler, /graph: robotOperatorChildGraph\(config, agentId\)/)
  assert.doesNotMatch(observerHandler, /enqueueEnvironmentAction|type: 'captureImage'/)
  assert.match(observerHandler, /triggerSource: 'autonomy'/)
  assert.match(observerHandler, /runGraph\(\{/)
  assert.match(observerHandler, /environmentObservation: observation, environmentObservationCurrent: false/)
  assert.doesNotMatch(observerHandler, /enqueueEnvironmentObservation|enqueueRobotOperatorEnvironment/)
  assert.doesNotMatch(observerHandler, /type: 'robotCommand'|chooseBoredomMovementCommand/)
  assert.match(controller, /isSleepRuntimeActive\(\)/)
  assert.match(controller, /loadQueueState\(\)\?\.items/)
  assert.match(controller, /getQueueStateDir\(\)/)
  assert.match(controller, /fs\.watch\(getQueueStateDir\(\)/)
  assert.match(controller, /\$\{SERVICE_ID\}:assessment:/)
  assert.match(controller, /execution.stimulusAgent === CONTROLLER/)
  assert.doesNotMatch(controller, /cooldownMs|lastFullCycleCompletedAt|robotOperatorFullDueAt|FULL_IDLE_CONFIRMATIONS|cycle-settling/)
  assert.doesNotMatch(controller, /getQueueManager|addEventListener/)
  assert.doesNotMatch(controller, /operatorInstruction:/)
})

test('structured captureImage remains available and capability gated', async () => {
  const allowed = environmentSendActionNode.properties?.allowedActions as string[]
  assert.equal(allowed.includes('captureImage'), true)
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', 'environment-mode.json'), 'utf8'))
  assert.equal(graph.nodes.filter((node: any) => node.data?.nodeType === 'environment_active_task').length, 1)
  assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'boredom_movement'), false)

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need a fresh view before answering.',
      program: { steps: [{ kind: 'action', action: { type: 'captureImage' } }] },
      taskDecision: {
        outcome: 'act',
        reason: 'A current image is needed.',
        objective: 'Observe the current surroundings from a fresh image.',
        completionCriteria: 'A fresh image has been interpreted to describe the surroundings.',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
      },
    }),
    instruction: 'describe the current physical surroundings using your available senses',
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'ainekio-01',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['captureImage'], visual: true },
    },
    sessionId: 'ainekio-01',
  }, {})
  assert.equal(parsed.program.steps.length, 1)
  assert.equal(parsed.program.steps[0]?.action.type, 'captureImage')

  const unavailable = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need current visual perception.',
      program: { steps: [{ kind: 'action', action: { type: 'captureImage' } }] },
      taskDecision: {
        outcome: 'act',
        reason: 'A current image is needed.',
        objective: 'Observe the current surroundings from a fresh image.',
        completionCriteria: 'A fresh image has been interpreted to describe the surroundings.',
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
      },
    }),
    instruction: 'inspect the current physical environment',
    observation: {
      environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'ainekio-01',
      timestamp: new Date().toISOString(), capabilities: { actions: [], visual: false },
    },
    sessionId: 'ainekio-01',
  }, {})
  assert.equal(unavailable.program, null)
  assert.equal(unavailable.response, '')
  assert.match(unavailable.error, /camera is not currently available/i)
})

test('Robot Operator Input supplies cycle correlation for optional conversation metadata', async () => {
  const result = await robotOperatorInputNode.execute({}, {
    robotOperatorContext: {
      robotObserver: {
      cycleId: 'episode-response',
      step: 3,
      triggerSource: 'autonomy',
      graph: 'environment',
      requestedBy: 'boredom-observer',
      },
    },
  }, {})
  assert.equal(result.responseMetadata.correlationId, 'episode-response')
  assert.equal(result.responseMetadata.dialogueSource, 'boredom-observer')
  assert.equal('episodeId' in result.responseMetadata, false)
  assert.equal('episodeStatus' in result.responseMetadata, false)
})

test('Active Operator dashboard exposes Robot Operator children without private payloads', () => {
  const dashboard = fs.readFileSync(path.join(ROOT, 'apps/site/src/components/ActiveOperatorDashboard.svelte'), 'utf8')
  const statusHandler = fs.readFileSync(path.join(ROOT, 'packages/core/src/api/handlers/active-operator.ts'), 'utf8')
  const reflectionCard = fs.readFileSync(path.join(ROOT, 'apps/site/src/components/chat/cards/ReflectionCard.svelte'), 'utf8')
  for (const child of ['boredom-observer', 'boredom-movement', 'boredom-reflection']) {
    assert.match(dashboard, new RegExp(child))
    assert.match(reflectionCard, new RegExp(child))
  }
  assert.match(dashboard, /Active Operator/)
  assert.match(dashboard, /activationPoints/)
  assert.match(dashboard, /lastAssessment/)
  assert.match(dashboard, /Recent autonomy activity/)
  assert.match(statusHandler, /readRobotOperatorRuntimeState/)
  assert.doesNotMatch(statusHandler, /operatorInstruction|memoryContext|visuals|dataUrl/)
})
