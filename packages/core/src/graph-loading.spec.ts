import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-graph-loading-'))
process.env.METAHUMAN_ROOT = fixture
globalThis.fetch = async () => { throw new Error('No network in graph loading tests') }
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { loadGraphForMode } = await import('./graph-streaming.js')
const { loadGraphFile } = await import('./graph-runtime.js')
const { UnifiedQueueManager } = await import('./queue/unified-queue-manager.js')
const { ExecutionEngine } = await import('./queue/execution-engine.js')
after(() => { eventBus.disconnect(); fs.rmSync(fixture, { recursive: true, force: true }) })

const directory = path.join(fixture, 'etc/cognitive-graphs')
fs.mkdirSync(path.join(directory, 'custom'), { recursive: true })
const graph = JSON.parse(fs.readFileSync(new URL('../../../etc/cognitive-graphs/robot-autonomy-controller-mode.json', import.meta.url), 'utf8'))

test('invalid configured graphs retain the validation error through both real loaders', async () => {
  const invalid = structuredClone(graph)
  invalid.edges.find((edge: any) => edge.data?.when).data.when.output = 'output_not_in_contract'
  const filename = path.join(directory, 'invalid-mode.json')
  fs.writeFileSync(filename, JSON.stringify(invalid))
  for (const load of [() => loadGraphForMode('invalid'), () => loadGraphFile(filename)]) {
    await assert.rejects(load, /undeclared output.*output_not_in_contract/)
  }
})

test('invalid custom graph does not silently execute the bundled default', async () => {
  fs.writeFileSync(path.join(directory, 'custom-mode.json'), JSON.stringify(graph))
  const custom = path.join(directory, 'custom/custom-mode.json')
  fs.writeFileSync(custom, '{invalid json')
  await assert.rejects(() => loadGraphForMode('custom'), /JSON|property name/)
  fs.writeFileSync(custom, JSON.stringify(graph))
  assert.equal((await loadGraphForMode('custom'))?.source, custom)
  await assert.rejects(() => loadGraphForMode('absent'), /Workflow not found: absent/)
  assert.equal(await loadGraphFile(path.join(directory, 'absent-mode.json')), null)
})

test('Coordinator retains wrapped configuration failure without retrying the same job', async () => {
  const filename = path.join(directory, 'controller-mode.json')
  fs.writeFileSync(filename, '{invalid json')
  const manager = new UnifiedQueueManager()
  const engine = new ExecutionEngine({}, manager)
  let calls = 0
  engine.registerHandler('workflow.robot-autonomy-controller', async () => {
    calls++
    try { return await loadGraphForMode('controller') }
    catch (cause) { throw new Error('Controller failed', { cause }) }
  })
  const task = manager.enqueue({ type: 'generic', handler: 'workflow.robot-autonomy-controller',
    username: 'fixture-owner', source: 'autonomy', resource: 'io', input: {}, maxAttempts: 3 })
  engine.start()
  try {
    const deadline = Date.now() + 5_000
    while (manager.getTask(task.id)?.state !== 'failed') {
      assert.ok(Date.now() < deadline, 'Configuration failure must reach a terminal receipt')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  } finally { await engine.stop() }
  assert.equal(calls, 1, 'An unchanged definition cannot become valid through retries')
  const failed = manager.getTask(task.id)!
  assert.equal(failed.error?.code, 'workflow_configuration_invalid')
  assert.equal(failed.error?.retryable, false)
  assert.match(failed.error?.message ?? '', /Controller failed/)
  const restored = new UnifiedQueueManager()
  restored.importState(JSON.parse(JSON.stringify(manager.exportState())))
  assert.deepEqual(restored.getHistory()[0].error, failed.error)
  fs.writeFileSync(filename, JSON.stringify(graph))
  assert.ok(await loadGraphForMode('controller'))
})

test('corrected definitions reload even when a deployment preserves the old mtime', async () => {
  const filename = path.join(directory, 'timestamps-mode.json')
  fs.writeFileSync(filename, '{invalid json')
  const before = fs.statSync(filename)
  await assert.rejects(() => loadGraphForMode('timestamps'))
  fs.writeFileSync(filename, JSON.stringify(graph))
  fs.utimesSync(filename, before.atime, before.mtime)
  assert.ok(await loadGraphForMode('timestamps'))
})
