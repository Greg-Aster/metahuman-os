import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selected-session-pending-'))
process.env.METAHUMAN_ROOT = root
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../../audit.js')
setAuditEnabled(false)
const { getQueueManager } = await import('../../queue/unified-queue-manager.js')
const { summarizeEnvironmentBridgeState } = await import('../../environment-interface/store.js')
const { robotAutonomyControllerContextNode } = await import('./context-builder.node.js')

const now = new Date().toISOString()
const observation = { environmentId: 'fixture', adapter: 'fixture', sessionId: 'selected-robot',
  timestamp: now, capabilities: { actions: ['robotCommand'] }, state: {} }
const bridgeState = { enabled: true, updatedAt: now, feedback: [], sessions: {
  'selected-robot': { sessionId: 'selected-robot', environmentId: 'fixture', adapter: 'fixture',
    status: 'connected', connectedAt: now, lastSeenAt: now, latestObservation: observation },
} }
const manager = getQueueManager()
const unknown = { id: 'old-unrelated-command', type: 'environment_command', handler: 'environment.command',
  state: 'waiting', priority: 'normal', source: 'system', username: 'system', resource: 'environment:body',
  cognitiveMode: 'environment', createdAt: '2026-09-07T17:32:52.438Z', attempt: 0, maxAttempts: 1,
  input: { type: 'robotCommand', sessionId: 'body', command: 'walk' },
  cancellationRequestedAt: '2026-09-07T17:32:52.492Z', cancellationReason: 'User cancelled',
  waitingReason: 'outcome_unknown: Acknowledgement lost' }

async function selectedPendingCount() {
  const bridgeSummary = summarizeEnvironmentBridgeState(bridgeState as never)
  const result = await robotAutonomyControllerContextNode.execute({
    instruction: 'Fixture decision context', observation, bridgeSummary, availableTasks: [],
  }, {}, {})
  const envelope = JSON.parse(result.messages[1].content)
  return { bridgeSummary, count: envelope.robotOperatorContext.environmentBridge.state.pendingCommandCount }
}

test('selected robot context excludes unrelated unknown work while preserving its global receipt', async () => {
  manager.importState({ items: [unknown], history: [], lastUpdated: now } as never)
  const before = JSON.stringify(manager.exportState().items)
  const { bridgeSummary, count } = await selectedPendingCount()
  assert.equal(bridgeSummary.pendingCommandCount, 1, 'Global overview must retain the unknown command')
  assert.equal(JSON.stringify(manager.exportState().items), before, 'Reading context must not cancel or alter unknown work')
  assert.equal(count, 0, 'An unrelated body session must not become pending work for the selected robot')
})

test('selected robot context counts its own admitted work separately from other sessions', async () => {
  manager.importState({ items: [unknown], history: [], lastUpdated: now } as never)
  manager.enqueue({ type: 'environment_command', username: 'fixture', source: 'user',
    input: { type: 'robotCommand', command: 'wave', sessionId: 'selected-robot' } })
  const { bridgeSummary, count } = await selectedPendingCount()
  assert.equal(bridgeSummary.pendingCommandCount, 2)
  assert.equal(count, 1)
})

test.after(() => { fs.rmSync(root, { recursive: true, force: true }) })
