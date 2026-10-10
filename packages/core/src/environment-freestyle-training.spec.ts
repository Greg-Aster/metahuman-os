import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-freestyle-training-'))
process.env.METAHUMAN_ROOT = root
after(() => fs.rmSync(root, { recursive: true, force: true }))

const { validateSvelteFlowGraph } = await import('./cognitive-graph-schema.js')
const { runGraph, requireGraphNodeOutput } = await import('./graph-runtime.js')

test('Freestyle graph preserves generated output and continues when review storage is unavailable', async () => {
  const graph = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../etc/cognitive-graphs/environment-freestyle-mode.json'), 'utf8')))
  const raw = JSON.stringify({ summary: 'Raised the body and returned to stand',
    frames: [{ durationMs: '400', R1: '135', R2: '45', L1: '45', L2: '135', R4: '0', R3: '180', L3: '0', L4: '180' }],
    endPose: 'stand' })
  const state = await runGraph({ graph, context: {
    username: 'training-graph-test',
    environmentMotionRequest: {
      movementRequest: { description: 'Raise the body.', motionClass: 'body_local', sessionId: 'session-test' },
      instruction: 'Raise the body.', sessionId: 'session-test',
      observation: { environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'session-test',
        timestamp: '2026-10-09T00:00:00.000Z', capabilities: { actions: ['robotMotionPlan'] },
        state: { commandedPose: { version: 1, jointMapVersion: 1, kind: 'reference', reference: 'stand',
          sourceActionId: 'stand-test', updatedAt: '2026-10-09T00:00:00.000Z' } } },
    },
    generateEnvironmentMotionPlan: async () => raw,
  } })
  assert.notEqual(state.status, 'failed')
  const generated = requireGraphNodeOutput(state, 'movement_generator')
  assert.equal(generated.valid, true)
  assert.equal(generated.rawOutput, raw)
  assert.equal(generated.action.type, 'robotMotionPlan')
  const saved = requireGraphNodeOutput(state, 'environment_freestyle_training_output')
  assert.equal(saved.saved, false)
  assert.match(saved.error, /durable Coordinator identity/)
})
