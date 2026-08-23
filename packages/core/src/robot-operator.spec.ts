import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from './agent-catalog-definitions.js'
import { ROOT } from './path-builder.js'
import {
  beginEnvironmentPerceptionCycle,
  buildRobotOperatorInstruction,
  isBoredomObserverEnabled,
  isBoredomReflectionEnabled,
  isBoredomMovementEnabled,
  nextRobotObserverCycle,
  isRobotObserverEnabled,
  nextRobotOperatorFullChild,
  randomizedRobotOperatorIdleMs,
  readRobotObserverCycle,
  robotObserverSourceAllowed,
  robotOperatorFullDueAt,
  loadRobotOperatorConfig,
} from './robot-operator.js'
import { environmentSendActionNode } from './nodes/environment/send-action.node.js'
import { environmentActionParserNode } from './nodes/environment/action-parser.node.js'
import { buildAgentDescriptor } from './agent-monitor-descriptors.js'
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

test('full autonomy rotates children continuously between cooldowns', () => {
  const children = ['boredom-observer', 'boredom-movement', 'boredom-reflection'] as const
  assert.equal(nextRobotOperatorFullChild([...children], 0), 'boredom-observer')
  assert.equal(nextRobotOperatorFullChild([...children], 1), 'boredom-movement')
  assert.equal(nextRobotOperatorFullChild([...children], 2), 'boredom-reflection')
  assert.equal(nextRobotOperatorFullChild([...children], 3), 'boredom-observer')
  assert.equal(nextRobotOperatorFullChild([], 0), null)
  assert.equal(robotOperatorFullDueAt(100_000, 90_000, 30_000), 120_000)
  assert.equal(robotOperatorFullDueAt(100_000, 0, 30_000), 101_000)
})

test('movement and reflection stimuli never reuse an old camera frame as current evidence', () => {
  const cycle = {
    cycleId: 'movement-1',
    step: 1,
    maxSteps: 3,
    triggerSource: 'autonomy' as const,
    graph: 'boredom-movement',
    requestedBy: 'boredom-movement' as const,
  }
  const stimulus = buildRobotAutonomyStimulus({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-23T12:00:00.000Z',
    capabilities: { actions: ['robotCommand'], movement: true, visual: true },
    state: { stale: true },
    visual: { id: 'old-frame', timestamp: '2026-08-23T12:00:00.000Z' },
    visuals: [{ id: 'old-frame-2', timestamp: '2026-08-23T12:00:00.000Z' }],
  }, cycle, 'boredom-movement')
  assert.equal(stimulus.visual, undefined)
  assert.equal(stimulus.visuals, undefined)
  assert.equal(stimulus.state, undefined)
  assert.equal(stimulus.metadata?.currentVisualEvidence, false)
  assert.equal(stimulus.metadata?.sourceObservationAt, '2026-08-23T12:00:00.000Z')
  assert.equal(stimulus.metadata?.robotObserver, cycle)
})

test('robot observer correlation advances only within its bounded cycle', () => {
  const cycle = readRobotObserverCycle({
    metadata: {
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        maxSteps: 3,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'robot-observer',
      },
    },
  })
  assert.ok(cycle)
  assert.equal(nextRobotObserverCycle(cycle)?.step, 2)
  assert.equal(nextRobotObserverCycle({ ...cycle, step: 3 }), null)
  assert.equal(readRobotObserverCycle({
    metadata: { robotObserver: { ...cycle, step: 4 } },
  }), null)
})

test('robot audio perception reuses the finite observer counter without depending on the observer agent lifecycle', () => {
  const cycle = beginEnvironmentPerceptionCycle(
    'utterance-1',
    'environment',
    3,
  )
  assert.deepEqual(cycle, {
    cycleId: 'utterance-1',
    step: 1,
    maxSteps: 3,
    triggerSource: 'user',
    graph: 'environment',
    requestedBy: 'environment-perception',
  })
  assert.equal(nextRobotObserverCycle(cycle!)?.step, 2)
})

test('each boredom child receives a specialized bounded instruction', () => {
  const instruction = buildRobotOperatorInstruction('boredom-movement')
  const cycle = readRobotObserverCycle({
    metadata: {
      robotObserver: {
        cycleId: 'boredom-1',
        step: 1,
        maxSteps: 8,
        triggerSource: 'autonomy',
        requestedBy: 'boredom-movement',
        graph: 'boredom-movement',
        instruction,
      },
    },
  })
  assert.deepEqual(cycle, {
    cycleId: 'boredom-1',
    step: 1,
    maxSteps: 8,
    triggerSource: 'autonomy',
    requestedBy: 'boredom-movement',
    graph: 'boredom-movement',
    instruction,
  })
  assert.match(instruction, /one safe, bounded movement opportunity/i)
  assert.match(instruction, /Environment Mode must execute it/i)
  assert.match(instruction, /do not execute robot commands, speak, or control hardware/i)
  assert.doesNotMatch(instruction, /selectedCommand|allowlist/i)

  const observerInstruction = buildRobotOperatorInstruction('boredom-observer')
  assert.match(observerInstruction, /single current camera observation/i)
  assert.notEqual(observerInstruction, instruction)
  assert.match(observerInstruction, /"observed".*"instruction".*"requiresAction".*"reason"/i)

  const reflectionInstruction = buildRobotOperatorInstruction('boredom-reflection')
  assert.match(reflectionInstruction, /historical inspiration/i)
  assert.match(reflectionInstruction, /memory does not establish anything about the current environment/i)
})

test('Robot Operator owns scheduling while three boredom children own finite trigger work', () => {
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
  assert.equal(agents.agents['boredom-observer'].enabled, true)
  assert.equal(isBoredomObserverEnabled(), true)
  assert.equal(isRobotObserverEnabled(), true)
  assert.equal(agents.agents['boredom-movement'].enabled, true)
  assert.equal(isBoredomMovementEnabled(), true)
  assert.equal(agents.agents['boredom-reflection'].enabled, true)
  assert.equal(isBoredomReflectionEnabled(), true)
  assert.equal(services.services['robot-operator'].startOnSystemBoot, true)
  const variables = buildAgentDescriptor(
    'robot-operator',
    services.services['robot-operator'],
  ).variables
  assert.equal(variables.find(variable => variable.key === 'boredomObserverInactivityThreshold')?.value, 300)
  assert.equal(variables.find(variable => variable.key === 'boredomObserverJitterMs')?.value, 60_000)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementInactivityThreshold')?.value, 600)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementJitterMs')?.value, 120_000)
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionInactivityThreshold')?.value, 900)
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionJitterMs')?.value, 180_000)
  assert.equal(variables.find(variable => variable.key === 'maxCycleSteps')?.value, 8)
  assert.equal(variables.find(variable => variable.key === 'graph')?.value, 'robot-operator')
  assert.equal(variables.find(variable => variable.key === 'boredomObserverGraph')?.value, 'boredom-observer')
  assert.equal(variables.find(variable => variable.key === 'boredomMovementGraph')?.value, 'boredom-movement')
  assert.equal(variables.find(variable => variable.key === 'boredomReflectionGraph')?.value, 'boredom-reflection')
  assert.equal(variables.find(variable => variable.key === 'environmentGraph')?.value, 'environment')
  const config = loadRobotOperatorConfig()
  assert.equal(config.graph, 'robot-operator')
  assert.equal(config.boredomObserverGraph, 'boredom-observer')
  assert.equal(config.boredomMovementGraph, 'boredom-movement')
  assert.equal(config.boredomReflectionGraph, 'boredom-reflection')
  assert.equal(config.environmentGraph, 'environment')

  const engine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8')
  const observerHandler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(ROOT, 'brain/services/robot-operator.ts'), 'utf8')
  assert.equal(fs.existsSync(path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts')), false)
  assert.match(engine, /workflow\.boredom-observer/)
  assert.match(engine, /workflow\.boredom-movement/)
  assert.match(engine, /workflow\.boredom-reflection/)
  assert.match(observerHandler, /task\.handler === 'workflow\.boredom-movement'/)
  assert.match(observerHandler, /instruction: suppliedInstruction \|\| buildRobotOperatorInstruction\(agentId\)/)
  assert.match(observerHandler, /agentId === 'boredom-observer'[\s\S]*type: 'captureImage'/)
  assert.match(observerHandler, /buildRobotAutonomyStimulus\(session\.latestObservation, cycle, agentId\)/)
  assert.doesNotMatch(observerHandler, /type: 'robotCommand'|chooseBoredomMovementCommand/)
  assert.match(controller, /isSleepRuntimeActive\(\)/)
  assert.match(controller, /cancelAutomaticRobotAutonomy/)
  assert.match(controller, /task\.source === 'autonomy'/)
})

test('structured captureImage remains available and capability gated', async () => {
  const allowed = environmentSendActionNode.properties?.allowedActions as string[]
  assert.equal(allowed.includes('captureImage'), true)
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', 'environment-mode.json'), 'utf8'))
  const bridge = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_send_action')
  assert.equal(bridge.data.properties.allowedActions.includes('captureImage'), true)
  assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'boredom_movement'), false)

  const parsed = await environmentActionParserNode.execute({
    response: '{"response":"I need a fresh view before answering.","actions":[{"type":"captureImage"}],"movementRequest":null}',
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
    response: '{"response":"I need current visual perception.","actions":[{"type":"captureImage"}],"movementRequest":null}',
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
