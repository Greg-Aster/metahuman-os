import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-curator-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Curator graph test must not call a real model') }
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { validateSvelteFlowGraph } = await import('../../cognitive-graph-schema.js')
const { executionDefinition } = await import('../../durable-execution/graph-contract.js')
const { openExecutionStore } = await import('../../durable-execution/storage.js')
const { recordEnvironmentTrainingOutput, readEnvironmentTrainingProposal } = await import('../../environment-training-bank.js')
const { executeGraph } = await import('../../graph-executor.js')
const { nodeExecutors } = await import('../index.js')
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

test('curator LLM call runs through graph and saves a proposal from original input and evidence', async () => {
  const graph = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../../../../../etc/cognitive-graphs/environment-training-curator-mode.json'), 'utf8')))
  const username = 'curator-fixture'
  const store = openExecutionStore(username)
  const source = store.create(username, executionDefinition(graph))
  const candidate = recordEnvironmentTrainingOutput({ username, executionId: source.executionId,
    occurrenceId: 'test', nodeId: 'intent-orchestrator', graphHash: 'test-graph', specialist: 'intent',
    messages: [{ role: 'system', content: 'Original routing instructions' },
      { role: 'user', content: 'Current user message: Please wave.' }],
    observedOutput: '{"needsResponse":false,"needsAction":true,"taskContext":[],"conversationContext":[]}',
  })
  store.close()
  const previous = nodeExecutors.get('model_router')!
  let modelMessages: unknown
  nodeExecutors.set('model_router', async inputs => {
    modelMessages = inputs.messages
    return { response: JSON.stringify({ verdict: 'correct', reason: 'The saved output selected the action route.' }) }
  })
  try {
    const state = await executeGraph(graph, { username, userId: username, cognitiveMode: 'environment',
      environmentTrainingReview: { bank: 'decision', candidateId: candidate.id } })
    assert.equal(state.status, 'completed', state.error?.stack)
    const messages = modelMessages as Array<{ role: string; content: string }>
    assert.equal(messages[0]?.role, 'system')
    assert.match(messages[1]?.content ?? '', /Please wave/)
    assert.equal(readEnvironmentTrainingProposal(username, 'decision', candidate.id)?.verdict, 'correct')
  } finally { nodeExecutors.set('model_router', previous) }
})
