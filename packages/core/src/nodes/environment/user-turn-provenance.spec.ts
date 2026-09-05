import assert from 'node:assert/strict'
import test from 'node:test'

import type { EnvironmentObservation } from '../../environment-interface/index.js'
import { environmentActionParserNode } from './action-parser.node.js'
import { environmentContextBuilderNode } from './context-builder.node.js'

const observation: EnvironmentObservation = {
  environmentId: 'robot-environment',
  adapter: 'robot-adapter',
  sessionId: 'robot-1',
  timestamp: '2026-09-02T12:00:00.000Z',
  capabilities: {
    actions: ['captureImage'],
    robotCommands: [],
    text: true,
    movement: false,
    visual: true,
    map: false,
  },
  feedback: [],
  metadata: { correlationId: 'current-turn' },
}

test('a current user instruction owns provenance over an unfinished autonomous Robot Status task', async () => {
  const result = await environmentContextBuilderNode.execute({
    observation,
    instruction: 'What do you see?',
    userInstruction: 'What do you see?',
    inputSource: 'autonomy',
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: true,
      needsEnvironment: true,
      needsVision: true,
      needsAction: false,
      needsTaskLifecycle: false,
    },
    robotStatus: {
      task: {
        objective: 'Continue an earlier boredom movement.',
        instruction: 'Move toward the light.',
        source: 'autonomy',
        decision: {
          outcome: 'act',
          reason: 'Earlier autonomous choice.',
          objectiveComplete: false,
        },
      },
    },
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
    recentHistoryLimit: 4,
  })

  const envelope = JSON.parse(String(result.message))
  assert.equal(result.currentInstruction, 'What do you see?')
  assert.equal(result.instructionSource, 'user')
  assert.equal(envelope.inputSource, 'user')
  assert.deepEqual((result.jsonSchema as any).properties.taskDecision, { type: 'null' })
})

test('a standalone action may omit task lifecycle state', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will request a fresh frame.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: null,
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {})

  assert.equal(parsed.actions[0]?.type, 'captureImage')
  assert.equal(parsed.taskDecision, null)
  assert.equal(parsed.taskDecisionError, '')
})
