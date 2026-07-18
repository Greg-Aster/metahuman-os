import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from './agent-catalog-definitions.js'
import { ROOT } from './path-builder.js'
import {
  chooseBoredomMovementCommand,
  eligibleBoredomMovementCommands,
  isBoredomMovementEnabled,
  loadBoredomMovementCommandAllowlist,
  nextRobotObserverCycle,
  isRobotObserverEnabled,
  randomizedRobotOperatorIdleMs,
  readRobotObserverCycle,
  robotObserverSourceAllowed,
} from './robot-operator.js'
import { environmentSendActionNode } from './nodes/environment/send-action.node.js'
import { environmentActionParserNode } from './nodes/environment/action-parser.node.js'
import { buildAgentDescriptor } from './agent-monitor-descriptors.js'

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

test('robot observer and operator have separate lifecycle owners', () => {
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-observer'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-observer'].handler, 'workflow.robot-observer')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].lifecycle, 'workflow')
  assert.equal(AGENT_CATALOG_DEFINITIONS['boredom-movement'].handler, 'workflow.boredom-movement')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].lifecycle, 'service')
  assert.equal(AGENT_CATALOG_DEFINITIONS['robot-operator'].servicePath, 'services/robot-operator.ts')

  const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'agents.json'), 'utf8'))
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'services.json'), 'utf8'))
  assert.equal(agents.agents['robot-observer'].enabled, true)
  assert.equal(isRobotObserverEnabled(), true)
  assert.equal(agents.agents['boredom-movement'].enabled, true)
  assert.equal(isBoredomMovementEnabled(), true)
  assert.equal(services.services['robot-operator'].startOnSystemBoot, true)
  const variables = buildAgentDescriptor(
    'robot-operator',
    services.services['robot-operator'],
  ).variables
  assert.equal(variables.find(variable => variable.key === 'inactivityThreshold')?.value, 300)
  assert.equal(variables.find(variable => variable.key === 'jitterMs')?.value, 60_000)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementInactivityThreshold')?.value, 600)
  assert.equal(variables.find(variable => variable.key === 'boredomMovementJitterMs')?.value, 120_000)
  assert.equal(variables.find(variable => variable.key === 'maxCycleSteps')?.value, 3)
  assert.equal(variables.find(variable => variable.key === 'graph')?.value, 'environment')
})

test('boredom movement owns and intersects its stationary command allowlist', () => {
  const configured = loadBoredomMovementCommandAllowlist()
  assert.equal(configured.includes('walk'), false)
  assert.equal(configured.includes('backward'), false)
  assert.equal(configured.includes('left'), false)
  assert.equal(configured.includes('right'), false)
  assert.equal(configured.includes('wave'), true)
  assert.equal(configured.includes('dead'), true)

  const commands = eligibleBoredomMovementCommands(
    ['walk', 'backward', 'left', 'right', 'wave', 'dead', 'sit', 'dance'],
    [...configured, 'walk', 'not-advertised'],
  )
  assert.deepEqual(commands, ['sit', 'wave', 'dance', 'dead'])
  assert.equal(chooseBoredomMovementCommand(commands, () => 0), 'sit')
  assert.equal(chooseBoredomMovementCommand(commands, () => 0.999), 'dead')
})

test('agent-selected exact command controls the unchanged Environment Mode parser', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will walk instead.',
      actions: [{ type: 'robotCommand', command: 'walk' }],
      movementRequest: null,
    }),
    instruction: 'perform wave',
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'ainekio-sim-1',
      timestamp: new Date().toISOString(),
      capabilities: {
        actions: ['robotCommand'],
        robotCommands: ['wave'],
      },
    },
    sessionId: 'ainekio-sim-1',
  }, {})
  assert.equal(parsed.actions.length, 1)
  assert.equal(parsed.actions[0]?.type, 'robotCommand')
  assert.equal(parsed.actions[0]?.command, 'wave')
})

test('captureImage remains internal to Robot Observer rather than a graph action', () => {
  const allowed = environmentSendActionNode.properties?.allowedActions as string[]
  assert.equal(allowed.includes('captureImage'), false)
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc', 'cognitive-graphs', 'environment-mode.json'), 'utf8'))
  const bridge = graph.nodes.find((node: any) => node.data?.nodeType === 'environment_send_action')
  assert.equal(bridge.data.properties.allowedActions.includes('captureImage'), false)
  assert.equal(graph.nodes.some((node: any) => node.data?.nodeType === 'boredom_movement'), false)
})
