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
  })

  const envelope = JSON.parse(String(result.message))
  assert.equal(result.currentInstruction, 'What do you see?')
  assert.equal(result.instructionSource, 'user')
  assert.equal(envelope.inputSource, 'user')
  assert.equal(envelope.execution, null, 'Another execution’s status cannot become this turn’s objective')
  assert.deepEqual((result.jsonSchema as any).anyOf[0].properties.taskDecision.anyOf.map((branch: any) => branch.type), ['null', 'object'])
  assert.match((result.jsonSchema as any).anyOf[0].properties.taskDecision.description, /durable objective/i)
})

test('a requested capture enters a complete program with its own lifecycle state', async () => {
  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will request a fresh frame.',
      program: { steps: [{ kind: 'action', action: { type: 'captureImage' } }] },
      taskDecision: { objective: 'Take a fresh picture.', completionCriteria: 'A fresh picture is received.',
        outcome: 'act', reason: 'The user requested a picture.', continuationPolicy: 'none', requiredCompletionBasis: 'action_result' },
    }),
    observation,
    sessionId: observation.sessionId,
  }, {}, {})

  assert.equal(parsed.program.steps[0]?.action.type, 'captureImage')
  assert.equal(parsed.taskDecision.objectiveComplete, false)
  assert.equal(parsed.error, '')
})
