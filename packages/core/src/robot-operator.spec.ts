import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from './agent-catalog-definitions.js'
import { ROOT } from './path-builder.js'
import {
  beginEnvironmentPerceptionCycle,
  hasActiveRobotAutonomyCycle,
  isRobotStatusEnabled,
  isBoredomObserverEnabled,
  isBoredomReflectionEnabled,
  isBoredomMovementEnabled,
  nextRobotObserverCycle,
  isRobotAutonomyWorkItem,
  nextRobotOperatorFullChild,
  randomizedRobotOperatorIdleMs,
  readRobotObserverCycle,
  robotObserverSourceAllowed,
  robotOperatorChildGraph,
  robotOperatorFullDueAt,
  loadRobotOperatorConfig,
} from './robot-operator.js'
import { environmentSendActionNode } from './nodes/environment/send-action.node.js'
import { environmentActionParserNode } from './nodes/environment/action-parser.node.js'
import { buildAgentDescriptor } from './agent-monitor-descriptors.js'
import { getAgentCatalogSnapshot } from './agent-catalog.js'
import { buildRobotOperatorManualTaskInput } from './queue/queue-system.js'
import { buildRobotAutonomyStimulus } from './queue/robot-autonomy-trigger-handler.js'

test('robot operator idle timing is five minutes plus or minus one minute', () => {
  const config = { inactivityThresholdSeconds: 300, jitterMs: 60_000 }
  assert.equal(randomizedRobotOperatorIdleMs(config, () => 0), 240_000)
  assert.equal(randomizedRobotOperatorIdleMs(config, () => 0.5), 300_000)
  assert.equal(randomizedRobotOperatorIdleMs(config, () => 1), 360_000)
})

test('manual observer cycles remain available while autonomous cycles require semi or full', () => {
  assert.equal(robotObserverSourceAllowed('reactive', 'user'), true)
  assert.equal(robotObserverSourceAllowed('reactive', 'autonomy'), false)
  assert.equal(robotObserverSourceAllowed('semi', 'autonomy'), true)
  assert.equal(robotObserverSourceAllowed('full', 'autonomy'), true)
})

test('full autonomy rotates children after a completed episode cooldown', () => {
  const children = ['robot-status', 'boredom-observer', 'boredom-movement', 'boredom-reflection'] as const
  assert.equal(nextRobotOperatorFullChild([...children], 0), 'robot-status')
  assert.equal(nextRobotOperatorFullChild([...children], 1), 'boredom-observer')
  assert.equal(nextRobotOperatorFullChild([...children], 2), 'boredom-movement')
  assert.equal(nextRobotOperatorFullChild([...children], 3), 'boredom-reflection')
  assert.equal(nextRobotOperatorFullChild([...children], 4), 'robot-status')
  assert.equal(nextRobotOperatorFullChild([], 0), null)
  assert.equal(robotOperatorFullDueAt(100_000, 90_000, 30_000), 120_000)
  assert.equal(robotOperatorFullDueAt(100_000, 0, 30_000), 101_000)
})

test('robot autonomy activity follows the canonical correlated work chain', () => {
  const child = {
    id: 'child-1',
    handler: 'workflow.boredom-observer',
    state: 'queued',
    input: {},
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
  const unrelated = {
    id: 'chat-1',
    handler: 'chat.persona',
    state: 'queued',
    input: {},
  } as any
  assert.equal(isRobotAutonomyWorkItem(child), true)
  assert.equal(isRobotAutonomyWorkItem(observation), true)
  assert.equal(isRobotAutonomyWorkItem(command), true)
  assert.equal(isRobotAutonomyWorkItem(unrelated), false)
  assert.equal(hasActiveRobotAutonomyCycle([child, observation, command, unrelated]), true)
  assert.equal(hasActiveRobotAutonomyCycle([{ ...command, state: 'completed' }]), false)
  assert.equal(hasActiveRobotAutonomyCycle([child], child.id), false)
})

test('movement and reflection stimuli exclude old frames while preserving state and advertised capabilities', () => {
  const cycle = {
    cycleId: 'movement-1',
    step: 1,
    triggerSource: 'autonomy' as const,
    graph: 'boredom-movement',
    requestedBy: 'boredom-movement' as const,
  }
  const stimulus = buildRobotAutonomyStimulus({
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
      actionContext: { actionId: 'old-action', correlationId: 'old-cycle' },
    },
  }, cycle, 'boredom-movement')
  assert.equal(stimulus.visual, undefined)
  assert.equal(stimulus.visuals, undefined)
  assert.deepEqual(stimulus.state, { stale: true })
  assert.equal(stimulus.metadata?.currentVisualEvidence, false)
  assert.equal(stimulus.metadata?.sourceObservationAt, '2026-08-23T12:00:00.000Z')
  assert.equal(stimulus.metadata?.robotObserver, cycle)
  assert.deepEqual(stimulus.capabilities.actions, [
    'robotCommand',
    'robotMotionPlan',
    'captureImage',
  ])
  assert.deepEqual(stimulus.capabilities.robotCommands, ['gesture_alpha', 'gesture_beta'])
  assert.deepEqual(stimulus.feedback, [])
  assert.equal(stimulus.metadata?.actionContext, undefined)

  const reflectionStimulus = buildRobotAutonomyStimulus({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-23T12:00:00.000Z',
    capabilities: {
      actions: ['sendText', 'robotCommand', 'robotMotionPlan', 'captureImage'],
      robotCommands: ['gesture_alpha', 'gesture_beta'],
      movement: true,
      visual: true,
    },
  }, {
    ...cycle,
    graph: 'boredom-reflection',
    requestedBy: 'boredom-reflection',
  }, 'boredom-reflection')
  assert.deepEqual(reflectionStimulus.capabilities.actions, [
    'sendText',
    'robotCommand',
    'robotMotionPlan',
    'captureImage',
  ])
  assert.deepEqual(reflectionStimulus.capabilities.robotCommands, ['gesture_alpha', 'gesture_beta'])
})

test('robot observer correlation advances without owning Task State lifecycle policy', () => {
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

  const executive = message('boredom-autonomy', 'executive-policy')
  assert.match(executive, /use your judgment to choose a response, exact action, or body-local movementRequest/i)
  assert.match(executive, /physical or sensing intention requires an action or movementRequest/i)
  assert.match(executive, /use movementRequest when none fits/i)
  assert.match(executive, /contextual fit comes first/i)
  assert.match(executive, /do not impose a fixed action count or deterministic stop/i)

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
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-status'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-status'].handler, 'workflow.robot-status')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-observer'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-observer'].handler, 'workflow.boredom-observer')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].handler, 'workflow.boredom-movement')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-reflection'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-reflection'].handler, 'workflow.boredom-reflection')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].lifecycle, 'service')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].servicePath, 'services/robot-operator.ts')

  const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'agents.json'), 'utf8'))
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'services.json'), 'utf8'))
  assert.equal(agents.agents['robot-status'].enabled, true)
  assert.equal(isRobotStatusEnabled(), true)
  assert.equal(agents.agents['boredom-observer'].enabled, true)
  assert.equal(isBoredomObserverEnabled(), true)
  assert.equal(agents.agents['boredom-movement'].enabled, true)
  assert.equal(isBoredomMovementEnabled(), true)
  assert.equal(agents.agents['boredom-reflection'].enabled, true)
  assert.equal(isBoredomReflectionEnabled(), true)
  assert.equal(services.services['robot-operator'].startOnSystemBoot, true)
  const catalog = getAgentCatalogSnapshot()
  for (const child of ['robot-status', 'boredom-observer', 'boredom-movement', 'boredom-reflection']) {
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
    assert.equal(task.resource, 'system')
    assert.equal(task.source, 'user')
    assert.equal(task.username, 'owner')
    assert.equal(task.cognitiveMode, 'environment')
    assert.equal(task.input.agentId, child)
    assert.equal(task.input.triggeredBy, 'manual')
    assert.deepEqual(task.input.args, ['--manual-check'])
    assert.equal(task.metadata?.producer, 'robot-operator')
    assert.equal(task.metadata?.childAgent, child)

    const childVariables = buildAgentDescriptor(child, agents.agents[child], catalogItem).variables
    assert.equal(childVariables.find(variable => variable.key === 'runtimeOwner')?.value, 'Robot Operator')
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
  assert.equal(variables.find(variable => variable.key === 'boredomObserverInactivityThreshold')?.value, 300)
  assert.equal(variables.find(variable => variable.key === 'robotStatusInactivityThreshold')?.value, 300)
  assert.equal(variables.find(variable => variable.key === 'robotStatusJitterMs')?.value, 60_000)
  assert.equal(variables.find(variable => variable.key === 'boredomObserverJitterMs')?.value, 60_000)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementInactivityThreshold')?.value, 600)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementJitterMs')?.value, 120_000)
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionInactivityThreshold')?.value, 900)
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionJitterMs')?.value, 180_000)
  assert.equal(variables.some(variable => variable.key === 'maxCycleSteps'), false)
  assert.equal(variables.some(variable => variable.key === 'graph'), false)
  assert.equal(variables.find(variable => variable.key === 'robotStatusGraph')?.value, 'robot-status')
  assert.equal(variables.find(variable => variable.key === 'boredomObserverGraph')?.value, 'boredom-observer')
  assert.equal(variables.find(variable => variable.key === 'boredomMovementGraph')?.value, 'boredom-movement')
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionGraph')?.value, 'boredom-reflection')
  assert.equal(variables.find(variable => variable.key === 'autonomyGraph')?.value, 'boredom-autonomy')
  assert.equal(variables.find(variable => variable.key === 'environmentGraph')?.value, 'environment')
  const config = loadRobotOperatorConfig()
  assert.equal('maxCycleSteps' in config, false)
  assert.equal(config.robotStatusGraph, 'robot-status')
  assert.equal(config.boredomObserverGraph, 'boredom-observer')
  assert.equal(config.boredomMovementGraph, 'boredom-movement')
  assert.equal(config.boredomReflectionGraph, 'boredom-reflection')
  assert.equal(config.autonomyGraph, 'boredom-autonomy')
  assert.equal(config.environmentGraph, 'environment')
  assert.equal(robotOperatorChildGraph(config, 'robot-status'), 'robot-status')
  assert.equal(robotOperatorChildGraph(config, 'boredom-observer'), 'boredom-observer')

  const engine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8')
  const observerHandler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(ROOT, 'brain/services/robot-operator.ts'), 'utf8')
  assert.equal(fs.existsSync(path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts')), false)
  assert.match(engine, /workflow\.robot-status/)
  assert.match(engine, /workflow\.boredom-observer/)
  assert.match(engine, /workflow\.boredom-movement/)
  assert.match(engine, /workflow\.boredom-reflection/)
  assert.match(observerHandler, /hasActiveRobotAutonomyCycle/)
  assert.match(observerHandler, /capabilities: latest\.capabilities/)
  assert.match(observerHandler, /actions\.includes\('robotMotionPlan'\)/)
  assert.doesNotMatch(observerHandler, /actions\.filter\(/)
  assert.match(observerHandler, /graph: robotOperatorChildGraph\(config, agentId\)/)
  assert.doesNotMatch(observerHandler, /enqueueEnvironmentAction|type: 'captureImage'/)
  assert.match(observerHandler, /triggerSource: 'autonomy'/)
  assert.match(observerHandler, /priority: manual \? 'high' : 'background'/)
  assert.match(observerHandler, /buildRobotAutonomyStimulus\(session\.latestObservation, cycle, agentId\)/)
  assert.doesNotMatch(observerHandler, /type: 'robotCommand'|chooseBoredomMovementCommand/)
  assert.match(controller, /isSleepRuntimeActive\(\)/)
  assert.match(controller, /loadQueueState\(\)\?\.items/)
  assert.match(controller, /watchFullCycle\('cycle-active'\)/)
  assert.doesNotMatch(controller, /getQueueManager|addEventListener/)
  assert.doesNotMatch(controller, /operatorInstruction:/)
})

test('structured captureImage remains available and capability gated', async () => {
  const allowed = environmentSendActionNode.properties?.allowedActions as string[]
  assert.equal(allowed.includes('captureImage'), true)
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', 'environment-mode.json'), 'utf8'))
  const bridge = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_send_action')
  assert.equal(bridge.data.properties.allowedActions.includes('captureImage'), true)
  assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'boredom_movement'), false)

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need a fresh view before answering.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'A current image is needed.',
        objective: 'Observe the current surroundings from a fresh image.',
        objectiveComplete: false,
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
  assert.equal(parsed.actions.length, 1)
  assert.equal(parsed.actions[0]?.type, 'captureImage')

  const unavailable = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I need current visual perception.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'A current image is needed.',
        objective: 'Observe the current surroundings from a fresh image.',
        objectiveComplete: false,
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
  assert.equal(unavailable.actions.length, 0)
  assert.match(unavailable.response, /camera is not currently available/i)
})

test('Boredom Autonomy response keeps cycle correlation in canonical buffer metadata', async () => {
  const result = await environmentSendActionNode.execute({
    response: 'The changed view gave me a new detail worth sharing.',
  }, {
    username: 'owner',
    environmentActionSource: 'autonomy',
    environmentObservation: { metadata: { autonomousStimulus: 'boredom-observer' } },
    robotObserver: {
      cycleId: 'episode-response',
      step: 3,
      triggerSource: 'autonomy',
      graph: 'boredom-autonomy',
      requestedBy: 'boredom-observer',
    },
  }, {})
  assert.equal(result.status, 'no_actions')
  assert.equal(result.conversationResponse, 'The changed view gave me a new detail worth sharing.')
  assert.equal(result.responseMetadata.correlationId, 'episode-response')
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
  assert.match(dashboard, /Robot Operator/)
  assert.match(dashboard, /Next:/)
  assert.match(dashboard, /Last admitted:/)
  assert.match(dashboard, /Recent boredom episodes/)
  assert.match(statusHandler, /readRobotOperatorRuntimeState/)
  assert.doesNotMatch(statusHandler, /operatorInstruction|memoryContext|visuals|dataUrl/)
})
