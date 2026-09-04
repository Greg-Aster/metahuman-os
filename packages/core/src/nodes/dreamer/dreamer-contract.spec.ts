import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { ROOT } from '../../path-builder.js'
import { buildDreamerMessages, DreamerDreamGeneratorNode } from './dreamer-dream-generator.node.js'
import { normalizeDreamContinuations } from './dreamer-dream-saver.node.js'
import {
  DreamerContinuationGeneratorNode,
  resolveContinuationLimit,
  resolveContinuationRoll,
} from './dreamer-continuation-generator.node.js'

test('dream generation explicitly consumes formatted persona context', () => {
  const messages = buildDreamerMessages(
    'Generate a surreal dream.',
    'Use these memories.',
    'Identity: A curious robot companion.',
  )
  assert.equal(messages.length, 2)
  assert.equal(typeof messages[0].content, 'string')
  if (typeof messages[0].content !== 'string') throw new Error('Dreamer system prompt must be text')
  assert.match(messages[0].content, /Identity: A curious robot companion/)
  assert.match(messages[0].content, /Generate a surreal dream/)
})

test('continuation limits honor both editable properties and canonical sleep config', () => {
  assert.equal(resolveContinuationLimit(4, 3), 2)
  assert.equal(resolveContinuationLimit(1, 3), 1)
  assert.equal(resolveContinuationLimit(4, 1), 0)
  assert.equal(resolveContinuationLimit(undefined, undefined), 4)
  assert.throws(() => resolveContinuationLimit('4', 3), /maxContinuations/)
})

test('continuation probability is stable for one coordinator execution', () => {
  const first = resolveContinuationRoll('dreamer:test-profile:task-1', 1)
  const replay = resolveContinuationRoll('dreamer:test-profile:task-1', 1)
  const next = resolveContinuationRoll('dreamer:test-profile:task-1', 2)
  assert.equal(first, replay)
  assert.notEqual(first, next)
  assert.equal(first >= 0 && first < 1, true)
  assert.equal(next >= 0 && next < 1, true)
  assert.equal(resolveContinuationRoll(undefined, 1, () => 0.25), 0.25)
})

test('Dreamer generators reject malformed editable numeric properties before model work', async () => {
  await assert.rejects(
    () => DreamerDreamGeneratorNode.execute!({ memories: [] }, {}, { temperature: Number.NaN }),
    /temperature must be between 0 and 2/,
  )
  await assert.rejects(
    () => DreamerContinuationGeneratorNode.execute!({ previousDream: '' }, {}, { continuationChance: Number.NaN }),
    /continuationChance must be between 0 and 1/,
  )
  await assert.rejects(
    () => DreamerContinuationGeneratorNode.execute!({ previousDream: '' }, {}, { delaySeconds: -1 }),
    /delaySeconds must be between 0 and 3600/,
  )
  await assert.rejects(
    () => DreamerContinuationGeneratorNode.execute!({ previousDream: '' }, {}, { maxTokens: 0 }),
    /maxTokens must be an integer between 1 and 32768/,
  )
})

test('continuation persistence input is normalized without losing reasoning order', () => {
  assert.deepEqual(normalizeDreamContinuations([
    { dream: ' First continuation ', thinking: ' First reasoning ', index: 1 },
    'Second continuation',
    { dream: '' },
  ]), [
    { dream: 'First continuation', thinking: 'First reasoning', index: 1 },
    { dream: 'Second continuation', index: 2 },
  ])
})

test('Dreamer graph has one persistence path and no persona-learning branch', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc', 'cognitive-graphs', 'dreamer-mode.json'),
    'utf8',
  ))
  const nodeTypeById = new Map<string, string>(
    graph.nodes.map((node: any) => [node.id, node.data.nodeType]),
  )
  const nodesOfType = (nodeType: string) => graph.nodes.filter((node: any) => node.data.nodeType === nodeType)
  const edgeTo = (targetType: string, targetHandle: string) => graph.edges.find(
    (edge: any) => nodeTypeById.get(edge.target) === targetType && edge.targetHandle === targetHandle,
  )
  const sourceType = (edge: any) => nodeTypeById.get(edge?.source)

  assert.equal(nodesOfType('dreamer_dream_saver').length, 1)
  assert.equal(nodesOfType('inner_dialogue_buffer').length, 1)
  assert.equal(nodesOfType('dreamer_learnings_extractor').length, 0)
  assert.equal(nodesOfType('dreamer_learnings_writer').length, 0)
  assert.equal(nodesOfType('audit_logger').length, 0)
  assert.equal(sourceType(edgeTo('dreamer_dream_generator', 'personaPrompt')), 'persona_formatter')
  assert.equal(sourceType(edgeTo('dreamer_dream_saver', 'continuationsData')), 'dreamer_continuation_generator')
  assert.equal(sourceType(edgeTo('inner_dialogue_buffer', 'entries')), 'dreamer_dream_saver')
  assert.equal(sourceType(edgeTo('tts', 'innerDialogue')), 'inner_dialogue_buffer')

  const continuationSource = fs.readFileSync(
    path.join(ROOT, 'packages/core/src/nodes/dreamer/dreamer-continuation-generator.node.ts'),
    'utf8',
  )
  assert.doesNotMatch(continuationSource, /captureEvent|submitInnerDream|submitInnerReasoning/)
})
