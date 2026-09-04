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
  const requiredDecisionFields = (result.jsonSchema as any).properties.taskDecision.required
  assert.equal(result.currentInstruction, 'What do you see?')
  assert.equal(result.instructionSource, 'user')
  assert.equal(envelope.inputSource, 'user')
  assert.equal(requiredDecisionFields.includes('objective'), false)
})

test('explicit autonomous provenance requires the Environment LLM to author its objective', async () => {
  const context = await environmentContextBuilderNode.execute({
    observation,
    instruction: 'Choose one contextual consequence.',
    inputSource: 'autonomy',
  }, { username: 'owner' }, {
    systemPrompt: 'Return one Environment decision.',
    recentHistoryLimit: 4,
  })
  const requiredDecisionFields = (context.jsonSchema as any).properties.taskDecision.required
  assert.equal(context.instructionSource, 'autonomy')
  assert.equal(requiredDecisionFields.includes('objective'), true)

  const parsed = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I will request a fresh frame.',
      actions: [{ type: 'captureImage' }],
      movementRequest: null,
      taskDecision: {
        outcome: 'act',
        reason: 'Current visual evidence is needed.',
        objectiveComplete: false,
        continuationPolicy: 'bounded',
        requiredCompletionBasis: 'visual_observation',
        actionPurpose: 'information_gain',
      },
    }),
    observation,
    sessionId: observation.sessionId,
    inputSource: 'autonomy',
  }, {}, {})

  assert.deepEqual(parsed.actions, [])
  assert.match(parsed.taskDecisionError, /objective must be a non-empty string/i)
})
