import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import type { QueuedTask, RobotOperatorRuntimeState } from '@metahuman/core'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-full-admission-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network in Full admission tests') }
mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Test transport disabled'), { code: 'ECONNREFUSED' })))
  return this
})
const core = await import('@metahuman/core')
core.setAuditEnabled(false)
const graphs = path.join(root, 'etc/cognitive-graphs')
fs.mkdirSync(path.join(graphs, 'custom'), { recursive: true })
const valid = fs.readFileSync(new URL('../../etc/cognitive-graphs/robot-autonomy-controller-mode.json', import.meta.url), 'utf8')
let selectedGraph = 'controller-a'
let items: QueuedTask[] = []
let history: QueuedTask[] = []
let runtime: RobotOperatorRuntimeState | undefined
let executions: ReturnType<typeof core.activeRobotExecutions> = []
let admitted = 0
const queueFile = path.join(core.getQueueStateDir(), 'work-items.json')
const configuration = { ...core.loadRobotOperatorConfig(), enabled: true }
const coreMock = mock.module('@metahuman/core', { namedExports: {
  ...core,
  acquireLock: () => ({ release() {} }),
  initGlobalLogger: () => {},
  getOperatorMode: () => 'full',
  getCurrentlyActiveUser: () => ({ username: 'fixture-owner', role: 'owner' }),
  isRobotOperatorChildEnabled: () => true,
  isSleepRuntimeActive: () => false,
  loadRobotOperatorConfig: () => ({ ...configuration, robotAutonomyControllerGraph: selectedGraph }),
  loadQueueState: () => ({ items, history }),
  activeRobotExecutions: () => executions,
  onAuthenticatedSessionChange: () => () => {},
  writeRobotOperatorRuntimeState: (value: RobotOperatorRuntimeState) => { runtime = value },
} })
const queueMock = mock.module('@metahuman/core/queue', { namedExports: {
  submitCoordinatorWork: async (input: any) => {
    const task = { ...input, id: `fixture-work-${++admitted}`, state: 'queued', createdAt: new Date().toISOString(), attempt: 0 }
    items.push(task)
    return task
  },
} })
const { run } = await import('./robot-operator.js')

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Full admission did not reach expected state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
function wakeQueue() { fs.writeFileSync(queueFile, JSON.stringify({ items })) }

test('real Full service admits only a loadable Controller, independently of history and selected child failures', async () => {
  fs.writeFileSync(path.join(graphs, 'controller-a-mode.json'), '{invalid json')
  const priorSignalHandlers = process.listeners('SIGTERM')
  const running = run()
  try {
    await until(() => runtime?.lifecycle === 'failed')
    assert.equal(admitted, 0)
    // Arbitrary Coordinator changes and history eviction do not admit bad work.
    for (let index = 0; index < 4; index++) {
      wakeQueue()
      await new Promise(resolve => setTimeout(resolve, 25))
      assert.equal(admitted, 0)
    }
    // Changing the selected graph recovers even if A itself is still broken.
    selectedGraph = 'controller-b'
    fs.writeFileSync(path.join(graphs, 'controller-b-mode.json'), valid)
    await until(() => admitted === 1)
    assert.equal(items[0].handler, 'workflow.robot-autonomy-controller')
    // A child's failure is an execution outcome, not a blanket autonomy veto.
    history = [{ ...items[0], handler: 'workflow.boredom-observer', state: 'failed',
      error: { code: 'workflow_configuration_invalid', message: 'Selected child unavailable', retryable: false } }]
    items = []
    wakeQueue()
    await until(() => admitted === 2)
    // A missing configured root is an explicit failure, not a fresh queue loop.
    selectedGraph = 'missing'
    items = []
    wakeQueue()
    await until(() => runtime?.lifecycle === 'failed')
    assert.equal(admitted, 2)
    assert.match(runtime!.reason, /Workflow not found: missing/)
    // A valid override rescues the root without altering its invalid base.
    selectedGraph = 'controller-a'
    fs.writeFileSync(path.join(graphs, 'custom/controller-a-mode.json'), valid)
    await until(() => admitted === 3)
    // A saved execution is resumed directly, even if fresh Controller config is invalid.
    selectedGraph = 'missing'
    items = []
    executions = [{ executionId: 'saved-execution', checkpointVersion: 4, waitingReason: 'user_or_autonomy', resumePending: false }] as typeof executions
    wakeQueue()
    await until(() => admitted === 4)
    assert.equal(items[0].handler, 'graph.signal')
    assert.equal(items[0].input.executionId, 'saved-execution')
  } finally {
    for (const handler of process.listeners('SIGTERM')) {
      if (!priorSignalHandlers.includes(handler)) handler.call(process, 'SIGTERM')
    }
    await running
    coreMock.restore()
    queueMock.restore()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
