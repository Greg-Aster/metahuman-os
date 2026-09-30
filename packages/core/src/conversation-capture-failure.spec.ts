import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-capture-failure-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network in capture tests') }
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('./audit.js')
setAuditEnabled(false)
const { withUserContext } = await import('./context.js')
const { getProfilePaths } = await import('./path-builder.js')
const { runGraph } = await import('./graph-runtime.js')
const { withGraphWork } = await import('./durable-execution/runtime.js')
const { getQueueManager } = await import('./queue/unified-queue-manager.js')
const { nodeRegistry, nodeExecutors } = await import('./nodes/index.js')
const { defineNode } = await import('./nodes/types.js')
const { scanEpisodicMemoryRecords } = await import('./memory.js')
const manager = getQueueManager()
let delivered = ''
const failure = defineNode({ id: 'fixture_model_failure', name: 'Model failure', category: 'utility',
  inputs: [{ name: 'message', type: 'string' }], outputs: [], description: 'Controlled provider failure',
  execute: async inputs => { delivered = inputs.message; throw new Error('Provider unavailable') } })
nodeRegistry.set(failure.id, failure)
nodeExecutors.set(failure.id, failure.execute)
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

for (const name of ['dual', 'agent', 'emulation', 'environment']) {
  test(name + ' saves exact input through its real graph prefix before model failure', async () => {
    const original = JSON.parse(fs.readFileSync(path.join(repo, 'etc/cognitive-graphs', name + '-mode.json'), 'utf8'))
    const user = original.nodes.find((node: any) => node.data.nodeType === 'user_input')
    const ids = new Set([user.id, 'input-conversation-buffer', 'input-memory-capture'])
    assert.ok(original.edges.some((edge: any) => edge.source === user.id && edge.sourceHandle === 'entry'
      && edge.target === 'input-conversation-buffer' && edge.targetHandle === 'entry'),
    'A forwarded user entry retains its original admission identity')
    const consumers = original.edges.filter((edge: any) => edge.source === 'input-memory-capture' && edge.sourceHandle === 'passthrough')
    assert.ok(consumers.length > 0)
    assert.equal(original.edges.some((edge: any) => edge.source === user.id && edge.sourceHandle === 'message' && !ids.has(edge.target)), false)
    const graph = { ...original, scheduler: { ...original.scheduler, eventInputNodeId: undefined },
      nodes: [...original.nodes.filter((node: any) => ids.has(node.id)), {
        id: 'failure', type: 'llmNode', position: { x: 1000, y: 0 },
        data: { nodeType: failure.id, label: 'Controlled failure', properties: {} } }],
      edges: [...original.edges.filter((edge: any) => ids.has(edge.source) && ids.has(edge.target)),
        { id: 'saved-input-to-model', source: 'input-memory-capture', sourceHandle: 'passthrough',
          target: 'failure', targetHandle: 'message', data: { type: 'string' } }] }
    const username = 'capture-' + name
    fs.mkdirSync(getProfilePaths(username).etc, { recursive: true })
    const text = '  Keep this message if generation fails.\n'
    const work = manager.enqueue({ type: 'generic', handler: 'generic', username, source: 'user', input: {}, maxAttempts: 1 })
    assert.ok(manager.claim(work.id))
    const result = await withUserContext({ username, userId: username, role: 'owner' }, () =>
      withGraphWork(work, id => manager.attachExecution(work.id, id), () => runGraph({
        graph, context: { username, userId: username, userMessage: text, recordPersonaMemory: true,
          sessionId: 'capture-session', cognitiveMode: name, memoryTimestamp: '2026-09-09T00:00:00.000Z' },
      }), async input => manager.enqueue(input)))
    assert.equal(result.status, 'failed')
    assert.equal(delivered, text)
    const memories = [...scanEpisodicMemoryRecords(username)].filter(item => item.status === 'record')
    assert.equal(memories.length, 1)
    assert.equal(memories[0].record.event.content, text)
    assert.equal(memories[0].record.event.metadata?.role, 'user')
    manager.complete(work.id, false, { error: 'Expected provider failure' })
  })
}
